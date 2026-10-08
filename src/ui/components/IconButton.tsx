// Small square icon button. `label` becomes aria-label and title.
import type { ComponentChildren } from "preact";
import "@/ui/components/components.css";

export interface IconButtonProps {
  label: string;
  onClick: (event: MouseEvent) => void;
  children: ComponentChildren;
  /** Rendered as aria-pressed (toggle buttons such as shuffle). */
  pressed?: boolean;
  disabled?: boolean;
  /** Extra class names. */
  class?: string;
  /** Visual emphasis (e.g. an active loop mode that is not a plain toggle). */
  active?: boolean;
}

export function IconButton({
  label,
  onClick,
  children,
  pressed,
  disabled,
  class: className,
  active,
}: IconButtonProps) {
  return (
    <button
      type="button"
      class={`xap-icon-btn${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-active={active || pressed ? "true" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
