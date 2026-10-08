// Shared file: edited by the PL only. Data model from docs/architecture.md §5.

export type MediaKind = "video" | "gif" | "photo";

export type MediaMime =
  | "video/mp4"
  | "application/x-mpegURL"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface MediaSource {
  url: string;
  mime: MediaMime;
  /** mp4 only. Used to order qualities. */
  bitrate?: number;
  width?: number;
  height?: number;
}

export interface Author {
  name: string;
  screenName: string;
  avatarUrl: string;
}

export interface PlaylistItem {
  /** media_key (falls back to id_str). Dedupe key. */
  id: string;
  kind: MediaKind;
  postId: string;
  postUrl: string;
  author: Author;
  /** Full text. The UI truncates it. */
  text: string;
  thumbnailUrl: string;
  durationMs?: number;
  /** Ordered high → low quality. */
  sources: MediaSource[];
  /** True when an mp4 or an image source exists. */
  playable: boolean;
  addedAt: number;
  /** Like / bookmark / repost state of the source post, when known (F-4C). */
  post?: PostFlags;
}

/** One post with all of its media (max 4). Stored in the post cache. */
export interface ParsedPost {
  postId: string;
  items: PlaylistItem[];
}

export type PlaylistMode = "auto" | "manual";

export interface AutoPlaylist {
  pageKey: string;
  items: PlaylistItem[];
}

export interface ManualPlaylist {
  items: PlaylistItem[];
  /** F-52: the last item that was played. */
  lastPlayedId: string | null;
}

export type PlaybackStatus = "idle" | "playing" | "paused";
export type LoopMode = "all" | "one" | "off";

/** Default-quality choices (Settings S-10). */
export type QualityPreset = "auto" | "highest" | "lowest";

/**
 * Playback quality. Presets, or an explicit vertical resolution such as 720 (F-45: the player
 * menu lists the resolutions the post actually offers). An explicit height that the current item
 * does not offer falls back to the nearest available one.
 */
export type Quality = QualityPreset | { height: number };

/** Per-post interaction state shown/toggled from the player (F-4C). */
export interface PostFlags {
  favorited: boolean;
  bookmarked: boolean;
  retweeted: boolean;
}

export interface PlaybackState {
  status: PlaybackStatus;
  currentId: string | null;
  /** Memory only (F-18). */
  selectedId: string | null;
  loop: LoopMode;
  shuffle: boolean;
  /** 0..1 in 5% steps. */
  volume: number;
  muted: boolean;
  /** 0.5..2 */
  speed: number;
  /** Temporary override of Settings.defaultQuality (F-45). */
  quality: Quality;
  playedIds: string[];
  consecutiveErrors: number;
}

export type Theme = "light" | "dark" | "system";
export type Prefetch = "off" | "next" | "both";
/** v1.1: "fast" added at the host's request (accepts a higher chance of X rate limiting). */
export type ScrollPace = "slow" | "normal" | "fast";
export type PlayedHandling = "keep" | "dim" | "remove";

/** Settings S-01..S-18 (docs/requirements.md §5). */
export interface Settings {
  mode: PlaylistMode;
  theme: Theme;
  includeImages: boolean;
  /** Seconds, 1..20. */
  imageDurationSec: number;
  /** S-10: startup default. Explicit resolutions are chosen per session in the player (F-45). */
  defaultQuality: QualityPreset;
  hoverPreview: boolean;
  prefetch: Prefetch;
  autoScroll: boolean;
  scrollPace: ScrollPace;
  /** 0..1 */
  defaultVolume: number;
  defaultLoop: LoopMode;
  pauseSiteVideos: boolean;
  dedupe: boolean;
  hotkeys: boolean;
  playedHandling: PlayedHandling;
  /** S-20: show like / bookmark / repost buttons in the player and allow sending them. */
  postActions: boolean;
  /** S-21 (v1.1): UI language. */
  language: Language;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "auto",
  theme: "system",
  includeImages: true,
  imageDurationSec: 5,
  defaultQuality: "auto",
  hoverPreview: true,
  prefetch: "next",
  autoScroll: true,
  scrollPace: "normal",
  defaultVolume: 0.5,
  defaultLoop: "all",
  pauseSiteVideos: true,
  dedupe: true,
  hotkeys: true,
  playedHandling: "dim",
  postActions: true,
  language: "auto",
};

/** Persisted UI preferences (chrome.storage.local). */
export interface UiPrefs {
  panelWidth: number;
  panelOpen: boolean;
  playerWindow: { x: number; y: number; width: number; height: number } | null;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  panelWidth: 360,
  panelOpen: false,
  playerWindow: null,
};

export type PageKind =
  | "home"
  | "bookmarks"
  | "likes"
  | "user-media"
  /** A user's profile: posts tab (`/<user>`), replies (`/<user>/with_replies`), reposts tab. v1.1 */
  | "user-posts"
  | "user-replies"
  | "user-reposts"
  | "search"
  | "status"
  | "other";

/** UI language (v1.1). "auto" follows the browser language (ja → Japanese, otherwise English). */
export type Language = "auto" | "ja" | "en";
