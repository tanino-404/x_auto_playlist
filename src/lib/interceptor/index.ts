// MAIN-world interceptor (docs/architecture.md §4). Wraps XMLHttpRequest and fetch, and forwards
// the raw JSON of target GraphQL responses to the ISOLATED world via window.postMessage.
// It never interprets the JSON and never sends requests of its own (design principle 7).
// Everything is wrapped in try/catch so that X itself is never affected.
// Must not use chrome.* (not available in the MAIN world).

import { matchOperation, parseRateLimitHeader } from "@/lib/interceptor/match";
import { GRAPHQL_URL_PATTERN, POST_ACTION_OPERATIONS } from "@/shared/constants";
import type { InterceptedResponse, ObservedMutation } from "@/shared/messages";
import { INTERCEPT_MESSAGE_TYPE, OBSERVED_MUTATION_MESSAGE_TYPE } from "@/shared/messages";

export { matchOperation } from "@/lib/interceptor/match";

// Development-only diagnostic logging (never in production builds). This is the MAIN world, so
// `import.meta.env` support is unconfirmed elsewhere in the codebase; verified here to build fine.
const DEBUG = import.meta.env.DEV;

const MUTATION_URL_PATTERN = /\/i\/api\/graphql\/([\w-]+)\/([A-Za-z0-9_]+)(?:$|[/?#])/;
const MUTATIONS: ReadonlySet<string> = new Set(POST_ACTION_OPERATIONS);

/**
 * F-4C: when `url` is one of the post-action mutations (FavoriteTweet, …), returns its
 * operation name and query id so the isolated world can learn the id. Otherwise null.
 */
export function matchMutation(url: string): { operation: string; queryId: string } | null {
  if (typeof url !== "string" || url === "") {
    return null;
  }
  let pathname: string;
  try {
    pathname = new URL(url, "https://x.com").pathname;
  } catch {
    return null;
  }
  const match = MUTATION_URL_PATTERN.exec(pathname);
  const queryId = match?.[1];
  const operation = match?.[2];
  if (queryId === undefined || operation === undefined || !MUTATIONS.has(operation)) {
    return null;
  }
  return { operation, queryId };
}

/** The window.postMessage payload for an observed mutation URL, or null when not one. */
export function observedMutationMessage(url: string): ObservedMutation | null {
  const match = matchMutation(url);
  return match === null ? null : { type: OBSERVED_MUTATION_MESSAGE_TYPE, ...match };
}

/** Forwards an observed post-action mutation URL (never its body or response). */
function postObservedMutation(url: string): void {
  try {
    const message = observedMutationMessage(url);
    if (message !== null) {
      window.postMessage(message, location.origin);
    }
  } catch {
    // Never affect X.
  }
}

const INSTALLED_FLAG = "__xAutoPlaylistInterceptorInstalled";
const RATE_LIMITED_STATUS = 429;

interface TrackedXhr extends XMLHttpRequest {
  __xapUrl?: string;
}

function post(
  operation: string,
  url: string,
  status: number,
  body: unknown,
  remaining: string | null,
  reset: string | null,
): void {
  try {
    const message: InterceptedResponse = {
      type: INTERCEPT_MESSAGE_TYPE,
      operation,
      url,
      status,
      body,
      rateLimit: {
        remaining: parseRateLimitHeader(remaining),
        reset: parseRateLimitHeader(reset),
      },
      receivedAt: Date.now(),
    };
    window.postMessage(message, location.origin);
  } catch {
    // Ignore (e.g. body not structured-cloneable).
  }
}

/** Debug-only: extracts the raw GraphQL operation name regardless of whether it is a target. */
function extractGraphqlOperation(url: string): string | null {
  try {
    const pathname = new URL(url, location.origin).pathname;
    const match = GRAPHQL_URL_PATTERN.exec(pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function logSkip(url: string): void {
  if (!DEBUG) {
    return;
  }
  try {
    const raw = extractGraphqlOperation(url);
    if (raw !== null) {
      console.debug(`[XAP] skip ${raw}`);
    }
  } catch {
    // Ignore.
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readXhrBody(xhr: XMLHttpRequest): unknown {
  try {
    if (xhr.responseType === "json") {
      return xhr.response ?? null;
    }
    if (xhr.responseType === "" || xhr.responseType === "text") {
      return parseJson(xhr.responseText);
    }
  } catch {
    // Fall through.
  }
  return null;
}

function handleXhrLoad(xhr: TrackedXhr): void {
  try {
    const url = xhr.responseURL || xhr.__xapUrl || "";
    const operation = matchOperation(url);
    if (operation === null) {
      return;
    }
    const status = xhr.status;
    const body = status === RATE_LIMITED_STATUS ? null : readXhrBody(xhr);
    if (DEBUG) {
      try {
        const bytes = body === null || body === undefined ? 0 : JSON.stringify(body).length;
        console.debug(`[XAP] intercept XHR ${operation} status=${status} bytes=${bytes}`);
      } catch {
        // Ignore.
      }
    }
    post(
      operation,
      url,
      status,
      body,
      xhr.getResponseHeader("x-rate-limit-remaining"),
      xhr.getResponseHeader("x-rate-limit-reset"),
    );
  } catch {
    // Never affect X.
  }
}

function patchXhr(): void {
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;

  proto.open = function open(this: TrackedXhr, ...args: unknown[]) {
    try {
      const rawUrl = args[1];
      this.__xapUrl = rawUrl instanceof URL ? rawUrl.href : String(rawUrl);
      postObservedMutation(this.__xapUrl);
    } catch {
      // Ignore.
    }
    return (originalOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof proto.open;

  proto.send = function send(this: TrackedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      if (this.__xapUrl !== undefined) {
        if (matchOperation(this.__xapUrl) !== null) {
          this.addEventListener("load", () => handleXhrLoad(this), { once: true });
        } else {
          logSkip(this.__xapUrl);
        }
      }
    } catch {
      // Ignore.
    }
    return originalSend.call(this, body);
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

async function handleFetchResponse(operation: string, response: Response): Promise<void> {
  try {
    const status = response.status;
    let body: unknown = null;
    let bytes = 0;
    if (status !== RATE_LIMITED_STATUS) {
      const text = await response.clone().text();
      bytes = text.length;
      body = parseJson(text);
    }
    if (DEBUG) {
      console.debug(`[XAP] intercept fetch ${operation} status=${status} bytes=${bytes}`);
    }
    post(
      operation,
      response.url,
      status,
      body,
      response.headers.get("x-rate-limit-remaining"),
      response.headers.get("x-rate-limit-reset"),
    );
  } catch {
    // Never affect X.
  }
}

function patchFetch(): void {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function") {
    return;
  }
  window.fetch = function fetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const result = originalFetch.call(this ?? window, input, init);
    try {
      const url = requestUrl(input);
      postObservedMutation(url);
      const operation = matchOperation(url);
      if (operation !== null) {
        void result.then(
          (response) => handleFetchResponse(operation, response),
          () => undefined,
        );
      } else {
        logSkip(url);
      }
    } catch {
      // Ignore.
    }
    return result;
  } as typeof window.fetch;
}

export function installInterceptor(): void {
  try {
    const flags = window as unknown as Record<string, unknown>;
    if (flags[INSTALLED_FLAG] === true) {
      return;
    }
    flags[INSTALLED_FLAG] = true;
  } catch {
    return;
  }
  try {
    patchXhr();
  } catch {
    // Ignore.
  }
  try {
    patchFetch();
  } catch {
    // Ignore.
  }
}
