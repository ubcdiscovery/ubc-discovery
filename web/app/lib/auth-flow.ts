const AUTH_FLOW_KEY = "ubc-discovery-auth-flow";
const AUTH_FLOW_VERSION = 1;
const AUTH_FLOW_TTL_MS = 24 * 60 * 60 * 1000;

type PostAuthActionStatus = "pending" | "failed";

export type PostAuthAction = {
  id: string;
  type: string;
  payload: unknown;
  status: PostAuthActionStatus;
  attempts: number;
};

export type AuthFlowNotice = {
  type: "onboarding-complete";
  preferredName: string;
};

export type AuthFlow = {
  version: typeof AUTH_FLOW_VERSION;
  returnTo: string;
  actions: PostAuthAction[];
  notice?: AuthFlowNotice;
  createdAt: number;
  updatedAt: number;
};

type NewPostAuthAction = {
  type: string;
  payload: unknown;
};

export type StartAuthFlowInput = {
  returnTo: string;
  actions?: NewPostAuthAction[];
};

export type AuthFlowCompletion = {
  returnTo: string;
  hasRemainingActions: boolean;
  notice?: AuthFlowNotice;
};

function getSessionStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function removeStorageItem(key: string) {
  try {
    getSessionStorage()?.removeItem(key);
  } catch {
    // Authentication still works when browser storage is unavailable.
  }
}

function createActionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPostAuthAction(value: unknown): value is PostAuthAction {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.type === "string" &&
    value.type.length > 0 &&
    "payload" in value &&
    (value.status === "pending" || value.status === "failed") &&
    typeof value.attempts === "number" &&
    Number.isInteger(value.attempts) &&
    value.attempts >= 0
  );
}

function isAuthFlowNotice(value: unknown): value is AuthFlowNotice {
  return (
    isRecord(value) &&
    value.type === "onboarding-complete" &&
    typeof value.preferredName === "string" &&
    value.preferredName.length > 0
  );
}

function validateAuthReturnTo(candidate: string | null | undefined) {
  if (!candidate || typeof window === "undefined") return null;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function parseAuthFlow(value: string | null): AuthFlow | null {
  if (!value) return null;
  try {
    const flow: unknown = JSON.parse(value);
    if (
      !isRecord(flow) ||
      flow.version !== AUTH_FLOW_VERSION ||
      !validateAuthReturnTo(
        typeof flow.returnTo === "string" ? flow.returnTo : null
      ) ||
      !Array.isArray(flow.actions) ||
      !flow.actions.every(isPostAuthAction) ||
      ("notice" in flow &&
        flow.notice !== undefined &&
        !isAuthFlowNotice(flow.notice)) ||
      typeof flow.createdAt !== "number" ||
      typeof flow.updatedAt !== "number"
    ) {
      return null;
    }
    return flow as AuthFlow;
  } catch {
    return null;
  }
}

function writeAuthFlow(flow: AuthFlow) {
  const storage = getSessionStorage();
  if (!storage) return false;
  try {
    storage.setItem(AUTH_FLOW_KEY, JSON.stringify(flow));
    return true;
  } catch {
    return false;
  }
}

export function readAuthFlow(): AuthFlow | null {
  const storage = getSessionStorage();
  if (!storage) return null;

  let storedValue: string | null;
  try {
    storedValue = storage.getItem(AUTH_FLOW_KEY);
  } catch {
    return null;
  }

  if (!storedValue) return null;

  const flow = parseAuthFlow(storedValue);
  if (!flow || Date.now() - flow.updatedAt > AUTH_FLOW_TTL_MS) {
    removeStorageItem(AUTH_FLOW_KEY);
    return null;
  }
  return flow;
}

export function startAuthFlow({ returnTo, actions = [] }: StartAuthFlowInput) {
  const safeReturnTo = validateAuthReturnTo(returnTo) ?? "/";
  const now = Date.now();
  const flow: AuthFlow = {
    version: AUTH_FLOW_VERSION,
    returnTo: safeReturnTo,
    actions: actions.map((action) => ({
      id: createActionId(),
      type: action.type,
      payload: action.payload ?? null,
      status: "pending",
      attempts: 0,
    })),
    createdAt: now,
    updatedAt: now,
  };
  writeAuthFlow(flow);
  return flow;
}

export function rememberAuthReturnTo(candidate: string | null | undefined) {
  const returnTo = validateAuthReturnTo(candidate);
  if (!returnTo) return null;

  const current = readAuthFlow();
  if (!current) {
    startAuthFlow({ returnTo });
    return returnTo;
  }
  writeAuthFlow({ ...current, returnTo, updatedAt: Date.now() });
  return returnTo;
}

export function setAuthFlowNotice(notice: AuthFlowNotice) {
  const current = readAuthFlow();
  if (!current) {
    const flow = startAuthFlow({ returnTo: "/" });
    writeAuthFlow({ ...flow, notice, updatedAt: Date.now() });
    return;
  }
  writeAuthFlow({ ...current, notice, updatedAt: Date.now() });
}

export function clearAuthFlowNotice() {
  const current = readAuthFlow();
  if (!current?.notice) return;
  const { notice: _notice, ...flow } = current;
  writeAuthFlow({ ...flow, updatedAt: Date.now() });
}

export function completeAuthFlow(): AuthFlowCompletion | null {
  const flow = readAuthFlow();
  if (!flow) return null;
  clearAuthFlow();
  return {
    returnTo: flow.returnTo,
    hasRemainingActions: false,
    notice: flow.notice,
  };
}

function updateAuthAction(
  actionId: string,
  update: (action: PostAuthAction) => PostAuthAction
) {
  const flow = readAuthFlow();
  if (!flow || !flow.actions.some((action) => action.id === actionId)) {
    return null;
  }
  const next: AuthFlow = {
    ...flow,
    actions: flow.actions.map((action) =>
      action.id === actionId ? update(action) : action
    ),
    updatedAt: Date.now(),
  };
  writeAuthFlow(next);
  return next;
}

export function markAuthActionFailed(actionId: string) {
  return updateAuthAction(actionId, (action) => ({
    ...action,
    status: "failed",
    attempts: action.attempts + 1,
  }));
}

export function retryAuthAction(actionId: string) {
  return updateAuthAction(actionId, (action) => ({
    ...action,
    status: "pending",
  }));
}

export function completeAuthAction(
  actionId: string
): AuthFlowCompletion | null {
  const flow = readAuthFlow();
  if (!flow) return null;
  const actions = flow.actions.filter((action) => action.id !== actionId);
  if (actions.length === flow.actions.length) return null;

  if (actions.length === 0) {
    clearAuthFlow();
  } else {
    writeAuthFlow({ ...flow, actions, updatedAt: Date.now() });
  }
  return {
    returnTo: flow.returnTo,
    hasRemainingActions: actions.length > 0,
    notice: flow.notice,
  };
}

function clearAuthFlow() {
  removeStorageItem(AUTH_FLOW_KEY);
}
