/**
 * api-client.ts
 *
 * Single-device login — global fetch interceptor.
 *
 * The backend enforces single-device sessions on EVERY authenticated route
 * (require-auth.ts): if drivers.active_session_id is set and the request's
 * `x-session-id` header does not match, it returns 401 { error:
 * "SESSION_REPLACED" }. Rather than thread the header through every one of the
 * ~13 api helper files (and risk missing one, which would 401-loop a driver on
 * their OWN device), we install a single global fetch wrapper that:
 *
 *   1. injects `x-session-id` into every request aimed at our API, and
 *   2. centrally detects a SESSION_REPLACED 401 and fires the registered
 *      handler (DriverContext wires this to signOut + redirect to /login).
 *
 * The interceptor is intentionally scoped: it only touches requests whose URL
 * targets our API (so Firebase SDK traffic is left completely untouched), and
 * only inspects response bodies for the SESSION_REPLACED 401 on those same
 * requests. Note: the SSE order stream uses react-native-sse (EventSource), not
 * fetch, so it injects `x-session-id` itself — see utils/order-stream.ts.
 */

import { getSessionIdSync, clearSessionId, isSessionRotating } from "@/utils/session";

const _rawDomain = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
const _cleanDomain = _rawDomain
  .replace(/^https?:\/\//i, "")
  .replace(/\/api\/?$/, "")
  .replace(/\/$/, "");

let _installed = false;
let _onReplaced: (() => void) | null = null;

/** Register the callback fired when the server reports SESSION_REPLACED. */
export function setSessionReplacedHandler(fn: () => void): void {
  _onReplaced = fn;
}

/** True when a request URL targets our own API (and not, e.g., Firebase). */
function targetsApi(url: string): boolean {
  if (!url) return false;
  if (_cleanDomain && url.includes(_cleanDomain)) return true;
  // Relative "/api/..." (web/dev) or any absolute URL containing "/api/".
  return url.includes("/api/") || url.endsWith("/api");
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  // Request object
  return (input as Request)?.url ?? "";
}

/**
 * Install the global fetch interceptor exactly once. Safe to call repeatedly —
 * subsequent calls are no-ops.
 */
export function installSessionFetchInterceptor(): void {
  if (_installed) return;
  _installed = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = urlOf(input);
    const isApi = targetsApi(url);
    // Verbose per-request logging is scoped to the auth endpoints so the flow can
    // be traced without flooding the console with every API call.
    const isAuthEndpoint = /\/auth\/(set-pin|verify-pin|verify-otp|send-otp)/.test(url);

    // ── 1. Inject x-session-id on outbound API requests ──────────────────────
    let sessionAttached = false;
    if (isApi) {
      const sid = getSessionIdSync();
      if (sid) {
        // Merge headers from BOTH init and (when input is a Request) the Request
        // object, so we never drop an Authorization header set by the caller.
        const headers = new Headers(
          (init && init.headers) ||
            (input instanceof Request ? input.headers : undefined) ||
            {},
        );
        if (!headers.has("x-session-id")) headers.set("x-session-id", sid);
        init = { ...(init ?? {}), headers };
        sessionAttached = true;
      }
    }

    if (isAuthEndpoint) {
      console.log("[INTERCEPTOR] → outgoing:", url, "| x-session-id attached:", sessionAttached ? "yes" : "no");
    }

    const res = await originalFetch(input, init);

    // ── 2. Detect SESSION_REPLACED on API 401s ───────────────────────────────
    if (isApi && res.status === 401) {
      try {
        const data = (await res.clone().json()) as { error?: string };
        if (data && data.error === "SESSION_REPLACED") {
          // Self-inflicted replacement during our OWN set-pin / re-sync session
          // rotation — a stale in-flight request lost the race to the new id.
          // Ignore it (do NOT sign out) so the new-user / forgot Set-MPIN flow
          // is not bounced back to /login while it is finishing.
          if (isSessionRotating()) {
            console.warn("[INTERCEPTOR] 401 SESSION_REPLACED during local session rotation on:", url, "→ suppressed (no signOut)");
          } else {
            console.warn("[INTERCEPTOR] 401 SESSION_REPLACED on:", url, "→ signOut trigger: yes");
            await clearSessionId();
            if (_onReplaced) _onReplaced();
          }
        } else if (isAuthEndpoint) {
          console.log("[INTERCEPTOR] 401 on:", url, "| error:", data?.error ?? "(none)", "→ signOut trigger: no");
        }
      } catch {
        // Body not JSON / already consumed — ignore; only SESSION_REPLACED matters.
      }
    }

    return res;
  };
}
