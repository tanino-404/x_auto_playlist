// ISOLATED-world receiver for responses forwarded by the MAIN-world interceptor.

import type { InterceptedResponse, ObservedMutation } from "@/shared/messages";
import { isInterceptedResponse, isObservedMutation } from "@/shared/messages";

// Development-only diagnostic logging; stripped from production builds.
const DEBUG = import.meta.env.DEV;

/** Subscribes to forwarded GraphQL responses. Returns an unsubscribe function. */
export function listenInterceptedResponses(
  handler: (response: InterceptedResponse) => void,
): () => void {
  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isInterceptedResponse(event.data)) {
      return;
    }
    if (DEBUG) {
      console.debug(`[XAP] received ${event.data.operation} status=${event.data.status}`);
    }
    try {
      handler(event.data);
    } catch (error) {
      console.warn("x-auto-playlist: failed to handle intercepted response", error);
    }
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/**
 * Subscribes to post-action mutation URLs observed by the MAIN-world interceptor (F-4C: used to
 * learn query ids). Returns an unsubscribe function.
 */
export function listenObservedMutations(handler: (mutation: ObservedMutation) => void): () => void {
  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isObservedMutation(event.data)) {
      return;
    }
    try {
      handler(event.data);
    } catch (error) {
      console.warn("x-auto-playlist: failed to handle observed mutation", error);
    }
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
