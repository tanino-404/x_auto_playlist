// Shared file: edited by the PL only.
// Message contracts between the service worker, the isolated content script,
// and the MAIN-world interceptor.

/** Service worker → content script (chrome.tabs.sendMessage). */
export type SwToContentMessage =
  | { type: "TOGGLE_PANEL" }
  | { type: "ADD_FROM_CONTEXT"; position: "end" | "next" };

/** Content script → service worker (chrome.runtime.sendMessage). */
export type ContentToSwMessage =
  | { type: "SET_BADGE"; count: number }
  | { type: "PANEL_STATE"; open: boolean };

/** Reply shape for request/response style messages. */
export interface Ack {
  ok: boolean;
  error?: string;
}

/** Context menu item ids registered by the service worker. */
export const CONTEXT_MENU_IDS = {
  addToEnd: "xap-add-to-end",
  addNext: "xap-add-next",
} as const;

/**
 * MAIN world → isolated world (window.postMessage).
 * The interceptor never interprets the JSON; it forwards it as-is.
 */
export const INTERCEPT_MESSAGE_TYPE = "x-auto-playlist:graphql-response" as const;

export interface InterceptedResponse {
  type: typeof INTERCEPT_MESSAGE_TYPE;
  /** GraphQL operation name, e.g. "HomeTimeline". */
  operation: string;
  url: string;
  status: number;
  /** Raw JSON body. */
  body: unknown;
  rateLimit: {
    remaining: number | null;
    /** Unix seconds. */
    reset: number | null;
  };
  receivedAt: number;
}

/**
 * MAIN world → isolated world: a post-action mutation request was observed on the page
 * (the user liked / bookmarked / reposted natively). Only the URL is forwarded so the
 * query id can be learned; bodies are never read.
 */
export const OBSERVED_MUTATION_MESSAGE_TYPE = "x-auto-playlist:observed-mutation" as const;

export interface ObservedMutation {
  type: typeof OBSERVED_MUTATION_MESSAGE_TYPE;
  operation: string;
  queryId: string;
}

export function isObservedMutation(value: unknown): value is ObservedMutation {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === OBSERVED_MUTATION_MESSAGE_TYPE &&
    typeof (value as { queryId?: unknown }).queryId === "string"
  );
}

export function isInterceptedResponse(value: unknown): value is InterceptedResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === INTERCEPT_MESSAGE_TYPE &&
    typeof (value as { operation?: unknown }).operation === "string"
  );
}
