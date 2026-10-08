// MAIN-world fullscreen shim (v1.1.1). X freezes its timeline (no row virtualisation updates, no
// further loading) while document.fullscreenElement is non-null. When the element in fullscreen is
// OUR UI host, report "not fullscreen" to the page so auto-scroll keeps working.
// - Own properties on `document` hide the state; Document.prototype / Element.prototype and
//   document.exitFullscreen are untouched.
// - fullscreenchange events still flow (the ISOLATED world needs them), but the PAGE's listeners for
//   them are wrapped and skipped while our host is fullscreen (X freezes on receiving the event).
// - The ISOLATED world sees its own `document` wrapper, so the extension still sees real values.
// Must not use chrome.* (not available in the MAIN world). Never throws.

import { UI_HOST_NAME } from "@/shared/constants";

const INSTALLED_FLAG = "__xAutoPlaylistFullscreenShimInstalled";

/** True when `realElement` is the `hostName` element (i.e. our own UI is fullscreen). */
export function shouldHideFullscreen(realElement: Element | null, hostName: string): boolean {
  if (typeof realElement !== "object" || realElement === null) {
    return false;
  }
  try {
    const tagName = realElement.tagName;
    return typeof tagName === "string" && tagName.toLowerCase() === hostName.toLowerCase();
  } catch {
    return false;
  }
}

type Getter = (this: Document) => unknown;

function originalGetter(proto: object, name: string): Getter | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    return typeof descriptor?.get === "function" ? (descriptor.get as Getter) : null;
  } catch {
    return null;
  }
}

function asElement(value: unknown): Element | null {
  return typeof value === "object" && value !== null ? (value as Element) : null;
}

function shimElementProperty(doc: Document, proto: object, name: string): void {
  const getter = originalGetter(proto, name);
  if (getter === null) {
    return;
  }
  try {
    Object.defineProperty(doc, name, {
      configurable: true,
      enumerable: true,
      get(this: Document) {
        const real = getter.call(doc);
        try {
          if (shouldHideFullscreen(asElement(real), UI_HOST_NAME)) {
            return null;
          }
        } catch {
          // Fall through to the real value.
        }
        return real;
      },
    });
  } catch {
    // Ignore.
  }
}

function shimIsFullScreen(doc: Document, proto: object, name: string, elementName: string): void {
  const getter = originalGetter(proto, name);
  const elementGetter =
    originalGetter(proto, elementName) ?? originalGetter(proto, "fullscreenElement");
  if (getter === null || elementGetter === null) {
    return;
  }
  try {
    Object.defineProperty(doc, name, {
      configurable: true,
      enumerable: true,
      get(this: Document) {
        const real = getter.call(doc);
        try {
          if (shouldHideFullscreen(asElement(elementGetter.call(doc)), UI_HOST_NAME)) {
            return false;
          }
        } catch {
          // Fall through to the real value.
        }
        return real;
      },
    });
  } catch {
    // Ignore.
  }
}

// --- fullscreenchange listeners -------------------------------------------------------------
// X enters its frozen state when it RECEIVES a fullscreenchange event, so hiding the property is
// not enough. The event itself must keep flowing (the ISOLATED world relies on it), so instead the
// page's listeners are wrapped: while the real fullscreen element is our host, the wrapper does
// nothing. Patching EventTarget.prototype in the MAIN world does not affect ISOLATED-world code.
// Exiting our fullscreen: the real element is then null, so the wrapper calls X's listener, which
// reads document.fullscreenElement === null, i.e. "not fullscreen" - consistent, nothing to do.

const FULLSCREEN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "fullscreenchange",
  "webkitfullscreenchange",
  "fullscreenerror",
]);

type ListenerLike = EventListenerOrEventListenerObject;
type IsHidden = () => boolean;

/** True for the event types whose page listeners are suppressed while our host is fullscreen. */
export function isFullscreenEventType(type: unknown): boolean {
  return typeof type === "string" && FULLSCREEN_EVENT_TYPES.has(type.toLowerCase());
}

function captureOf(options: unknown): boolean {
  if (typeof options === "boolean") {
    return options;
  }
  if (typeof options === "object" && options !== null) {
    return Boolean((options as { capture?: unknown }).capture);
  }
  return false;
}

