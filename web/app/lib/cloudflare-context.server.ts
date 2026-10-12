import { createContext } from "react-router";

/** React Router 8 uses typed context providers for server bindings. */
export const cloudflareContext = createContext<{
  env: CloudflareEnvironment;
  ctx: ExecutionContext;
}>();
