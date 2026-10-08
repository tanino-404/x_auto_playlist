// Pure URL matching for the MAIN-world interceptor. Query ids are ignored (they change every
// 2–4 weeks); only the GraphQL operation name is compared.

import { GRAPHQL_URL_PATTERN, TARGET_OPERATIONS } from "@/shared/constants";

const TARGETS: ReadonlySet<string> = new Set(TARGET_OPERATIONS);

/** Returns the operation name when `url` is a GraphQL call we forward, otherwise null. */
export function matchOperation(url: string): string | null {
  if (typeof url !== "string" || url === "") {
    return null;
  }
  let pathname: string;
  try {
    pathname = new URL(url, "https://x.com").pathname;
  } catch {
    return null;
  }
  const match = GRAPHQL_URL_PATTERN.exec(pathname);
  const operation = match?.[1];
  if (operation === undefined || !TARGETS.has(operation)) {
    return null;
  }
  return operation;
}

/** Parses an x-rate-limit-* header value. Missing or malformed → null. */
export function parseRateLimitHeader(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
