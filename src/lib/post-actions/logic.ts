// Pure helpers for post actions (F-4C, docs/architecture.md §6.8). No DOM, no chrome.*.

import type { PostActionOperation } from "@/shared/constants";
import { POST_ACTION_OPERATIONS, X_WEB_BEARER } from "@/shared/constants";
import type { PostFlags } from "@/shared/types";

export type PostAction = "like" | "bookmark" | "repost";

export type PostActionFailure =
  | "disabled"
  | "no-query-id"
  | "unauthorized"
  | "rate-limited"
  | "network"
  /** X error code 226: the request looked automated. */
  | "automation-suspected"
  | "unknown";

export type PostActionResult =
  | { ok: true; action: PostAction; on: boolean }
  | {
      ok: false;
      action: PostAction;
      reason: PostActionFailure;
      status?: number;
      /** X's error code from the response body (226 wins over others), when present. */
      code?: number;
    };

export type QueryIds = Partial<Record<PostActionOperation, string>>;

const OPERATION_SET: ReadonlySet<string> = new Set(POST_ACTION_OPERATIONS);
const QUERY_ID_PATTERN = /^[\w-]+$/;

export function isPostActionOperation(value: string): value is PostActionOperation {
  return OPERATION_SET.has(value);
}

export function isValidQueryId(value: string): boolean {
  return QUERY_ID_PATTERN.test(value);
}

const OPS = POST_ACTION_OPERATIONS.join("|");
const QUOTE = `["']`;
const FORWARD = new RegExp(
  String.raw`queryId\s*:\s*${QUOTE}([\w-]+)${QUOTE}\s*,\s*operationName\s*:\s*${QUOTE}(${OPS})${QUOTE}`,
  "g",
);
const REVERSE = new RegExp(
  String.raw`operationName\s*:\s*${QUOTE}(${OPS})${QUOTE}\s*,\s*queryId\s*:\s*${QUOTE}([\w-]+)${QUOTE}`,
  "g",
);

/**
 * Scans X's client bundle source for the query ids of the six post-action mutations, e.g.
 * `e.exports={queryId:"lI07N6Otwv1PhnEgXILM7A",operationName:"FavoriteTweet",…}`.
 * Both key orders are accepted. The first occurrence of an operation wins.
 */
export function extractQueryIds(source: string): QueryIds {
  const ids: QueryIds = {};
  if (typeof source !== "string" || source === "") {
    return ids;
  }
  for (const match of source.matchAll(FORWARD)) {
    const [, queryId, operation] = match;
    if (queryId !== undefined && operation !== undefined && isPostActionOperation(operation)) {
      ids[operation] ??= queryId;
    }
  }
  for (const match of source.matchAll(REVERSE)) {
    const [, operation, queryId] = match;
    if (queryId !== undefined && operation !== undefined && isPostActionOperation(operation)) {
      ids[operation] ??= queryId;
    }
  }
  return ids;
}

export function hasAllQueryIds(ids: QueryIds): boolean {
  return POST_ACTION_OPERATIONS.every((operation) => typeof ids[operation] === "string");
}

/** The flag an action toggles. */
export function flagOf(action: PostAction): keyof PostFlags {
  switch (action) {
    case "like":
      return "favorited";
    case "bookmark":
      return "bookmarked";
    case "repost":
      return "retweeted";
  }
}

/** Mutation for turning `action` on or off. */
export function operationFor(action: PostAction, on: boolean): PostActionOperation {
  switch (action) {
    case "like":
      return on ? "FavoriteTweet" : "UnfavoriteTweet";
    case "bookmark":
      return on ? "CreateBookmark" : "DeleteBookmark";
    case "repost":
      return on ? "CreateRetweet" : "DeleteRetweet";
  }
}

export function variablesFor(
  operation: PostActionOperation,
  postId: string,
): Record<string, unknown> {
  switch (operation) {
    case "CreateRetweet":
      return { tweet_id: postId, dark_request: false };
    case "DeleteRetweet":
      // X's web client sends `source_tweet_id` for DeleteRetweet; `tweet_id` is kept as well
      // (unused variables are ignored by the server).
      return { tweet_id: postId, source_tweet_id: postId, dark_request: false };
    default:
      return { tweet_id: postId };
  }
}

