// Minimal dropdown menu: a button that opens a list of items above (or below) it.
// With `value` the items are radio items (menuitemradio + aria-checked); without it they are
// plain actions (menuitem). Closes on selection, Escape, or a pointerdown outside (checked via
// composedPath so it works inside the Shadow DOM).
import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { OverlayContext } from "@/ui/components/overlay";
import "@/ui/components/components.css";

export interface MenuOption<T extends string | number> {
  value: T;
  label: string;
}

export interface MenuProps<T extends string | number> {
  /** aria-label of the trigger button and the menu. */
  label: string;
  /** Text on the trigger button (e.g. "1.0x"). Ignored when `buttonContent` is given. */
  buttonText?: string;
  /** Custom trigger content (e.g. an icon). */
  buttonContent?: ComponentChildren;
  options: ReadonlyArray<MenuOption<T>>;
  /** Currently selected value (radio menu). Omit for an action menu. */
  value?: T;
  onSelect: (value: T) => void;
  /** Where the popup opens relative to the trigger. Default "above". */
  placement?: "above" | "below";
  /** Extra class names for the trigger button. */
  triggerClass?: string;
  /**
   * Render the popup in the overlay layer (position: fixed next to the trigger) so it shows
   * above the floating player. The popup closes on scroll / resize in that mode.
   */
  portal?: boolean;
}

const POPUP_GAP = 4;

function portalStyle(anchor: DOMRect, placement: "above" | "below"): JSX.CSSProperties {
  const right = `${Math.max(0, window.innerWidth - anchor.right)}px`;
  return placement === "below"
    ? { top: `${anchor.bottom + POPUP_GAP}px`, right, left: "auto", bottom: "auto" }
    : {
        bottom: `${window.innerHeight - anchor.top + POPUP_GAP}px`,
        right,
        left: "auto",
        top: "auto",
      };
}

export function Menu<T extends string | number>({
  label,
  buttonText,
  buttonContent,
  options,
  value,
  onSelect,
  placement = "above",
  triggerClass,
  portal = false,
}: MenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const overlay = useContext(OverlayContext);
  const portalTarget = portal ? overlay : null;
  const radio = value !== undefined;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      const root = rootRef.current;
      const popup = popupRef.current;
      if (root && !path.includes(root) && !(popup && path.includes(popup))) {
        setOpen(false);
      }
    };
    // A fixed-position (portalled) popup would drift away from its trigger on scroll.
    const close = () => setOpen(false);
    const scrollRoot = portalTarget ? rootRef.current?.getRootNode() : undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    if (scrollRoot) {
      scrollRoot.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    }
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      if (scrollRoot) {
        scrollRoot.removeEventListener("scroll", close, true);
        window.removeEventListener("resize", close);
      }
    };
  }, [open, portalTarget]);

  const renderPopup = (children: ComponentChildren) => {
    const inOverlay = portalTarget !== null && anchor !== null;
    const popup = (
      <div
        ref={popupRef}
        class="xap-menu__popup"
        role="menu"
        aria-label={label}
        data-placement={placement}
        data-portal={inOverlay ? "true" : undefined}
        style={inOverlay ? portalStyle(anchor, placement) : undefined}
      >
        {children}
      </div>
    );
    return inOverlay ? createPortal(popup, portalTarget) : popup;
  };

  return (
    <div class="xap-menu" ref={rootRef} data-open={open ? "true" : "false"}>
      <button
        type="button"
        class={`xap-menu__trigger${triggerClass ? ` ${triggerClass}` : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        ref={triggerRef}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
          setOpen(!open);
        }}
        // Keep double clicks from reaching an enclosing row (double-click plays it).
        onDblClick={(event) => event.stopPropagation()}
      >
        {buttonContent ?? buttonText}
      </button>
      {open &&
        renderPopup(
          options.map((option) => {
            const onClick = (event: MouseEvent) => {
              event.stopPropagation();
              setOpen(false);
              onSelect(option.value);
            };
            const stop = (event: MouseEvent) => event.stopPropagation();
            return radio ? (
              <button
                key={String(option.value)}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === value}
                data-value={String(option.value)}
                class="xap-menu__item"
                onClick={onClick}
                onDblClick={stop}
              >
                {option.label}
              </button>
            ) : (
              <button
                key={String(option.value)}
                type="button"
                role="menuitem"
                data-value={String(option.value)}
                class="xap-menu__item"
                onClick={onClick}
                onDblClick={stop}
              >
                {option.label}
              </button>
            );
          }),
        )}
    </div>
  );
}
