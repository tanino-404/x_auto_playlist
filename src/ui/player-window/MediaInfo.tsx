// Media info overlay (F-41 / F-42): author (avatar, name, @screenName) and a 2-line
// preview of the post text at the bottom of the video area; "全文" expands a bottom sheet
// (up to half the video height, scrollable) with the full text and a link to the original
// post. Playback continues meanwhile. Both also carry the like / repost buttons
// (F-4C) unless settings.postActions is off.
// F-63: in both states the like / repost buttons sit just left of the 全文 / 閉じる button on
// the author row (right-aligned), the text uses the full width of the dark background and keeps
// the post's line breaks, and the author links to their profile (same tab).
import { useContext } from "preact/hooks";
import { type MessageKey, t } from "@/lib/i18n";
import { type PostAction, pendingKey } from "@/lib/post-actions";
import { PostActionsContext } from "@/lib/post-actions/context";
import type { PlaylistItem, PostFlags } from "@/shared/types";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalIcon,
  HeartIcon,
  RepostIcon,
} from "@/ui/components/icons";

export interface MediaInfoProps {
  item: PlaylistItem;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

function profileUrl(screenName: string): string {
  return `https://x.com/${encodeURIComponent(screenName)}`;
}

/**
 * Same-tab navigation to the author's profile (F-63). The whole page navigates, so leave
 * fullscreen first (best effort); the link's default action then performs the navigation.
 */
function onAuthorClick(event: MouseEvent) {
  if (document.fullscreenElement === null) {
    return;
  }
  // Let the browser leave fullscreen before the page goes away; navigate whatever happens.
  event.preventDefault();
  const href = (event.currentTarget as HTMLAnchorElement).href;
  const go = () => window.location.assign(href);
  document.exitFullscreen().then(go, go);
}

function Author({ item }: { item: PlaylistItem }) {
  return (
    <a
      class="xap-info__author"
      href={profileUrl(item.author.screenName)}
      aria-label={t("info.author")}
      data-xap-author-link="true"
      // Not inside the media element, so the stage does not treat it as a play toggle.
      onClick={onAuthorClick}
    >
      {item.author.avatarUrl ? (
        <img class="xap-info__avatar" src={item.author.avatarUrl} alt="" />
      ) : (
        <span class="xap-info__avatar" />
      )}
      <span class="xap-info__name">{item.author.name}</span>
      <span class="xap-info__screen-name">@{item.author.screenName}</span>
    </a>
  );
}

interface PostActionSpec {
  action: PostAction;
  flag: keyof PostFlags;
  labels: [off: MessageKey, on: MessageKey];
  Icon: typeof HeartIcon;
}

const POST_ACTION_SPECS: readonly PostActionSpec[] = [
  { action: "like", flag: "favorited", labels: ["info.like", "info.unlike"], Icon: HeartIcon },
  {
    action: "repost",
    flag: "retweeted",
    labels: ["info.repost", "info.unrepost"],
    Icon: RepostIcon,
  },
];

/**
 * Like / repost toggles (F-4C). Unknown flags show as off. Bookmarks are not offered: X answers
 * our CreateBookmark with 404 (it requires its own signed header).
 */
function PostActionButtons({ item }: { item: PlaylistItem }) {
  const ctx = useContext(PostActionsContext);
  if (ctx === null || !ctx.store.settings.value.postActions) {
    return null;
  }
  const { postActions } = ctx;
  const pending = postActions.pending.value;
  return (
    <div class="xap-post-actions" data-xap-post-actions="true">
      {POST_ACTION_SPECS.map(({ action, flag, labels, Icon }) => {
        const on = item.post?.[flag] === true;
        const busy = pending.has(pendingKey(item.postId, action));
        const label = t(labels[on ? 1 : 0]);
        return (
          <button
            key={action}
            type="button"
            class="xap-post-actions__btn"
            data-xap-post-action={action}
            aria-label={label}
            title={label}
            aria-pressed={on}
            aria-busy={busy || undefined}
            disabled={busy}
            // Not inside the media element, so the stage does not treat it as a play toggle.
            onClick={() => {
              void postActions.toggle(item.postId, action);
            }}
          >
            <Icon size={16} filled={on} />
          </button>
        );
      })}
    </div>
  );
}

export function MediaInfo({ item, expanded, onExpandedChange }: MediaInfoProps) {
  if (expanded) {
    // Bottom sheet: grows up from the bottom of the video with the text (capped by CSS at half
    // the video height, then the text scrolls under a fixed author row). The author row is laid
    // out like the collapsed bar's, so the buttons keep their place next to 閉じる.
    return (
      <div class="xap-info-sheet" role="dialog" aria-label={t("info.sheet")}>
        <div class="xap-info__head xap-info-sheet__header">
          <Author item={item} />
          <div class="xap-info__buttons">
            <PostActionButtons item={item} />
            <button
              type="button"
              class="xap-info__toggle xap-info-sheet__close"
              aria-label={t("info.collapse.label")}
              title={t("info.collapse.label")}
              onClick={() => onExpandedChange(false)}
            >
              <ChevronDownIcon size={16} />
              {t("info.collapse")}
            </button>
          </div>
        </div>
        <div class="xap-info-sheet__scroll">
          {item.text && <p class="xap-info-sheet__text">{item.text}</p>}
          {item.postUrl && (
            <a
              class="xap-info-sheet__link"
              href={item.postUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalIcon size={14} />
              {t("info.openPost")}
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div class="xap-info">
      <div class="xap-info__head">
        <Author item={item} />
        <div class="xap-info__buttons">
          <PostActionButtons item={item} />
          <button
            type="button"
            class="xap-info__toggle"
            aria-label={t("info.expand.label")}
            title={t("info.expand.label")}
            onClick={() => onExpandedChange(true)}
          >
            <ChevronUpIcon size={16} />
            {t("info.expand")}
          </button>
        </div>
      </div>
      {item.text && <p class="xap-info__text">{item.text}</p>}
    </div>
  );
}
