// The playlist rows inside the side panel (docs/architecture.md §7.1).
// - single click selects, double click plays (F-24)
// - thumbnail hover preview, one at a time (F-23 / S-11)
// - played items dimmed per S-18 "dim" (F-26; "remove" is handled by the store)
// - drag-to-reorder from the grip handle, manual mode only (F-13), Pointer Events only; a ghost
//   copy of the row follows the pointer (overlay layer) and glides onto the drop target
//   (or back, on Escape / a drop outside the window)
// - rows added while the list is shown fade in (at most ROW_ENTER_LIMIT per batch)
// - row menu: 削除 / 次に再生 / 元ポストを開く (F-12 / F-25)
import { createPortal } from "preact/compat";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import type { Player } from "@/lib/player";
import type { Store } from "@/lib/store";
import { gapToIndex } from "@/lib/store/playlist";
import { TEXT_PREVIEW_LENGTH } from "@/shared/constants";
import type { PlaylistItem } from "@/shared/types";
import { GripIcon, MoreIcon, PlayIcon } from "@/ui/components/icons";
import type { MenuOption } from "@/ui/components/Menu";
import { Menu } from "@/ui/components/Menu";
import { readDurationMs } from "@/ui/components/motion";
import { OverlayContext } from "@/ui/components/overlay";
import { HoverPreview } from "@/ui/panel/HoverPreview";
import { canHoverPreview, pickHoverSource } from "@/ui/panel/hover-source";

export interface PlaylistListProps {
  store: Store;
  player: Player;
}

type RowAction = "remove" | "playNext" | "openPost";

const ROW_MENU: ReadonlyArray<MenuOption<RowAction>> = [
  { value: "remove", label: "削除" },
  { value: "playNext", label: "次に再生" },
  { value: "openPost", label: "元ポストを開く" },
];

/** Pixels from the list's top / bottom edge where dragging auto-scrolls. */
const DRAG_SCROLL_EDGE = 32;
const DRAG_SCROLL_STEP = 12;

/** New rows that animate in per render; the rest of a large batch appears at once. */
const ROW_ENTER_LIMIT = 12;
/** How long a new row keeps its entrance class (longer than --xap-dur-slow). */
const ROW_ENTER_MS = 400;

/** First TEXT_PREVIEW_LENGTH characters (code points), whitespace collapsed. */
function previewText(text: string): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > TEXT_PREVIEW_LENGTH
    ? `${chars.slice(0, TEXT_PREVIEW_LENGTH).join("")}…`
    : chars.join("");
}

interface DragState {
  pointerId: number;
  from: number;
  /** Insertion gap 0..length (before row `gap`; length = after the last row). */
  gap: number;
}

type DropMarker = "before" | "after" | undefined;

/** The floating copy of the grabbed row. */
interface Ghost {
  item: PlaylistItem;
  width: number;
  height: number;
  /** Where the row was grabbed, relative to its top-left corner. */
  offsetX: number;
  offsetY: number;
  /** One per drag, so a new drag never reuses a settling element. */
  key: number;
  /** Dropped / cancelled: gliding onto the row's (new or original) place, then removed. */
  settling: boolean;
}

/** Grab data kept from pointerdown until the first pointermove creates the ghost. */
interface Grab {
  item: PlaylistItem;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  /** The grip holding the pointer capture (released on Escape). */
  handle: HTMLElement;
  key: number;
}

function ghostTransform(x: number, y: number, scale: number): string {
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
}

/** Which row shows the insertion line for `drag`, and on which side. */
function dropMarkerFor(index: number, count: number, drag: DragState | null): DropMarker {
  if (drag === null || gapToIndex(drag.from, drag.gap) === drag.from) {
    return undefined;
  }
  if (drag.gap === index) {
    return "before";
  }
  if (drag.gap === count && index === count - 1) {
    return "after";
  }
  return undefined;
}

