import type { UserResponse } from "~/lib/api";

type Outcome =
  | { status: "success"; requestId: number; uid: string; profile: UserResponse | null }
  | { status: "error"; requestId: number; uid: string; error: unknown };

type Waiter = {
  afterRequestId: number;
  uid: string;
  resolve: (profile: UserResponse | null) => void;
  reject: (error: unknown) => void;
};

function identityChangedError() {
  return new Error("Firebase identity changed before sign-in completed.");
}

export function createProfileHydrationCoordinator() {
  let currentRequestId = 0;
  let currentUid: string | null = null;
  let outcome: Outcome | null = null;
  const waiters = new Set<Waiter>();

  return {
    identityChanged(uid: string | null, requestId: number) {
      currentRequestId = requestId;
      currentUid = uid;
      outcome = null;
      for (const waiter of waiters) {
        if (waiter.uid === uid) continue;
        waiters.delete(waiter);
        waiter.reject(identityChangedError());
      }
    },
    wait(uid: string, afterRequestId: number) {
      if (outcome && outcome.uid === uid && outcome.requestId > afterRequestId) {
        return outcome.status === "error"
          ? Promise.reject(outcome.error)
          : Promise.resolve(outcome.profile);
      }
      if (currentRequestId > afterRequestId && currentUid !== uid) {
        return Promise.reject(identityChangedError());
      }
      return new Promise<UserResponse | null>((resolve, reject) => {
        waiters.add({ afterRequestId, uid, resolve, reject });
      });
    },
    resolve(uid: string, requestId: number, profile: UserResponse | null) {
      outcome = { status: "success", requestId, uid, profile };
      for (const waiter of waiters) {
        if (waiter.uid !== uid || requestId <= waiter.afterRequestId) continue;
        waiters.delete(waiter);
        waiter.resolve(profile);
      }
    },
    reject(uid: string, requestId: number, error: unknown) {
      outcome = { status: "error", requestId, uid, error };
      let handled = false;
      for (const waiter of waiters) {
        if (waiter.uid !== uid || requestId <= waiter.afterRequestId) continue;
        handled = true;
        waiters.delete(waiter);
        waiter.reject(error);
      }
      return handled;
    },
  };
}
