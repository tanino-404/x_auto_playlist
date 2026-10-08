// Inline SVG icon set (F-4G). Emoji are avoided because they render differently per OS.
//
// Rules (one set, so the panel and the player read the same):
// - 24px grid, default size 18px, one 2px stroke, round caps and joins, currentColor only.
// - Hierarchy by fill: transport glyphs (prev / play / pause / next) are solid geometric
//   shapes; everything else is a line drawing. The solid shapes also carry the 2px stroke
//   with round joins, so their corners soften by the same radius as the line icons' corners.
// - Optical size: round silhouettes (gear, heart, loop) span ~19px of the grid, square ones
//   (fullscreen, PiP, panel, bookmark) ~17px, so they look the same size side by side.
// - Toggle glyphs keep one outline and switch fill (heart, bookmark, panel).
import type { ComponentChildren } from "preact";

export interface IconProps {
  size?: number;
}

/** The single stroke weight of the set. */
const STROKE = 2;

function Svg({
  size = 18,
  strokeWidth = STROKE,
  children,
}: IconProps & { strokeWidth?: number; children: ComponentChildren }) {
  return (
    <svg
      class="xap-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// ---- transport: solid ----

export function PlayIcon(props: IconProps) {
  // The centroid sits right of centre so the triangle looks centred.
  return (
    <Svg {...props}>
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  // Same height as the play triangle, so toggling does not jump.
  return (
    <Svg {...props}>
      <path d="M7 5.5h2.5v13H7z" fill="currentColor" />
      <path d="M14.5 5.5H17v13h-2.5z" fill="currentColor" />
    </Svg>
  );
}

export function PrevIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6.5v11l-8.5-5.5z" fill="currentColor" />
      <path d="M6 6.5h1v11H6z" fill="currentColor" />
    </Svg>
  );
}

export function NextIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6.5v11l8.5-5.5z" fill="currentColor" />
      <path d="M17 6.5h1v11h-1z" fill="currentColor" />
    </Svg>
  );
}

// ---- playback modes: line ----

export function LoopIcon(props: IconProps & { one?: boolean }) {
  const { one, ...rest } = props;
  return (
    <Svg {...rest}>
      <path d="M17 3.5l3 3-3 3" />
      <path d="M20 6.5H8.5A4.5 4.5 0 0 0 4 11v.5" />
      <path d="M7 20.5l-3-3 3-3" />
      <path d="M4 17.5h11.5A4.5 4.5 0 0 0 20 13v-.5" />
      {one && <path d="M10.75 10.5l1.5-1v5" />}
    </Svg>
  );
}

export function ShuffleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 17h2.5c2 0 3.2-.9 4.2-2.4l3.6-5.2c1-1.5 2.2-2.4 4.2-2.4H20" />
      <path d="M3 7h2.5c2 0 3.2.9 4.2 2.4l3.6 5.2c1 1.5 2.2 2.4 4.2 2.4H20" />
      <path d="M17 4l3 3-3 3" />
      <path d="M17 14l3 3-3 3" />
    </Svg>
  );
}

export function VolumeIcon(props: IconProps & { level: "mute" | "low" | "high" }) {
  const { level, ...rest } = props;
  return (
    <Svg {...rest}>
      <path d="M3.5 9.5h3L11 5.5v13l-4.5-4h-3z" />
      {level === "mute" && (
        <>
          <path d="M15.5 9.5l5 5" />
          <path d="M20.5 9.5l-5 5" />
        </>
      )}
      {level !== "mute" && <path d="M15 9a4.2 4.2 0 0 1 0 6" />}
      {level === "high" && <path d="M18 6a8.5 8.5 0 0 1 0 12" />}
    </Svg>
  );
}

// ---- window: line ----

export function FullscreenIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </Svg>
  );
}

export function FullscreenExitIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4" />
      <path d="M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4" />
      <path d="M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20" />
      <path d="M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" />
    </Svg>
  );
}

export function PipIcon(props: IconProps) {
  // The outer frame opens where the small window sits, so the two do not merge at 16px.
  return (
    <Svg {...props}>
      <path d="M20.5 10.5V7a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2H10" />
      <rect x="13.5" y="13.5" width="7" height="5.5" rx="1.25" />
    </Svg>
  );
}