interface RowProps {
  item: PlaylistItem;
  index: number;
  selected: boolean;
  playing: boolean;
  played: boolean;
  reorderable: boolean;
  dragging: boolean;
  drop: DropMarker;
  /** Just added: plays the entrance animation. */
  entering: boolean;
  hoverSrc: string | null;
  onSelect: (id: string) => void;
  onPlay: (id: string) => void;
  onHover: (id: string, entering: boolean) => void;
  onAction: (item: PlaylistItem, action: RowAction) => void;
  onHandleDown: (event: PointerEvent, index: number) => void;
  onHandleMove: (event: PointerEvent) => void;
  onHandleUp: (event: PointerEvent, commit: boolean) => void;
}

function PlaylistRow(props: RowProps) {
  const { item, index, selected, playing, played, reorderable, dragging, drop, hoverSrc } = props;
  return (
    <div
      class={props.entering ? "xap-panel__row xap-panel__row--enter" : "xap-panel__row"}
      data-id={item.id}
      data-selected={selected ? "true" : "false"}
      data-playing={playing ? "true" : "false"}
      data-played={played ? "true" : undefined}
      data-unplayable={item.playable ? "false" : "true"}
      data-dragging={dragging ? "true" : undefined}
      data-drop={drop}
      data-xap-hover-preview={hoverSrc !== null ? "true" : undefined}
      onClick={() => props.onSelect(item.id)}
      onDblClick={() => props.onPlay(item.id)}
      onKeyDown={(event) => {
        // Only when the row itself is focused (not the handle / menu inside it).
        if (event.target !== event.currentTarget) {
          return;
        }
        // Keyboard equivalent of a single click. Playback is not started from here (F-16/F-17).
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(item.id);
        }
      }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
    >
      {reorderable && (
        <button
          type="button"
          class="xap-panel__grip"
          aria-label="並べ替え"
          title="ドラッグして並べ替え"
          data-xap-reorder-handle="true"
          tabIndex={-1}
          onPointerDown={(event) => props.onHandleDown(event, index)}
          onPointerMove={props.onHandleMove}
          onPointerUp={(event) => props.onHandleUp(event, true)}
          onPointerCancel={(event) => props.onHandleUp(event, false)}
          onClick={(event) => event.stopPropagation()}
          onDblClick={(event) => event.stopPropagation()}
        >
          <GripIcon size={16} />
        </button>
      )}
      <div
        class="xap-panel__thumb"
        onPointerEnter={() => props.onHover(item.id, true)}
        onPointerLeave={() => props.onHover(item.id, false)}
      >
        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" />}
        {hoverSrc !== null && <HoverPreview src={hoverSrc} />}
        {playing && (
          <span class="xap-panel__playing-icon">
            <PlayIcon size={20} />
          </span>
        )}
      </div>
      <div class="xap-panel__meta">
        <span class="xap-panel__author">
          @{item.author.screenName}
          {!item.playable && <span class="xap-panel__badge">再生不可</span>}
        </span>
        <span class="xap-panel__text">{previewText(item.text)}</span>
      </div>
      <div class="xap-panel__row-menu" data-xap-row-menu="true">
        <Menu
          label="項目のメニュー"
          buttonContent={<MoreIcon size={16} />}
          triggerClass="xap-panel__row-menu-btn"
          options={ROW_MENU}
          placement="below"
          portal
          onSelect={(action) => props.onAction(item, action)}
        />
      </div>
    </div>
  );
}

