import { isModalOverlayOpen, modalOverlayClose } from "@/lib/modal-overlay";

export type Dir = "up" | "down" | "left" | "right";
export type TvNavZone = "nav" | "chrome" | "hero" | "content";
export type TvNavScroll = "center" | "nearest" | "none";

export type TvNavCtx = {
  active: HTMLElement | null;
  dir: Dir;
  wrap: boolean;
  root: ParentNode;
  scroll: "center" | "nearest";
  zone: TvNavZone;
  all: HTMLElement[];
};

/** Return true when the policy handled the move. */
export type TvNavPolicy = (ctx: TvNavCtx) => boolean;

const SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[data-focusable="true"]',
].join(", ");

const KEY_TO_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Up: "up",
  Down: "down",
  Left: "left",
  Right: "right",
};

const CODE_TO_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const KEYCODE_TO_DIR: Record<number, Dir> = {
  38: "up",
  40: "down",
  37: "left",
  39: "right",
  // Android / Fire TV DPAD
  19: "up",
  20: "down",
  21: "left",
  22: "right",
};

export const CENTER_KEYCODES = new Set([13, 23, 32]);
const BACK_KEYCODES = new Set([27, 4, 461, 10009, 166]);
const BACK_KEYS = new Set(["Escape", "Esc", "BrowserBack", "GoBack", "Back"]);

const MODAL_SELECTOR = '[role="dialog"], [aria-modal="true"]';
const LOCAL_KEYBOARD_SELECTOR = [
  '[role="listbox"]',
  '[role="menu"]',
  '[role="grid"]',
  '[role="tree"]',
  '[role="tablist"]',
].join(", ");

const AXIS_TOLERANCE = 24;

export let activeSearchEditEl: HTMLElement | null = null;
let lastFocusedEl: HTMLElement | null = null;
let focusStylesInjected = false;

export function resetActiveSearchEditEl() {
  activeSearchEditEl = null;
}

export function isEditable(el: HTMLElement | null) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * When typing in a field, arrows move the caret — but at the edges (or Up/Down
 * on a single-line input) they should leave the field for spatial nav instead
 * of trapping focus until Back.
 */
export function caretAllowsNavEscape(el: HTMLElement, dir: Dir): boolean {
  if (el instanceof HTMLSelectElement) return true;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return dir === "up" || dir === "down";
  }

  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start == null || end == null) return dir === "up" || dir === "down";
  if (start !== end && (dir === "left" || dir === "right")) return false;

  const value = el.value;
  if (dir === "left") return start === 0;
  if (dir === "right") return end === value.length;

  const multiline = el instanceof HTMLTextAreaElement;
  if (!multiline) return true; // single-line: Up/Down always leave

  if (dir === "up") return !value.slice(0, start).includes("\n");
  if (dir === "down") return !value.slice(end).includes("\n");
  return false;
}

export function clearSearchEditMode() {
  if (!activeSearchEditEl) return;
  activeSearchEditEl.removeAttribute("data-search-editing");
  activeSearchEditEl = null;
}

/**
 * Fields that use HTPC search-edit mode (Enter arms caret typing).
 * Prefer type/role/inputmode — not translated label text.
 */
export function isSearchLikeField(el: HTMLElement | null) {
  if (!el) return false;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;

  const type = (el.getAttribute("type") || "").toLowerCase();
  const role = (el.getAttribute("role") || "").toLowerCase();
  const inputMode = (el.getAttribute("inputmode") || "").toLowerCase();
  return type === "search" || role === "searchbox" || inputMode === "search";
}

export function isVisible(el: HTMLElement) {
  if (!el.isConnected) return false;
  if (el.closest("[data-tv-nav-exclude]")) return false;
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;

  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    parseFloat(style.opacity) === 0
  ) {
    return false;
  }

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (el.getClientRects().length === 0) return false;

  return true;
}

export function isInSidebar(el: HTMLElement): boolean {
  return !!el.closest("[data-harbor-sidebar]");
}

/** Horizontal top chrome (TopDock / Royal / etc.) — not the left sidebar. */
export function isInTopChrome(el: HTMLElement): boolean {
  return !!el.closest("[data-tv-top-chrome]");
}

