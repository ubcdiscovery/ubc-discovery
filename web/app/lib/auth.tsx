import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, type UserResponse } from "~/lib/api";
import { resizeImage } from "~/lib/image";
import { uploadImage } from "~/lib/image-upload";
import { authClient, unwrap } from "~/lib/auth-client";
import { createProfileHydrationCoordinator } from "~/lib/profile-hydration";

type OnboardingPayload = {
  preferred_name: string;
  major?: string;
  academic_level?: string;
  faculty_id?: string;
  interests?: string[];
  bio?: string;
};

type UpdateProfilePayload = {
  preferred_name?: string;
  major?: string | null;
  academic_level?: string | null;
  faculty_id?: string | null;
  interests?: string[];
  bio?: string | null;
};

/** `uid` is the member's id (`users.id`). */
export type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "onboarding"; uid: string }
  | { status: "member"; uid: string; profile: UserResponse };

type AuthContextValue = {
  state: AuthState;
  sendSignInCode: (email: string) => Promise<{ expires_in_seconds: number }>;
  signInWithCode: (email: string, code: string) => Promise<UserResponse | null>;
  /** Leaves the page for Google; the session exists when the browser comes back. */
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<UserResponse | null>;
  completeOnboarding: (data: OnboardingPayload) => Promise<UserResponse>;
  updateProfile: (data: UpdateProfilePayload) => Promise<UserResponse>;
  uploadProfilePhoto: (file: File) => Promise<UserResponse | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfile() {
  try {
    return await api.users.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function authenticatedState(uid: string, profile: UserResponse | null): AuthState {
  return profile ? { status: "member", uid, profile } : { status: "onboarding", uid };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const authRequestRef = useRef(0);
  const profileHydrationRef = useRef(createProfileHydrationCoordinator());

  const refreshProfile = useCallback(async () => {
    if (state.status !== "onboarding" && state.status !== "member") return null;
    const uid = state.uid;
    const requestId = authRequestRef.current;
    const nextProfile = await loadProfile();
    if (authRequestRef.current === requestId) {
      setState(authenticatedState(uid, nextProfile));
    }
    return nextProfile;
  }, [state]);

  const hydrateIdentity = useCallback(async (uid: string | null) => {
    const requestId = authRequestRef.current + 1;
    authRequestRef.current = requestId;
    profileHydrationRef.current.identityChanged(uid, requestId);

    if (!uid) {
      setState({ status: "anonymous" });
      return;
    }

    try {
      const nextProfile = await loadProfile();
      if (authRequestRef.current !== requestId) return;
      setState(authenticatedState(uid, nextProfile));
      profileHydrationRef.current.resolve(uid, requestId, nextProfile);
    } catch (error) {
      if (authRequestRef.current === requestId) {
        setState({ status: "anonymous" });
        if (!profileHydrationRef.current.reject(uid, requestId, error)) {
          console.error("Failed to load authenticated profile.", error);
        }
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    authClient()
      .getSession()
      .then(({ data }) => {
        if (!cancelled) void hydrateIdentity(data?.user.id ?? null);
      })
      .catch((error: unknown) => {
        console.error("Failed to load the session.", error);
        if (!cancelled) void hydrateIdentity(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrateIdentity]);

  const sendSignInCode = useCallback(async (email: string) => {
    const response = await unwrap(
      authClient().emailOtp.sendVerificationOtp({ email, type: "sign-in" }),
    );
    // The API adds the code's lifetime to Better Auth's response.
    return response as typeof response & { expires_in_seconds: number };
  }, []);

  const signInWithCode = useCallback(
    async (email: string, code: string) => {
      const requestId = authRequestRef.current;
      const { user } = await unwrap(authClient().signIn.emailOtp({ email, otp: code }));
      void hydrateIdentity(user.id);
      return profileHydrationRef.current.wait(user.id, requestId);
    },
    [hydrateIdentity],
  );

  const signInWithGoogle = useCallback(async () => {
    const here = window.location.href;
    const failed = new URL(window.location.href);
    failed.searchParams.set("error", "google");
    // Better Auth navigates to Google itself once it has the authorization URL.
    await unwrap(
      authClient().signIn.social({
        provider: "google",
        callbackURL: here,
        errorCallbackURL: failed.toString(),
      }),
    );
  }, []);

  const signOut = useCallback(async () => {
    const requestId = authRequestRef.current + 1;
    authRequestRef.current = requestId;
    await unwrap(authClient().signOut());
    if (authRequestRef.current === requestId) {
      setState({ status: "anonymous" });
    }
  }, []);

  const completeOnboarding = useCallback(
    async (data: OnboardingPayload) => {
      if (state.status !== "onboarding" && state.status !== "member") {
        throw new Error("Sign in before completing onboarding.");
      }
      const uid = state.uid;
      const nextProfile = await api.users.onboarding(data);
      setState({ status: "member", uid, profile: nextProfile });
      return nextProfile;
    },
    [state],
  );

  const updateProfile = useCallback(
    async (data: UpdateProfilePayload) => {
      if (state.status !== "member") {
        throw new Error("Sign in before updating your profile.");
      }
      const nextProfile = await api.users.update(data);
      setState({ ...state, profile: nextProfile });
      return nextProfile;
    },
    [state],
  );

  const uploadProfilePhoto = useCallback(
    async (file: File) => {
      if (state.status !== "member") {
        throw new Error("Sign in before updating your profile photo.");
      }
      if (!file.size) throw new Error("Choose a non-empty image file.");
      const resized = await resizeImage(file);
      if (!resized.size) throw new Error("Profile photo is empty after compression.");
      const target = await api.users.presignedUpload(resized.size);
      if (resized.size > target.max_file_size_bytes) {
        throw new Error("Profile photo is too large after compression.");
      }
      try {
        await uploadImage(target, resized);
      } catch {
        throw new Error("Profile photo upload failed.");
      }
      return refreshProfile();
    },
    [refreshProfile, state.status],
  );

  const value = useMemo(
    () => ({
      state,
      sendSignInCode,
      signInWithCode,
      signInWithGoogle,
      signOut,
      refreshProfile,
      completeOnboarding,
      updateProfile,
      uploadProfilePhoto,
    }),
    [
      completeOnboarding,
      refreshProfile,
      sendSignInCode,
      signInWithCode,
      signInWithGoogle,
      signOut,
      state,
      updateProfile,
      uploadProfilePhoto,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
