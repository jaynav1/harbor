import { useEffect, useRef, type RefObject } from "react";
import { SFX } from "@/lib/sfx";
import {
  CENTER_KEYCODES,
  MODAL_CLOSE_SELECTOR,
  activeSearchEditEl,
  caretAllowsNavEscape,
  clearSearchEditMode,
  clearTvFocusRing,
  closeTopFocusScope,
  enterSearchEditMode,
  exitSearchEditMode,
  focusElement,
  focusNavChrome,
  getActiveModal,
  getDirection,
  getFocusable,
  isBackKey,
  isEditable,
  isLocallyManaged,
  isSearchLikeField,
  isVisible,
  resetActiveSearchEditEl,
  type Dir,
} from "./core";
import { moveFocus } from "./engine";

type TVNavigationOptions = {
  enabled?: boolean;
  wrap?: boolean;
  arrows?: boolean;
  onBack?: () => boolean;
  onBackToNav?: () => void;
};

type RemoteBackFns = {
  onBack?: () => boolean;
  onBackToNav?: () => void;
  wrap?: boolean;
};

let remoteBackFns: RemoteBackFns = {};
let remoteBackOwner: object | null = null;

/**
 * When a popover/menu opens, move TV focus into its data-tv-focus-scope so
 * arrows stay in the menu instead of jumping to page content underneath.
 */
export function useTvFocusScope(open: boolean, rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const scope = root.matches("[data-tv-focus-scope]")
        ? root
        : root.querySelector<HTMLElement>("[data-tv-focus-scope]");
      if (!scope || !isVisible(scope)) return;
      const target =
        scope.querySelector<HTMLElement>("[data-tv-initial-focus]") ??
        getFocusable(scope)[0] ??
        null;
      if (target) focusElement(target);
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, rootRef]);
}

export function useKeyboardNavigation(options: TVNavigationOptions = {}) {
  const { enabled = true, wrap = true, arrows = true, onBack, onBackToNav } = options;
  const onBackRef = useRef(onBack);
  const onBackToNavRef = useRef(onBackToNav);
  const wrapRef = useRef(wrap);
  const arrowsRef = useRef(arrows);
  onBackRef.current = onBack;
  onBackToNavRef.current = onBackToNav;
  wrapRef.current = wrap;
  arrowsRef.current = arrows;

  useEffect(() => {
    if (!enabled) clearTvFocusRing();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const owner = {};

    const runBack = () => {
      SFX.close();
      if (closeTopFocusScope()) return true;
      const modal = getActiveModal(
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
      );
      if (modal) {
        const closer = modal.querySelector<HTMLElement>(MODAL_CLOSE_SELECTOR);
        if (closer) {
          closer.click();
          return true;
        }
        // Dialog without an explicit closer (e.g. search before TvModalClose) —
        // fall through to onBack so App can dismiss it.
      }
      const handled = onBackRef.current ? onBackRef.current() : false;
      if (!handled) {
        if (onBackToNavRef.current) onBackToNavRef.current();
        else focusNavChrome();
      }
      return true;
    };

    remoteBackFns = {
      onBack: () => runBack(),
      onBackToNav: onBackToNav ? () => onBackToNavRef.current?.() : undefined,
      wrap,
    };
    remoteBackOwner = owner;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const target = e.target instanceof HTMLElement ? e.target : null;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      const activeIsSearch = isSearchLikeField(active);
      const isEditingSearch = !!activeSearchEditEl && activeSearchEditEl === active;

      if (e.key === "Escape" && isEditingSearch) {
        e.preventDefault();
        e.stopPropagation();
        SFX.close();
        exitSearchEditMode();
        return;
      }

      if (isBackKey(e)) {
        // Always swallow Back/Escape so WebView/OS never treat it as close-app.
        e.preventDefault();
        e.stopPropagation();
        runBack();
        return;
      }

      if (isLocallyManaged(target)) return;

      const dir = getDirection(e);

      if (dir) {
        if (!arrowsRef.current) return;

        // Any focused text field owns Left/Right for the caret until an edge
        // (and Up/Down on single-line). Includes search overlay, which focuses
        // the input without always setting data-search-editing.
        if (active && isEditable(active)) {
          if (!caretAllowsNavEscape(active, dir)) return;
          if (isEditingSearch) clearSearchEditMode();
        }

        e.preventDefault();
        e.stopPropagation();
        moveFocus(dir, wrapRef.current);
        return;
      }

      if (activeIsSearch && isEditingSearch) return;
      if (isEditable(target) && !isSearchLikeField(target)) return;

      const isCenter = CENTER_KEYCODES.has(e.keyCode) || e.key === "Enter" || e.code === "Enter";
      if (!isCenter) return;
      if (isLocallyManaged(target)) return;

      const currentActive =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!currentActive) return;

      if (isSearchLikeField(currentActive)) {
        e.preventDefault();
        e.stopPropagation();
        SFX.open();
        enterSearchEditMode(currentActive);
        return;
      }

      if (isEditable(currentActive) && !isSearchLikeField(currentActive)) return;

      const nativeClickable = currentActive.matches(
        'button, a[href], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]',
      );
      if (e.key === " " && nativeClickable) return;
      if (e.key === "Enter" && nativeClickable) return;

      e.preventDefault();
      e.stopPropagation();
      currentActive.click();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (remoteBackOwner === owner) {
        remoteBackFns = {};
        remoteBackOwner = null;
      }
      if (activeSearchEditEl) {
        activeSearchEditEl.removeAttribute("data-search-editing");
        resetActiveSearchEditEl();
      }
    };
    // onBack/onBackToNav are mirrored into refs — omit from deps so unstable
    // inline callbacks (e.g. player) don't rebind the capture listener every render.
  }, [enabled, wrap, arrows]);
}

/**
 * Phone touchpad entry point.
 * Arrows call moveFocus directly (synthetic keydown fights player hotkeys).
 * Select/back use DOM click / the registered Back handlers (synthetic Enter/Esc are ignored by Chromium).
 */
export function dispatchTvNav(action: Dir | "select" | "back"): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("harbor:user-activity"));
  }
  if (action === "select") {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (active && !isEditable(active)) active.click();
    return;
  }

  if (action === "back") {
    const handled = remoteBackFns.onBack?.() ?? false;
    if (handled) return;
    if (remoteBackFns.onBackToNav) remoteBackFns.onBackToNav();
    else focusNavChrome();
    return;
  }

  moveFocus(action, remoteBackFns.wrap ?? true);
}