export function isInNav(el: HTMLElement): boolean {
  if (isInTopChrome(el)) return false;
  return !!el.closest("[data-tv-nav-zone], [data-harbor-sidebar], [data-harbor-nav]");
}

export function isInHero(el: HTMLElement): boolean {
  return !!el.closest("[data-tv-hero-zone]");
}

export function zoneOf(el: HTMLElement): TvNavZone {
  if (isInTopChrome(el)) return "chrome";
  if (isInNav(el)) return "nav";
  if (isInHero(el)) return "hero";
  return "content";
}

export function getSoundType(el: HTMLElement): "light" | "movie" {
  if (isInNav(el)) return "light";
  if (
    el.closest(
      '[role="dialog"], [role="menu"], [role="tablist"], [role="switch"], form, .settings-panel',
    )
  ) {
    return "light";
  }

  const isMovieContainer = el.closest(
    "[data-media-card], [data-movie-card], .media-card, [data-tv-hero-zone]",
  );
  if (
    isMovieContainer &&
    (el.querySelector("img") ||
      el.hasAttribute("data-media-card") ||
      el.classList.contains("media-card"))
  ) {
    return "movie";
  }
  return "light";
}

export function getTopFocusScope(): HTMLElement | null {
  const scopes = Array.from(document.querySelectorAll<HTMLElement>("[data-tv-focus-scope]")).filter(
    isVisible,
  );
  return scopes.length ? scopes[scopes.length - 1]! : null;
}

export function getFocusable(root: ParentNode = getTopFocusScope() ?? document): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)).filter(isVisible);
  const set = new Set(all);
  return all.filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (set.has(p)) return false;
    }
    return true;
  });
}

export function getFocusableInZone(
  zone: TvNavZone,
  root: ParentNode = getTopFocusScope() ?? document,
): HTMLElement[] {
  return getFocusable(root).filter((el) => zoneOf(el) === zone);
}