/** F-4F: a window with a narrow column on the right (the side panel). `filled` = panel shown. */
export function PanelIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      {filled ? (
        <path d="M14.5 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4z" fill="currentColor" />
      ) : (
        <path d="M14.5 4.5v15" />
      )}
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17.5 6.5l-11 11" />
      <path d="M6.5 6.5l11 11" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  // Six broad teeth instead of the usual eight, so the gaps stay open at 16px.
  return (
    <Svg {...props}>
      <path d="M9.82 5.67L10.24 2.97L13.76 2.97L14.18 5.67A6.7 6.7 0 0 1 16.4 6.94L18.94 5.96L20.7 9L18.58 10.72A6.7 6.7 0 0 1 18.58 13.28L20.7 15L18.94 18.04L16.4 17.06A6.7 6.7 0 0 1 14.18 18.33L13.76 21.03L10.24 21.03L9.82 18.33A6.7 6.7 0 0 1 7.6 17.06L5.06 18.04L3.3 15L5.42 13.28A6.7 6.7 0 0 1 5.42 10.72L3.3 9L5.06 5.96L7.6 6.94A6.7 6.7 0 0 1 9.82 5.67Z" />
      <circle cx="12" cy="12" r="2.75" />
    </Svg>
  );
}

// ---- navigation: line ----

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.5 6.5L9 12l5.5 5.5" />
    </Svg>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17.5 14.5L12 9l-5.5 5.5" />
    </Svg>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 5H6.5A2.5 2.5 0 0 0 4 7.5v10A2.5 2.5 0 0 0 6.5 20h10a2.5 2.5 0 0 0 2.5-2.5V13" />
      <path d="M14.5 4H20v5.5" />
      <path d="M11 13l9-9" />
    </Svg>
  );
}

/**
 * The extension's own mark (public/icon/icon.svg, redrawn at the 24px icon grid): the same
 * rounded tile + three-row play triangle, in the icon's fixed colors (not `currentColor`), so
 * it reads as the same mark as the toolbar/extension icon in either theme.
 */
export function AppMarkIcon({ size = 20 }: IconProps) {
  return (
    <svg
      class="xap-icon xap-app-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="24" height="24" rx="5.5" fill="#0f8076" />
      <path
        d="M7.9 6.75v10.5l9-5.25z"
        fill="#fbfbfa"
        stroke="#fbfbfa"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <path d="M5.6 9h13.5v1.5H5.6zM5.6 13.5h13.5V15H5.6z" fill="#0f8076" />
    </svg>
  );
}

/** Vertical "⋮" for row menus. */
export function MoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="5.5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Drag handle: two columns of three dots (the MoreIcon dot, a little smaller). */
export function GripIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="6.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17.5" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

// ---- post actions (F-4C): line, `filled` = the action is on ----

export interface ToggleIconProps extends IconProps {
  filled?: boolean;
}

export function HeartIcon({ filled, ...props }: ToggleIconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 8.7 5.3c1.4 0 2.6.7 3.3 1.9.7-1.2 1.9-1.9 3.3-1.9a4.2 4.2 0 0 1 4.2 4.2c0 5.6-7.5 10-7.5 10z"
        fill={filled ? "currentColor" : "none"}
      />
    </Svg>
  );
}

export function BookmarkIcon({ filled, ...props }: ToggleIconProps) {
  return (
    <Svg {...props}>
      <path
        d="M6.5 6A1.5 1.5 0 0 1 8 4.5h8A1.5 1.5 0 0 1 17.5 6v13.5L12 15.75 6.5 19.5z"
        fill={filled ? "currentColor" : "none"}
      />
    </Svg>
  );
}

export function RepostIcon({ filled, ...props }: ToggleIconProps) {
  // Two arrows chasing each other (up on the left, down on the right). "On" thickens the
  // stroke instead of filling (arrows have no closed area), which keeps the on/off difference
  // visible without an accent colour.
  return (
    <Svg {...props} strokeWidth={filled ? 2.75 : STROKE}>
      <path d="M3 7.5l3.5-3.5 3.5 3.5" />
      <path d="M6.5 4.5V15a2 2 0 0 0 2 2h3" />
      <path d="M21 16.5L17.5 20 14 16.5" />
      <path d="M17.5 19.5V9a2 2 0 0 0-2-2h-3" />
    </Svg>
  );
}
