// Media info overlay (F-41 / F-42): author (avatar, name, @screenName) and a 2-line
// preview of the post text at the bottom of the video area; "全文" expands a bottom sheet
// (up to half the video height, scrollable) with the full text and a link to the original
// post. Playback continues meanwhile. Both also carry the like / repost buttons
// (F-4C) unless settings.postActions is off.
import { useContext } from "preact/hooks";
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

function Author({ item }: { item: PlaylistItem }) {
  return (
    <div class="xap-info__author">
      {item.author.avatarUrl ? (
        <img class="xap-info__avatar" src={item.author.avatarUrl} alt="" />
      ) : (
        <span class="xap-info__avatar" />
      )}
      <span class="xap-info__name">{item.author.name}</span>
      <span class="xap-info__screen-name">@{item.author.screenName}</span>
    </div>
  );
}

interface PostActionSpec {
  action: PostAction;
  flag: keyof PostFlags;
  labels: [off: string, on: string];
  Icon: typeof HeartIcon;
}

const POST_ACTION_SPECS: readonly PostActionSpec[] = [
  { action: "like", flag: "favorited", labels: ["いいね", "いいねを取り消す"], Icon: HeartIcon },
  {
    action: "repost",
    flag: "retweeted",
    labels: ["リポスト", "リポストを取り消す"],
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
        const label = labels[on ? 1 : 0];
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
    // the video height, then scrolls). The close button sits where the 全文 button was, away
    // from the title bar's window close button.
    return (
      <div class="xap-info-sheet" role="dialog" aria-label="ポストの全文">
        <div class="xap-info-sheet__scroll">
          <div class="xap-info-sheet__header">
            <Author item={item} />
            <PostActionButtons item={item} />
          </div>
          <p class="xap-info-sheet__text">{item.text}</p>
          {item.postUrl && (
            <a
              class="xap-info-sheet__link"
              href={item.postUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalIcon size={14} />
              元ポストを開く
            </a>
          )}
        </div>
        <button
          type="button"
          class="xap-info__toggle xap-info-sheet__close"
          aria-label="全文を閉じる"
          title="全文を閉じる"
          onClick={() => onExpandedChange(false)}
        >
          <ChevronDownIcon size={16} />
          閉じる
        </button>
      </div>
    );
  }

  return (
    <div class="xap-info">
      <div class="xap-info__main">
        <Author item={item} />
        {item.text && <p class="xap-info__text">{item.text}</p>}
      </div>
      <PostActionButtons item={item} />
      <button
        type="button"
        class="xap-info__toggle"
        aria-label="全文を表示"
        title="全文を表示"
        onClick={() => onExpandedChange(true)}
      >
        <ChevronUpIcon size={16} />
        全文
      </button>
    </div>
  );
}
