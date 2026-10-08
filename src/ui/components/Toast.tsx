// Short notification (F-1B). Shows store.notice for TOAST_MS counted from notice.at, then
// clears it with store.setNotice(null). A newer notice replaces the one on screen. A notice
// that is already older than TOAST_MS when this mounts (e.g. set while the panel was closed)
// is cleared without being shown.
//
// The component leaves a zero-height anchor where it is placed (above the panel footer) and,
// when the overlay layer is available, renders the toast there with position: fixed so it
// shows above the floating player (see overlay.ts).
//
// Motion (stage 9): it rises in; when the notice is cleared it stays rendered for --xap-dur
// and fades out (instantly gone under reduced motion).
import type { JSX } from "preact";
import { createPortal } from "preact/compat";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Store } from "@/lib/store";
import { readDurationMs } from "@/ui/components/motion";
import { OverlayContext } from "@/ui/components/overlay";
import "@/ui/components/components.css";

export const TOAST_MS = 3000;

/** Horizontal inset from the anchor's edges and gap above it, in px. */
const INSET = 12;
const GAP = 8;

interface AnchorBox {
  left: number;
  width: number;
  top: number;
}

type Notice = NonNullable<Store["notice"]["value"]>;

function sameBox(a: AnchorBox | null, b: AnchorBox): boolean {
  return a !== null && a.left === b.left && a.width === b.width && a.top === b.top;
}

export function Toast({ store }: { store: Store }) {
  const overlay = useContext(OverlayContext);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<AnchorBox | null>(null);
  const notice = store.notice.value;
  const at = notice?.at ?? null;
  const remaining = at === null ? 0 : TOAST_MS - (Date.now() - at);
  const visible = notice !== null && remaining > 0;
  // The notice that was last on screen, and the one currently fading out.
  const lastShown = useRef<Notice | null>(null);
  const [leaving, setLeaving] = useState<Notice | null>(null);
  if (visible) {
    lastShown.current = notice;
  }

  useLayoutEffect(() => {
    if (visible) {
      setLeaving(null);
      return undefined;
    }
    const last = lastShown.current;
    lastShown.current = null;
    const ms = readDurationMs(anchorRef.current, "--xap-dur");
    if (last === null || ms <= 0) {
      return undefined;
    }
    setLeaving(last);
    const timer = setTimeout(() => setLeaving(null), ms);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (at === null) {
      return undefined;
    }
    const wait = Math.max(0, TOAST_MS - (Date.now() - at));
    const timer = setTimeout(() => {
      // Only clear the notice this timer was started for.
      if (store.notice.peek()?.at === at) {
        store.setNotice(null);
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [at, store]);

  // Track the anchor's position (panel width changes re-render this component).
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!visible || anchor === null || overlay === null) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const next = { left: rect.left, width: rect.width, top: rect.top };
    if (!sameBox(box, next)) {
      setBox(next);
    }
  });

  const shown = visible ? notice : leaving;
  let toast: JSX.Element | null = null;
  if (shown !== null) {
    const portalled = overlay !== null && box !== null;
    const style: JSX.CSSProperties | undefined = portalled
      ? {
          left: `${box.left + INSET}px`,
          width: `${Math.max(0, box.width - INSET * 2)}px`,
          right: "auto",
          bottom: `${window.innerHeight - box.top + GAP}px`,
        }
      : undefined;
    const element = (
      <div
        key={shown.at}
        class={visible ? "xap-toast" : "xap-toast xap-toast--leaving"}
        role="status"
        data-kind={shown.kind}
        data-xap-toast={shown.kind}
        data-portal={portalled ? "true" : undefined}
        style={style}
      >
        {shown.text}
      </div>
    );
    toast = portalled ? createPortal(element, overlay) : element;
  }

  return (
    <div class="xap-toast-region" ref={anchorRef}>
      {toast}
    </div>
  );
}
