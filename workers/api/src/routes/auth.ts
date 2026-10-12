import { timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, gt, gte } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';
import { type Db, withDatabase, withTransaction } from '../db';
import { otpCodes, users } from '../db/schema';
import { type ApiEnv, integerSetting } from '../env';
import { requireMember } from '../http/auth';
import { ApiError } from '../http/errors';
import { presentUser } from '../presenters/users';
import { isUbcEmail, normalizeMemberInput, otpSendSchema, otpVerifySchema } from '../schemas/member';
import { createServices, type RequestServices, type ServicesFactory } from '../services';

function authError(status: number, code: string, message: string) {
  return new ApiError(status, { code, message });
}

function randomOtp(): string {
  // Rejection sampling avoids bias while preserving the existing six-digit range.
  const range = 900_000;
  const ceiling = Math.floor(2 ** 32 / range) * range;
  const bytes = new Uint32Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0]! >= ceiling);
  return String(100_000 + bytes[0]! % range);
}

function serializationFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { code?: unknown; cause?: unknown };
  return value.code === '40001' || (value.cause !== error && serializationFailure(value.cause));
}

async function createAndSendOtp(env: ApiEnv, db: Db, services: RequestServices, email: string): Promise<number> {
  const normalized = email.toLowerCase();
  const expiryMinutes = integerSetting(env.OTP_EXPIRY_MINUTES, 10);
  const rateLimit = integerSetting(env.OTP_RATE_LIMIT_PER_15MIN, 3);
  let code = '';
  // Predicate reads in SERIALIZABLE mode also protect a previously unseen email:
  // concurrent first requests cannot bypass the limit or leave two active codes.
  for (let retry = 0; ; retry++) {
    try {
      code = await db.transaction(async tx => {
        const now = services.now();
        const [recent] = await tx.select({ count: count() }).from(otpCodes).where(and(
          eq(otpCodes.email, normalized), gte(otpCodes.createdAt, new Date(now.getTime() - 900_000)),
        ));
        if (recent!.count >= rateLimit) throw authError(429, 'OTP_RATE_LIMITED', 'Too many requests. Try again later.');
        await tx.update(otpCodes).set({ used: true }).where(and(eq(otpCodes.email, normalized), eq(otpCodes.used, false)));
        const nextCode = randomOtp();
        await tx.insert(otpCodes).values({
          email: normalized, code: nextCode,
          expiresAt: new Date(now.getTime() + expiryMinutes * 60_000), createdAt: now,
        });
        return nextCode;
      }, { isolationLevel: 'serializable' });
      break;
    } catch (error) {
      if (!serializationFailure(error)) throw error;
      if (retry >= 4) throw new ApiError(503, 'Authentication temporarily busy. Try again.');
    }
  }
  // Delivery is outside the transaction. Failed delivery retains the attempt and
  // invalidated older code, exactly as the Python API does.
  try { await services.sendOtpEmail(email, code); }
  catch { throw authError(500, 'OTP_DELIVERY_FAILED', 'Failed to send verification email.'); }
  return expiryMinutes * 60;
}

async function consumeOtp(env: ApiEnv, db: Db, services: RequestServices, email: string, code: string): Promise<void> {
  const failure = await withTransaction(db, async tx => {
    const [otp] = await tx.select().from(otpCodes).where(and(
      eq(otpCodes.email, email.toLowerCase()), eq(otpCodes.used, false), gt(otpCodes.expiresAt, services.now()),
    )).orderBy(desc(otpCodes.createdAt)).limit(1).for('update');
    if (!otp) return authError(400, 'OTP_EXPIRED', 'No valid code found. Request a new one.');
    if (otp.attempts >= integerSetting(env.OTP_MAX_ATTEMPTS, 5)) {
      await tx.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, otp.id));
      return authError(400, 'OTP_TOO_MANY_ATTEMPTS', 'Too many attempts. Request a new code.');
    }
    const expected = new TextEncoder().encode(otp.code);
    const actual = new TextEncoder().encode(code);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      await tx.update(otpCodes).set({ attempts: otp.attempts + 1 }).where(eq(otpCodes.id, otp.id));
      return authError(400, 'OTP_INVALID', 'Invalid code.');
    }
    await tx.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, otp.id));
    return null;
  });
  // Throw only after the transaction commits attempts/used state.
  if (failure) throw failure;
}

export function createAuthRoutes(env: ApiEnv, servicesFactory: ServicesFactory = () => createServices(env)) {
  return new Elysia({ name: 'member-auth', adapter: CloudflareAdapter, normalize: false })
    .onTransform(({ body }) => normalizeMemberInput(body))
    .post('/auth/otp/send', async ({ body }) => {
      const services = servicesFactory();
      const seconds = await withDatabase(env, db => createAndSendOtp(env, db, services, body.email));
      return { message: "If this email is valid, you'll receive a verification code.", expires_in_seconds: seconds };
    }, { body: otpSendSchema, detail: { tags: ['Auth'] } })
    .post('/auth/otp/verify', async ({ body }) => {
      const services = servicesFactory();
      return withDatabase(env, async db => {
        await consumeOtp(env, db, services, body.email, body.code);
        const uid = await services.firebase.getOrCreateUser(body.email);
        const token = await services.firebase.createCustomToken(uid);
        const [member] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, uid)).limit(1);
        return { firebase_custom_token: token, is_new_user: !member, ubc_verified: isUbcEmail(body.email) };
      });
    }, { body: otpVerifySchema, detail: { tags: ['Auth'] } })
    .post('/auth/ubc-verify/send', async ({ body, request }) => {
      const services = servicesFactory();
      return withDatabase(env, async db => {
        const member = await requireMember(db, request, services.firebase);
        if (!isUbcEmail(body.email)) throw new ApiError(400, 'Must be a UBC email address (*.ubc.ca).');
        if (member.ubcVerified) throw new ApiError(400, 'Already verified.');
        const seconds = await createAndSendOtp(env, db, services, body.email);
        return { message: 'Verification code sent to your UBC email.', expires_in_seconds: seconds };
      });
    }, { body: otpSendSchema, detail: { tags: ['Auth'] } })
    .post('/auth/ubc-verify/confirm', async ({ body, request }) => {
      const services = servicesFactory();
      return withDatabase(env, async db => {
        const member = await requireMember(db, request, services.firebase);
        if (!isUbcEmail(body.email)) throw new ApiError(400, 'Must be a UBC email address (*.ubc.ca).');
        await consumeOtp(env, db, services, body.email, body.code);
        const [updated] = await db.update(users).set({ ubcVerified: true }).where(eq(users.id, member.id)).returning();
        return presentUser(updated!);
      });
    }, { body: otpVerifySchema, detail: { tags: ['Auth'] } });
}
