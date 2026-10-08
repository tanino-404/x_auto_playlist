// The ONLY place that knows the shape of X's GraphQL responses (docs/architecture.md §1-1, §6.1).
// Pure functions. Every lookup is defensive: a malformed element is skipped, never thrown on.
// When X changes its JSON, update this file and tests/fixtures/*.json together.

import type {
  Author,
  MediaKind,
  MediaMime,
  MediaSource,
  ParsedPost,
  PlaylistItem,
  PostFlags,
} from "@/shared/types";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Json | undefined {
  return isRecord(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Walks `path` through nested records. */
function dig(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

// ---------------------------------------------------------------------------------------------
// Locating tweets inside a timeline response
// ---------------------------------------------------------------------------------------------

/** Instruction types that carry timeline entries. */
const ENTRY_INSTRUCTION_TYPES = new Set([
  "TimelineAddEntries",
  "TimelineAddToModule",
  "TimelinePinEntry",
  "TimelineReplaceEntry",
]);

const MAX_DEPTH = 64;

/** Every array found under a key named "instructions", wherever it sits in the response. */
function findInstructionArrays(value: unknown, depth = 0, out: unknown[][] = []): unknown[][] {
  if (depth > MAX_DEPTH) {
    return out;
  }
  if (Array.isArray(value)) {
    for (const element of value) {
      findInstructionArrays(element, depth + 1, out);
    }
    return out;
  }
  if (!isRecord(value)) {
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "instructions" && Array.isArray(child)) {
      out.push(child);
    } else {
      findInstructionArrays(child, depth + 1, out);
    }
  }
  return out;
}

/** The entry-like objects of one instruction (entries[], moduleItems[], or a single entry). */
function instructionEntries(instruction: unknown): unknown[] {
  if (!isRecord(instruction)) {
    return [];
  }
  const type = instruction.type;
  if (typeof type === "string" && !ENTRY_INSTRUCTION_TYPES.has(type)) {
    return [];
  }
  const result: unknown[] = [];
  if (Array.isArray(instruction.entries)) {
    result.push(...instruction.entries);
  }
  if (Array.isArray(instruction.moduleItems)) {
    result.push(...instruction.moduleItems);
  }
  if (isRecord(instruction.entry)) {
    result.push(instruction.entry);
  }
  return result;
}

function isCursorEntry(entry: unknown): boolean {
  const entryId = asString(dig(entry, "entryId"));
  if (entryId?.startsWith("cursor-")) {
    return true;
  }
  const content = asRecord(dig(entry, "content"));
  return (
    content?.entryType === "TimelineTimelineCursor" ||
    content?.__typename === "TimelineTimelineCursor"
  );
}

/**
 * Ads: an entry (or module item) whose entryId starts with "promoted-", or an itemContent
 * carrying promotedMetadata. Their media lives in a card we do not read, so they are dropped.
 */
function isPromoted(record: Json): boolean {
  const entryId = record.entryId;
  if (typeof entryId === "string" && entryId.startsWith("promoted-")) {
    return true;
  }
  return record.promotedMetadata !== undefined && record.promotedMetadata !== null;
}

function isPromotedEntry(entry: unknown): boolean {
  if (!isRecord(entry)) {
    return false;
  }
  const itemContent = asRecord(dig(entry, "content", "itemContent"));
  const moduleItemContent = asRecord(dig(entry, "item", "itemContent"));
  return (
    isPromoted(entry) ||
    (itemContent !== undefined && isPromoted(itemContent)) ||
    (moduleItemContent !== undefined && isPromoted(moduleItemContent))
  );
}

/**
 * Every `tweet_results.result` below `value`. Does not descend into a found result, so
 * quoted/retweeted posts are handled by parseTweetResults rather than found twice.
 * Promoted items (e.g. inside a module) are skipped.
 */
function findTweetResults(value: unknown, depth = 0, out: unknown[] = []): unknown[] {
  if (depth > MAX_DEPTH) {
    return out;
  }
  if (Array.isArray(value)) {
    for (const element of value) {
      findTweetResults(element, depth + 1, out);
    }
    return out;
  }
  if (!isRecord(value) || isPromoted(value)) {
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "tweet_results") {
      const result = dig(child, "result");
      if (result !== undefined) {
        out.push(result);
      }
    } else {
      findTweetResults(child, depth + 1, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// One tweet
// ---------------------------------------------------------------------------------------------

/** Unwraps TweetWithVisibilityResults; returns undefined for tombstones / unavailable posts. */
function unwrapTweet(result: unknown, depth = 0): Json | undefined {
  const record = asRecord(result);
  if (record === undefined || depth > 4) {
    return undefined;
  }
  switch (record.__typename) {
    case "TweetWithVisibilityResults":
      return unwrapTweet(record.tweet, depth + 1);
    case "TweetTombstone":
    case "TweetUnavailable":
      return undefined;
    case "Tweet":
    case undefined:
      return asString(record.rest_id) !== undefined ? record : undefined;
    default:
      // Unknown typename: accept it only if it looks like a tweet.
      return asString(record.rest_id) !== undefined && isRecord(record.legacy) ? record : undefined;
  }
}

/** Author, preferring the 2026-07 structure (core.* / avatar.*) over legacy.*. */
function parseAuthor(tweet: Json): Author {
  const raw = asRecord(dig(tweet, "core", "user_results", "result"));
  const user = raw?.__typename === "UserWithVisibilityResults" ? asRecord(raw.user) : raw;
  const core = asRecord(user?.core);
  const legacy = asRecord(user?.legacy);
  return {
    name: asString(core?.name) ?? asString(legacy?.name) ?? "",
    screenName: asString(core?.screen_name) ?? asString(legacy?.screen_name) ?? "",
    avatarUrl:
      asString(dig(user, "avatar", "image_url")) ?? asString(legacy?.profile_image_url_https) ?? "",
  };
}

/** Full text: note_tweet (long posts) wins over legacy.full_text. */
function parseText(tweet: Json): string {
  return (
    asString(dig(tweet, "note_tweet", "note_tweet_results", "result", "text")) ??
    asString(dig(tweet, "legacy", "full_text")) ??
    ""
  );
}

function withNameParam(url: string, name: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("name", name);
    return parsed.href;
  } catch {
    return `${url}${url.includes("?") ? "&" : "?"}name=${name}`;
  }
}

function imageMime(url: string): MediaMime {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Keep the raw string.
  }
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

/** Resolution embedded in mp4 URLs, e.g. /vid/avc1/640x336/… */
function resolutionFromUrl(url: string): { width: number; height: number } | undefined {
  const match = /\/(\d{2,5})x(\d{2,5})\//.exec(url);
  if (match?.[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** mp4 by bitrate (high → low), then HLS playlists (kept for later stages). */
function parseVideoSources(media: Json): MediaSource[] {
  const variants = dig(media, "video_info", "variants");
  if (!Array.isArray(variants)) {
    return [];
  }
  const mp4: MediaSource[] = [];
  const hls: MediaSource[] = [];
  for (const variant of variants) {
    const url = asString(dig(variant, "url"));
    const contentType = asString(dig(variant, "content_type"));
    if (url === undefined) {
      continue;
    }
    if (contentType === "video/mp4") {
      const source: MediaSource = { url, mime: "video/mp4" };
      const bitrate = asNumber(dig(variant, "bitrate"));
      if (bitrate !== undefined) {
        source.bitrate = bitrate;
      }
      const size = resolutionFromUrl(url);
      if (size !== undefined) {
        source.width = size.width;
        source.height = size.height;
      }
      mp4.push(source);
    } else if (contentType === "application/x-mpegURL") {
      hls.push({ url, mime: "application/x-mpegURL" });
    }
  }
  mp4.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  return [...mp4, ...hls];
}

function mediaKind(type: unknown): MediaKind | undefined {
  switch (type) {
    case "photo":
      return "photo";
    case "video":
      return "video";
    case "animated_gif":
      return "gif";
    default:
      return undefined;
  }
}

interface PostContext {
  postId: string;
  postUrl: string;
  author: Author;
  text: string;
  now: number;
  post?: PostFlags;
}

function parseMedia(media: unknown, ctx: PostContext): PlaylistItem | null {
  if (!isRecord(media)) {
    return null;
  }
  const kind = mediaKind(media.type);
  const id = asString(media.media_key) ?? asString(media.id_str);
  const baseUrl = asString(media.media_url_https);
  if (kind === undefined || id === undefined) {
    return null;
  }

  let sources: MediaSource[];
  let thumbnailUrl: string;
  let durationMs: number | undefined;
  if (kind === "photo") {
    if (baseUrl === undefined) {
      return null;
    }
    const source: MediaSource = { url: withNameParam(baseUrl, "large"), mime: imageMime(baseUrl) };
    const width = asNumber(dig(media, "original_info", "width"));
    const height = asNumber(dig(media, "original_info", "height"));
    if (width !== undefined && height !== undefined) {
      source.width = width;
      source.height = height;
    }
    sources = [source];
    thumbnailUrl = withNameParam(baseUrl, "small");
  } else {
    sources = parseVideoSources(media);
    thumbnailUrl = baseUrl ?? "";
    durationMs = asNumber(dig(media, "video_info", "duration_millis"));
  }

  const item: PlaylistItem = {
    id,
    kind,
    postId: ctx.postId,
    postUrl: ctx.postUrl,
    author: ctx.author,
    text: ctx.text,
    thumbnailUrl,
    sources,
    playable: sources.some(
      (source) => source.mime === "video/mp4" || source.mime.startsWith("image/"),
    ),
    addedAt: ctx.now,
  };
  if (durationMs !== undefined) {
    item.durationMs = durationMs;
  }
  if (ctx.post !== undefined) {
    item.post = { ...ctx.post };
  }
  return item;
}

function mediaList(tweet: Json): unknown[] {
  const extended = dig(tweet, "legacy", "extended_entities", "media");
  if (Array.isArray(extended)) {
    return extended;
  }
  const basic = dig(tweet, "legacy", "entities", "media");
  return Array.isArray(basic) ? basic : [];
}

/**
 * The viewer's like / bookmark / repost state of this tweet (F-4C). Omitted when none of the
 * three flags is present (state unknown); a missing individual flag counts as false.
 */
function parsePostFlags(tweet: Json): PostFlags | undefined {
  const legacy = asRecord(tweet.legacy);
  const favorited = legacy?.favorited;
  const bookmarked = legacy?.bookmarked;
  const retweeted = legacy?.retweeted;
  if (
    typeof favorited !== "boolean" &&
    typeof bookmarked !== "boolean" &&
    typeof retweeted !== "boolean"
  ) {
    return undefined;
  }
  return {
    favorited: favorited === true,
    bookmarked: bookmarked === true,
    retweeted: retweeted === true,
  };
}

/** The tweet itself, without following reposts/quotes. */
function parseSingleTweet(tweet: Json, now: number): ParsedPost | null {
  const postId = asString(tweet.rest_id) ?? asString(dig(tweet, "legacy", "id_str"));
  if (postId === undefined) {
    return null;
  }
  const author = parseAuthor(tweet);
  const ctx: PostContext = {
    postId,
    postUrl:
      author.screenName !== ""
        ? `https://x.com/${author.screenName}/status/${postId}`
        : `https://x.com/i/status/${postId}`,
    author,
    text: parseText(tweet),
    now,
  };
  const post = parsePostFlags(tweet);
  if (post !== undefined) {
    ctx.post = post;
  }
  const items: PlaylistItem[] = [];
  for (const media of mediaList(tweet)) {
    try {
      const item = parseMedia(media, ctx);
      if (item !== null) {
        items.push(item);
      }
    } catch {
      // Skip this media only.
    }
  }
  return { postId, items };
}

/**
 * One `tweet_results.result` → the posts it shows on screen: for a repost, the original post
 * (the media lives there); for a quote, the quoting post followed by the quoted post.
 * Posts without media are returned too (with `items: []`) so the post cache knows them.
 */
export function parseTweetResults(result: unknown, now: number = Date.now()): ParsedPost[] {
  const tweet = unwrapTweet(result);
  if (tweet === undefined) {
    return [];
  }
  const retweeted = dig(tweet, "legacy", "retweeted_status_result", "result");
  if (retweeted !== undefined) {
    const expanded = parseTweetResults(retweeted, now);
    if (expanded.length > 0) {
      return expanded;
    }
  }
  const posts: ParsedPost[] = [];
  const main = parseSingleTweet(tweet, now);
  if (main !== null) {
    posts.push(main);
  }
  const quoted = unwrapTweet(dig(tweet, "quoted_status_result", "result"));
  if (quoted !== undefined) {
    const quotedPost = parseSingleTweet(quoted, now);
    if (quotedPost !== null) {
      posts.push(quotedPost);
    }
  }
  return posts;
}

/** The primary post of one `tweet_results.result` (the original, for a repost). */
export function parseTweetResult(result: unknown, now: number = Date.now()): ParsedPost | null {
  return parseTweetResults(result, now)[0] ?? null;
}

export interface TimelineInspection {
  posts: ParsedPost[];
  /** At least one `instructions` array was found. */
  instructionsFound: boolean;
  /** Entries other than cursors and ads (tweets, modules, tombstones, …). */
  contentEntryCount: number;
}

/**
 * Parses a response and reports how much of it was recognisable. The pipeline's health check
 * uses this to tell "the timeline simply has nothing more" (only cursors) apart from
 * "we can no longer read it".
 */
export function inspectTimelineResponse(
  body: unknown,
  now: number = Date.now(),
): TimelineInspection {
  const posts: ParsedPost[] = [];
  const seen = new Set<string>();
  let instructionsFound = false;
  let contentEntryCount = 0;

  for (const instructions of findInstructionArrays(body)) {
    instructionsFound = true;
    for (const instruction of instructions) {
      for (const entry of instructionEntries(instruction)) {
        try {
          if (isCursorEntry(entry) || isPromotedEntry(entry)) {
            continue;
          }
          contentEntryCount++;
          for (const result of findTweetResults(entry)) {
            for (const post of parseTweetResults(result, now)) {
              if (!seen.has(post.postId)) {
                seen.add(post.postId);
                posts.push(post);
              }
            }
          }
        } catch {
          // Skip this entry only.
        }
      }
    }
  }
  return { posts, instructionsFound, contentEntryCount };
}

/** All posts in a timeline-like GraphQL response, in order, deduped by postId. */
export function parseTimelineResponse(body: unknown, now: number = Date.now()): ParsedPost[] {
  return inspectTimelineResponse(body, now).posts;
}