function makeWrapper(listener: ListenerLike, isHidden: IsHidden): EventListener {
  return function fullscreenListener(this: unknown, ...args: unknown[]) {
    let hidden = false;
    try {
      hidden = isHidden();
    } catch {
      hidden = false;
    }
    if (hidden) {
      return undefined;
    }
    if (typeof listener === "function") {
      return (listener as (...a: unknown[]) => unknown).apply(this, args);
    }
    const handleEvent = (listener as { handleEvent?: unknown }).handleEvent;
    if (typeof handleEvent === "function") {
      return (handleEvent as (...a: unknown[]) => unknown).apply(listener, args);
    }
    return undefined;
  } as EventListener;
}

function patchEventTarget(isHidden: IsHidden): void {
  if (typeof EventTarget === "undefined") {
    return;
  }
  const proto = EventTarget.prototype;
  const originalAdd = proto.addEventListener;
  const originalRemove = proto.removeEventListener;
  if (typeof originalAdd !== "function" || typeof originalRemove !== "function") {
    return;
  }
  // original listener -> (type|capture) -> wrapper
  const wrappers = new WeakMap<object, Map<string, EventListener>>();

  const lookup = (type: unknown, listener: unknown, options: unknown, create: boolean) => {
    try {
      if (!isFullscreenEventType(type)) {
        return null;
      }
      if (listener === null || (typeof listener !== "function" && typeof listener !== "object")) {
        return null;
      }
      const key = `${String(type).toLowerCase()}|${captureOf(options)}`;
      let byKey = wrappers.get(listener as object);
      let wrapper = byKey?.get(key) ?? null;
      if (wrapper === null && create) {
        wrapper = makeWrapper(listener as ListenerLike, isHidden);
        if (byKey === undefined) {
          byKey = new Map();
          wrappers.set(listener as object, byKey);
        }
        byKey.set(key, wrapper);
      }
      return wrapper;
    } catch {
      return null;
    }
  };

  proto.addEventListener = function addEventListener(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    const wrapper = lookup(type, listener, options, true);
    return originalAdd.call(this, type, wrapper ?? listener, options);
  };

  proto.removeEventListener = function removeEventListener(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    const wrapper = lookup(type, listener, options, false);
    return originalRemove.call(this, type, wrapper ?? listener, options);
  };
}

function shimHandlerProperty(doc: Document, proto: object, name: string, isHidden: IsHidden): void {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(proto, name);
  } catch {
    return;
  }
  const get = descriptor?.get;
  const set = descriptor?.set;
  if (typeof get !== "function" || typeof set !== "function") {
    return;
  }
  let assigned: unknown = null;
  let wrapped: unknown = null;
  try {
    Object.defineProperty(doc, name, {
      configurable: true,
      enumerable: true,
      get() {
        const current = get.call(doc);
        return current !== null && current === wrapped ? assigned : current;
      },
      set(value: unknown) {
        if (typeof value === "function") {
          assigned = value;
          wrapped = makeWrapper(value as EventListener, isHidden);
          set.call(doc, wrapped);
        } else {
          assigned = null;
          wrapped = null;
          set.call(doc, value);
        }
      },
    });
  } catch {
    // Ignore.
  }
}

export function installFullscreenShim(): void {
  try {
    const flags = globalThis as unknown as Record<string, unknown>;
    if (flags[INSTALLED_FLAG] === true) {
      return;
    }
    flags[INSTALLED_FLAG] = true;
  } catch {
    return;
  }
  try {
    if (typeof Document === "undefined" || typeof document === "undefined") {
      return;
    }
    const doc = document;
    const proto = Document.prototype;
    const realElementGetter =
      originalGetter(proto, "fullscreenElement") ??
      originalGetter(proto, "webkitFullscreenElement");
    const isHidden: IsHidden = () =>
      realElementGetter !== null &&
      shouldHideFullscreen(asElement(realElementGetter.call(doc)), UI_HOST_NAME);

    shimElementProperty(doc, proto, "fullscreenElement");
    shimElementProperty(doc, proto, "webkitFullscreenElement");
    shimIsFullScreen(doc, proto, "webkitIsFullScreen", "webkitFullscreenElement");
    if (realElementGetter !== null) {
      try {
        patchEventTarget(isHidden);
      } catch {
        // Ignore.
      }
      shimHandlerProperty(doc, proto, "onfullscreenchange", isHidden);
      shimHandlerProperty(doc, proto, "onwebkitfullscreenchange", isHidden);
    }
  } catch {
    // Never affect X.
  }
}
