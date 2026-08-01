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
import {
  getFirebaseConfigError,
  signInWithCustomToken as firebaseSignInWithCustomToken,
  signInWithGoogle as firebaseSignInWithGoogle,
  signOut as firebaseSignOut,
  watchFirebaseAuth,
} from "~/lib/firebase";
import { createProfileHydrationCoordinator } from "~/lib/profile-hydration";

type OnboardingPayload = {
  preferred_name: string;
  major?: string;
  year_standing?: number;
  faculty?: string;
  interests?: string[];
  bio?: string;
};

type UpdateProfilePayload = {
  preferred_name?: string;
  major?: string | null;
  year_standing?: number | null;
  faculty?: string | null;
  interests?: string[];
  bio?: string | null;
};

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "onboarding"; uid: string }
  | { status: "member"; uid: string; profile: UserResponse };

type AuthContextValue = {
  state: AuthState;
  firebaseReady: boolean;
  firebaseConfigError: string | null;
  signInWithOtpToken: (customToken: string) => Promise<UserResponse | null>;
  signInWithGoogle: () => Promise<UserResponse | null>;
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

function authenticatedState(
  uid: string,
  profile: UserResponse | null
): AuthState {
  return profile
    ? { status: "member", uid, profile }
    : { status: "onboarding", uid };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const authRequestRef = useRef(0);
  const profileHydrationRef = useRef(createProfileHydrationCoordinator());
  const firebaseConfigError = getFirebaseConfigError();
  const firebaseReady = !firebaseConfigError;

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

  const hydrateFirebaseIdentity = useCallback(async (uid: string | null) => {
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
    if (!firebaseReady) {
      setState({ status: "anonymous" });
      return;
    }

    const unsubscribe = watchFirebaseAuth((firebaseUser) => {
      void hydrateFirebaseIdentity(firebaseUser?.uid ?? null);
    });

    return unsubscribe;
  }, [firebaseReady, hydrateFirebaseIdentity]);

  const waitForProfileHydration = useCallback(
    (uid: string, requestId: number) => {
      if (profileHydrationRef.current.needsRetry(uid, requestId)) {
        void hydrateFirebaseIdentity(uid);
      }
      return profileHydrationRef.current.wait(uid, requestId);
    },
    [hydrateFirebaseIdentity]
  );

  const signInWithOtpToken = useCallback(async (customToken: string) => {
    const requestId = authRequestRef.current;
    const user = await firebaseSignInWithCustomToken(customToken);
    return waitForProfileHydration(user.uid, requestId);
  }, [waitForProfileHydration]);

  const signInWithGoogle = useCallback(async () => {
    const requestId = authRequestRef.current;
    const user = await firebaseSignInWithGoogle();
    return waitForProfileHydration(user.uid, requestId);
  }, [waitForProfileHydration]);

  const signOut = useCallback(async () => {
    const requestId = authRequestRef.current + 1;
    authRequestRef.current = requestId;
    await firebaseSignOut();
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
    [state]
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
    [state]
  );

  const uploadProfilePhoto = useCallback(
    async (file: File) => {
      if (state.status !== "member") {
        throw new Error("Sign in before updating your profile photo.");
      }
      const resized = await resizeImage(file);
      const { upload_url, fields, max_file_size_bytes } =
        await api.users.presignedUpload();
      if (resized.size > max_file_size_bytes) {
        throw new Error("Profile photo is too large after compression.");
      }
      const formData = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, value);
      }
      formData.append("file", resized);
      const upload = await fetch(upload_url, {
        method: "POST",
        body: formData,
      });
      if (!upload.ok) {
        const text = await upload.text();
        console.error("S3 upload failed:", upload.status, text);
        throw new Error("Profile photo upload failed.");
      }
      return refreshProfile();
    },
    [refreshProfile, state.status]
  );

  const value = useMemo(
    () => ({
      state,
      firebaseReady,
      firebaseConfigError,
      signInWithOtpToken,
      signInWithGoogle,
      signOut,
      refreshProfile,
      completeOnboarding,
      updateProfile,
      uploadProfilePhoto,
    }),
    [
      completeOnboarding,
      firebaseConfigError,
      firebaseReady,
      refreshProfile,
      signInWithGoogle,
      signInWithOtpToken,
      signOut,
      state,
      updateProfile,
      uploadProfilePhoto,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