export interface PostActionRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string>; body: string };
}

export function buildRequest(
  operation: PostActionOperation,
  queryId: string,
  postId: string,
  csrfToken: string,
  language = "ja",
): PostActionRequest {
  return {
    url: `https://x.com/i/api/graphql/${queryId}/${operation}`,
    init: {
      method: "POST",
      credentials: "include",
      headers: {
        authorization: `Bearer ${X_WEB_BEARER}`,
        "x-csrf-token": csrfToken,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": language,
        "content-type": "application/json",
      },
      body: JSON.stringify({ variables: variablesFor(operation, postId), queryId }),
    },
  };
}

/** Value of the ct0 cookie (X's CSRF token), or null when logged out. */
export function readCsrfToken(cookie: string): string | null {
  for (const part of cookie.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (rawName?.trim() === "ct0") {
      const value = rest.join("=").trim();
      return value === "" ? null : decodeURIComponent(value);
    }
  }
  return null;
}

export type ResponseVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: Exclude<PostActionFailure, "disabled" | "network">;
      status: number;
      code?: number;
      /** errors[0].message, for logging. */
      message?: string;
    };

const AUTOMATION_SUSPECTED_CODE = 226;

/** HTTP status + parsed body → success or failure reason. 200 with `errors` is a failure. */
export function classifyResponse(status: number, body: unknown): ResponseVerdict {
  if (status === 401 || status === 403) {
    return { ok: false, reason: "unauthorized", status };
  }
  if (status === 429) {
    return { ok: false, reason: "rate-limited", status };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, reason: "unknown", status };
  }
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "unknown", status };
  }
  const errors = (body as { errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const codes = errors.map((error) => (error as { code?: unknown } | null)?.code);
    const first = errors[0] as { code?: unknown; message?: unknown } | null;
    const verdict: ResponseVerdict = {
      ok: false,
      reason: codes.includes(AUTOMATION_SUSPECTED_CODE) ? "automation-suspected" : "unknown",
      status,
    };
    const code = codes.includes(AUTOMATION_SUSPECTED_CODE)
      ? AUTOMATION_SUSPECTED_CODE
      : first?.code;
    if (typeof code === "number") {
      verdict.code = code;
    }
    if (typeof first?.message === "string") {
      verdict.message = first.message;
    }
    return verdict;
  }
  return { ok: true };
}

const SUCCESS_TEXT: Record<PostAction, [on: string, off: string]> = {
  like: ["いいねしました", "いいねを取り消しました"],
  bookmark: ["ブックマークしました", "ブックマークを解除しました"],
  repost: ["リポストしました", "リポストを取り消しました"],
};

const FAILURE_VERB: Record<PostAction, [on: string, off: string]> = {
  like: ["いいねできませんでした", "いいねを取り消せませんでした"],
  bookmark: ["ブックマークできませんでした", "ブックマークを解除できませんでした"],
  repost: ["リポストできませんでした", "リポストを取り消せませんでした"],
};

const FAILURE_REASON: Record<PostActionFailure, string> = {
  disabled: "（設定で無効になっています）",
  "no-query-id": "（X の操作情報を取得できませんでした）",
  unauthorized: "（ログインが必要です）",
  "rate-limited": "（回数制限中です。しばらく待ってください）",
  network: "（通信エラー）",
  "automation-suspected": "（X が自動操作と判定しました。しばらく時間を置いてください）",
  unknown: "（X がエラーを返しました）",
};

/** Toast text for a result. `on` is the requested state (true = like / bookmark / repost). */
export function noticeText(result: PostActionResult, on: boolean): string {
  const index = on ? 0 : 1;
  if (result.ok) {
    return SUCCESS_TEXT[result.action][index];
  }
  if (result.status === 404) {
    // X refuses this mutation without its own signature header (seen with CreateBookmark).
    return `${FAILURE_VERB[result.action][index]}（X 側の制限のため、この操作は現在使えません）`;
  }
  return FAILURE_VERB[result.action][index] + FAILURE_REASON[result.reason];
}

/** x-twitter-client-language: the first two letters of navigator.language (default "ja"). */
export function clientLanguage(language: string | undefined): string {
  const code = (language ?? "").slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : "ja";
}