export function getRect(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    right: r.right,
    top: r.top,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
  };
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function findClosestByY(from: HTMLElement, candidates: HTMLElement[]): HTMLElement | null {
  const src = getRect(from);
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const el of candidates) {
    if (el === from) continue;
    const dst = getRect(el);
    const dy = Math.abs(dst.cy - src.cy);
    const dx = Math.abs(dst.cx - src.cx);
    const score = dy * 10 + dx;

    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** Next/prev row — skips same-row siblings (sliders, paired buttons). */
export function findVerticalNeighbor(
  active: HTMLElement,
  candidates: HTMLElement[],
  dir: "up" | "down",
): HTMLElement | null {
  const src = getRect(active);
  const rowSlop = Math.max(24, src.height * 0.6);
  const vertical = candidates.filter((el) => {
    if (el === active) return false;
    const dst = getRect(el);
    return dir === "down" ? dst.cy > src.cy + rowSlop : dst.cy < src.cy - rowSlop;
  });
  if (!vertical.length) return null;

  let bestRowCy = dir === "down" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (const el of vertical) {
    const cy = getRect(el).cy;
    if (dir === "down" ? cy < bestRowCy : cy > bestRowCy) bestRowCy = cy;
  }
  const row = vertical.filter((el) => Math.abs(getRect(el).cy - bestRowCy) < rowSlop);
  return getSpatialOrder(row)[0] ?? null;
}

export function hasHorizontalNeighborInRow(
  active: HTMLElement,
  dir: "left" | "right",
  root: ParentNode = getTopFocusScope() ?? document,
): boolean {
  const src = getRect(active);
  const all = getFocusable(root).filter((el) => el !== active && !isInNav(el));
  const rowSlop = Math.max(24, src.height * 0.6);

  return all.some((el) => {
    const dst = getRect(el);
    if (Math.abs(dst.cy - src.cy) >= rowSlop) return false;
    return dir === "left" ? dst.cx < src.cx - 8 : dst.cx > src.cx + 8;
  });
}

export function getActiveModal(target: HTMLElement | null): HTMLElement | null {
  const owned = target?.closest<HTMLElement>(MODAL_SELECTOR);
  if (owned && isVisible(owned)) return owned;
  const visible = Array.from(document.querySelectorAll<HTMLElement>(MODAL_SELECTOR)).filter(
    isVisible,
  );
  return visible[visible.length - 1] ?? null;
}

export function isLocallyManaged(target: HTMLElement | null): boolean {
  return !!target?.closest(LOCAL_KEYBOARD_SELECTOR);
}

export function getDirection(e: KeyboardEvent): Dir | null {
  if (KEY_TO_DIR[e.key]) return KEY_TO_DIR[e.key];
  if (CODE_TO_DIR[e.code]) return CODE_TO_DIR[e.code];
  return KEYCODE_TO_DIR[e.keyCode] ?? null;
}

export function isBackKey(e: KeyboardEvent): boolean {
  if (BACK_KEYS.has(e.key)) return true;
  if (BACK_KEYCODES.has(e.keyCode)) return true;
  return false;
}

export function getInitialFocus(list: HTMLElement[]) {
  return list.find((el) => el.hasAttribute("data-tv-initial-focus")) ?? list[0] ?? null;
}

const NAV_FOCUS_SELECTOR =
  "[data-tv-top-chrome] button, [data-tv-top-chrome] a[href], [data-harbor-nav][data-active], [data-harbor-nav], [data-tv-nav-zone] button, [data-harbor-sidebar] button, [data-tv-nav-zone] a[href], [data-tv-nav-zone] [data-focusable='true']";

export function focusNavChrome() {
  const nav = document.querySelector<HTMLElement>(NAV_FOCUS_SELECTOR);
  if (nav) focusElement(nav);
}

/** Focus the page's primary control (Play, etc.) or first content focusable. */
export function focusTvPageDefault(): void {
  ensureFocusStyles();
  const scope = getTopFocusScope();
  if (scope) {
    const scoped = getFocusable(scope);
    const first = getInitialFocus(scoped);
    if (first) focusElement(first);
    return;
  }
  const marked = document.querySelector<HTMLElement>("[data-tv-initial-focus]");
  if (marked && isVisible(marked)) {
    focusElement(marked);
    return;
  }
  const content = getFocusableInZone("content");
  const first = getInitialFocus(content);
  if (first) focusElement(first);
}

/**
 * Move TV focus to the first focusable inside `root` (e.g. a settings card
 * after search teleport). Clears search-edit mode so keys aren't stuck in the
 * search field. Falls back to focusing `root` itself when it has no controls.
 */
export function focusTvFirstIn(
  root: ParentNode,
  scroll: TvNavScroll = "none",
): boolean {
  clearSearchEditMode();
  const active =
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  // Leave the settings search box (or whatever had focus) before moving.
  if (active && (!(root instanceof Node) || !root.contains(active))) {
    active.blur();
  }

  const first = getInitialFocus(getFocusable(root));
  if (first) {
    focusElement(first, scroll);
    return true;
  }
  if (root instanceof HTMLElement) {
    if (!root.hasAttribute("tabindex")) root.tabIndex = -1;
    focusElement(root, scroll);
    return true;
  }
  return false;
}

export const MODAL_CLOSE_SELECTOR = "[data-tv-modal-close]";

/** Close the top TV focus-scoped modal via its close control, if any. */
export function closeTopFocusScope(): boolean {
  if (isModalOverlayOpen()) {
    void modalOverlayClose();
    return true;
  }
  // Player root traps focus but is not dismissible — skip it.
  const scopes = Array.from(document.querySelectorAll<HTMLElement>("[data-tv-focus-scope]")).filter(
    (el) => isVisible(el) && !el.hasAttribute("data-harbor-player"),
  );
  const scope = scopes[scopes.length - 1] ?? null;
  if (!scope) return false;
  const closer = scope.querySelector<HTMLElement>(MODAL_CLOSE_SELECTOR);
  if (!closer) return false;
  closer.click();
  return true;
}

function ensureFocusStyles() {
  if (focusStylesInjected || typeof document === "undefined") return;
  focusStylesInjected = true;

  const style = document.createElement("style");
  style.setAttribute("data-tv-focus-styles", "true");
  style.textContent = `
    button[data-tv-focused="true"],
    a[data-tv-focused="true"],
    select[data-tv-focused="true"],
    summary[data-tv-focused="true"],
    [tabindex][data-tv-focused="true"],
    [data-tv-focused="true"]:focus,
    [data-tv-focused="true"]:focus-visible {
      outline: none !important;
      box-shadow: 0 0 0 4px var(--tv-focus-ring, #ffffff), 0 0 0 8px rgba(0,0,0,0.35) !important;
      transition: box-shadow 120ms ease;
      z-index: 20;
      position: relative;
    }
  `;
  document.head.appendChild(style);
}

export function focusElement(el: HTMLElement, scroll: TvNavScroll = "center") {
  ensureFocusStyles();

  if (lastFocusedEl && lastFocusedEl !== el) clearTvFocusRing();

  el.setAttribute("data-tv-focused", "true");
  lastFocusedEl = el;
  el.focus({ preventScroll: true });

  if (isInHero(el)) {
    // Anime/home scroll inside <main overflow-y-auto>, not the window.
    const scroller =
      el.closest<HTMLElement>("[data-tv-hero-zone]")?.closest<HTMLElement>(
        '[class*="overflow-y-auto"], [class*="overflow-auto"]',
      ) ?? null;
    if (scroller) scroller.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    else window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    return;
  }
  // Fixed chrome must not scroll the page; opt in with data-tv-scroll-focus (e.g. settings nav).
  if (scroll === "none" || isInTopChrome(el)) return;
  if ((isInSidebar(el) || isInNav(el)) && !el.closest("[data-tv-scroll-focus]")) return;
  // Vertical moves center the focused row/card; horizontal stays nearest so
  // Left/Right in a shelf doesn't yank the page up/down.
  el.scrollIntoView({
    block: scroll === "center" ? "center" : "nearest",
    inline: "nearest",
    behavior: "smooth",
  });
}

export function clearTvFocusRing() {
  lastFocusedEl?.removeAttribute("data-tv-focused");
  lastFocusedEl = null;
}

export function enterSearchEditMode(el: HTMLElement) {
  activeSearchEditEl = el;
  el.setAttribute("data-search-editing", "true");
  el.focus({ preventScroll: true });

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {}
  }
}