export function PlaylistList({ store, player }: PlaylistListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const overlay = useContext(OverlayContext);
  const grabRef = useRef<Grab | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [ghost, setGhost] = useState<Ghost | null>(null);
  /** Ids rendered last time (null before the first render) and new rows still animating in. */
  const prevIdsRef = useRef<Set<string> | null>(null);
  const enteringRef = useRef(new Map<string, number>());

  const settings = store.settings.value;
  const items = store.visibleItems.value;
  const { selectedId, currentId, playedIds } = store.playback.value;
  const reorderable = settings.mode === "manual";
  const dimPlayed = settings.playedHandling === "dim";
  const played = dimPlayed ? new Set(playedIds) : null;

  // Entrance for rows added since the last render. Skipped on the first render (opening the
  // panel / coming back from settings), while dragging and while a hover preview video plays,
  // so it never stacks on the heavier work.
  const now = Date.now();
  const entering = enteringRef.current;
  for (const [id, until] of entering) {
    if (until <= now) {
      entering.delete(id);
    }
  }
  const prevIds = prevIdsRef.current;
  if (prevIds !== null && drag === null && hoverId === null) {
    let budget = ROW_ENTER_LIMIT;
    for (const item of items) {
      if (budget === 0) {
        break;
      }
      if (!prevIds.has(item.id)) {
        entering.set(item.id, now + ROW_ENTER_MS);
        budget--;
      }
    }
  }
  prevIdsRef.current = new Set(items.map((item) => item.id));

  const onHover = (id: string, entering: boolean) => {
    if (entering) {
      if (dragRef.current === null) {
        setHoverId(id);
      }
    } else {
      setHoverId((current) => (current === id ? null : current));
    }
  };

  const onAction = (item: PlaylistItem, action: RowAction) => {
    if (action === "remove") {
      store.removeItem(item.id);
    } else if (action === "playNext") {
      store.playNext(item.id);
    } else {
      window.open(item.postUrl, "_blank", "noopener");
    }
  };

  const gapAt = (clientY: number): number => {
    const list = listRef.current;
    if (list === null) {
      return 0;
    }
    const rows = list.querySelectorAll<HTMLElement>(":scope > .xap-panel__row");
    for (let i = 0; i < rows.length; i++) {
      const rect = (rows[i] as HTMLElement).getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return rows.length;
  };

  /** Follows the pointer; the first move after pointerdown creates the ghost. */
  const moveGhost = (x: number, y: number) => {
    pointerRef.current = { x, y };
    const grab = grabRef.current;
    if (grab === null) {
      return;
    }
    const el = ghostRef.current;
    if (el === null || ghost === null || ghost.settling) {
      if (ghost === null || ghost.settling) {
        setGhost({
          item: grab.item,
          width: grab.width,
          height: grab.height,
          offsetX: grab.offsetX,
          offsetY: grab.offsetY,
          key: grab.key,
          settling: false,
        });
      }
      return;
    }
    // Written directly (no re-render per move); only transform changes.
    el.style.transform = ghostTransform(x - grab.offsetX, y - grab.offsetY, 0.98);
  };

  /** Drop / cancel: the ghost glides onto the row's current place and fades, then goes. */
  const settleGhost = () => {
    grabRef.current = null;
    setGhost((current) => (current === null ? null : { ...current, settling: true }));
  };

  // Settling: measure the row after the list has re-rendered in its new order.
  const settling = ghost?.settling === true;
  const settlingId = ghost?.item.id ?? null;
  useEffect(() => {
    if (!settling || settlingId === null) {
      return undefined;
    }
    const el = ghostRef.current;
    const ms = readDurationMs(el, "--xap-dur");
    let frame = 0;
    if (el !== null && ms > 0) {
      frame = requestAnimationFrame(() => {
        const row = listRef.current?.querySelector<HTMLElement>(
          `:scope > .xap-panel__row[data-id="${CSS.escape(settlingId)}"]`,
        );
        if (row) {
          const rect = row.getBoundingClientRect();
          el.style.transform = ghostTransform(rect.left, rect.top, 1);
        }
        el.style.opacity = "0";
      });
    }
    const timer = setTimeout(() => setGhost(null), ms > 0 ? ms + 30 : 0);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [settling, settlingId]);

  // Escape cancels a drag in progress (the row stays where it was).
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const current = dragRef.current;
      if (event.key !== "Escape" || current === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const handle = grabRef.current?.handle;
      if (handle?.hasPointerCapture(current.pointerId)) {
        handle.releasePointerCapture(current.pointerId);
      }
      dragRef.current = null;
      setDrag(null);
      grabRef.current = null;
      setGhost((ghostNow) => (ghostNow === null ? null : { ...ghostNow, settling: true }));
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [dragging]);

  const onHandleDown = (event: PointerEvent, index: number) => {
    if (event.button !== 0 || !reorderable) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const row = handle.closest<HTMLElement>(".xap-panel__row");
    const item = items[index];
    if (row !== null && item !== undefined) {
      const rect = row.getBoundingClientRect();
      grabRef.current = {
        item,
        width: rect.width,
        height: rect.height,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        handle,
        key: event.timeStamp,
      };
    }
    pointerRef.current = { x: event.clientX, y: event.clientY };
    const next = { pointerId: event.pointerId, from: index, gap: index };
    dragRef.current = next;
    setDrag(next);
    setHoverId(null);
  };

  const onHandleMove = (event: PointerEvent) => {
    const current = dragRef.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    moveGhost(event.clientX, event.clientY);
    // Auto-scroll the panel body while dragging near its edges.
    const scroller = listRef.current?.parentElement;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      if (event.clientY < rect.top + DRAG_SCROLL_EDGE) {
        scroller.scrollTop -= DRAG_SCROLL_STEP;
      } else if (event.clientY > rect.bottom - DRAG_SCROLL_EDGE) {
        scroller.scrollTop += DRAG_SCROLL_STEP;
      }
    }
    const gap = gapAt(event.clientY);
    if (gap !== current.gap) {
      const next = { ...current, gap };
      dragRef.current = next;
      setDrag(next);
    }
  };

  const onHandleUp = (event: PointerEvent, commit: boolean) => {
    const current = dragRef.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDrag(null);
    settleGhost();
    // Released outside the window: a cancel, like Escape.
    const outside =
      event.clientX < 0 ||
      event.clientY < 0 ||
      event.clientX > window.innerWidth ||
      event.clientY > window.innerHeight;
    if (commit && !outside) {
      const to = gapToIndex(current.from, current.gap);
      if (to !== current.from) {
        store.moveItem(current.from, to);
      }
    }
  };

  const ghostElement =
    ghost !== null && overlay !== null
      ? createPortal(
          <div
            key={ghost.key}
            ref={ghostRef}
            class={ghost.settling ? "xap-drag-ghost xap-drag-ghost--settling" : "xap-drag-ghost"}
            data-xap-drag-ghost="true"
            aria-hidden="true"
            style={{
              width: `${ghost.width}px`,
              height: `${ghost.height}px`,
              transformOrigin: `${ghost.offsetX}px ${ghost.offsetY}px`,
              // The settle step overrides this directly (see the effect above).
              transform: ghostTransform(
                pointerRef.current.x - ghost.offsetX,
                pointerRef.current.y - ghost.offsetY,
                0.98,
              ),
            }}
          >
            <div class="xap-drag-ghost__thumb">
              {ghost.item.thumbnailUrl && <img src={ghost.item.thumbnailUrl} alt="" />}
            </div>
            <div class="xap-drag-ghost__meta">
              <span class="xap-drag-ghost__author">@{ghost.item.author.screenName}</span>
              <span class="xap-drag-ghost__text">{previewText(ghost.item.text)}</span>
            </div>
          </div>,
          overlay,
        )
      : null;

  return (
    <div
      ref={listRef}
      class="xap-panel__list"
      role="listbox"
      aria-label="プレイリスト"
      data-reordering={drag !== null ? "true" : undefined}
    >
      {items.map((item, index) => {
        const hovering =
          hoverId === item.id && drag === null && canHoverPreview(item, settings.hoverPreview);
        return (
          <PlaylistRow
            key={item.id}
            item={item}
            index={index}
            selected={item.id === selectedId}
            playing={item.id === currentId}
            played={played !== null && item.id !== currentId && played.has(item.id)}
            reorderable={reorderable}
            dragging={drag !== null && drag.from === index}
            drop={dropMarkerFor(index, items.length, drag)}
            entering={entering.has(item.id)}
            hoverSrc={hovering ? pickHoverSource(item.sources) : null}
            onSelect={(id) => store.select(id)}
            onPlay={(id) => {
              void player.play(id);
            }}
            onHover={onHover}
            onAction={onAction}
            onHandleDown={onHandleDown}
            onHandleMove={onHandleMove}
            onHandleUp={onHandleUp}
          />
        );
      })}
      {ghostElement}
    </div>
  );
}
