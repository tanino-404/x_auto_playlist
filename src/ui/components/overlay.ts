// Top overlay layer (stacking order: panel < floating player < overlay). Popups that must
// appear above the floating player even though they belong to the panel (toast, row menus)
// are portalled into this element. Provided by App; null until it has mounted.
import { createContext } from "preact";

export const OverlayContext = createContext<HTMLElement | null>(null);