export function exitSearchEditMode() {
  if (!activeSearchEditEl) return;
  const el = activeSearchEditEl;
  activeSearchEditEl = null;
  el.removeAttribute("data-search-editing");
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.blur();
  }
  focusElement(el);
}

export function findBest(
  focused: HTMLElement,
  candidates: HTMLElement[],
  dir: Dir,
): HTMLElement | null {
  const src = getRect(focused);
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const horizontal = dir === "left" || dir === "right";
  const rowSlop = Math.max(24, src.height * 0.6);

  for (const el of candidates) {
    if (el === focused) continue;
    const dst = getRect(el);

    if (dir === "right" && dst.cx <= src.cx + AXIS_TOLERANCE) continue;
    if (dir === "left" && dst.cx >= src.cx - AXIS_TOLERANCE) continue;
    if (dir === "down" && dst.cy <= src.cy + AXIS_TOLERANCE) continue;
    if (dir === "up" && dst.cy >= src.cy - AXIS_TOLERANCE) continue;

    // Shelves: Left/Right stay on the current row — never hop to the next shelf.
    if (horizontal && Math.abs(dst.cy - src.cy) >= rowSlop) continue;

    const primary =
      dir === "right"
        ? Math.max(0, dst.left - src.right)
        : dir === "left"
          ? Math.max(0, src.left - dst.right)
          : dir === "down"
            ? Math.max(0, dst.top - src.bottom)
            : Math.max(0, src.top - dst.bottom);

    const secondary = horizontal ? Math.abs(dst.cy - src.cy) : Math.abs(dst.cx - src.cx);
    const axisOverlap = horizontal
      ? overlap(src.top, src.bottom, dst.top, dst.bottom)
      : overlap(src.left, src.right, dst.left, dst.right);
    const overlapBonus = axisOverlap > 0 ? axisOverlap * 10 : 0;
    const score = primary * 10 + secondary * 3 - overlapBonus;

    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

export function getSpatialOrder(list: HTMLElement[]) {
  return [...list].sort((a, b) => {
    const ra = getRect(a);
    const rb = getRect(b);
    if (Math.abs(ra.top - rb.top) > 8) return ra.top - rb.top;
    return ra.left - rb.left;
  });
}
