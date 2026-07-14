import { SFX } from "@/lib/sfx";
import {
  findBest,
  findClosestByY,
  focusElement,
  getActiveModal,
  getFocusable,
  getFocusableInZone,
  getInitialFocus,
  getSoundType,
  getSpatialOrder,
  getTopFocusScope,
  hasHorizontalNeighborInRow,
  isInSidebar,
  isVisible,
  zoneOf,
  type Dir,
  type TvNavCtx,
} from "./core";
import { earlyTvNavPolicies, fallbackTvNavPolicies, inZoneTvNavPolicies } from "./policies";

export function moveFocus(dir: Dir, wrap: boolean = true): void {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const root = getActiveModal(active) ?? getTopFocusScope() ?? document;
  const scroll = dir === "left" || dir === "right" ? "nearest" : "center";

  if (active && dir === "left" && !isInSidebar(active)) {
    if (!hasHorizontalNeighborInRow(active, "left", root)) {
      const sidebarItems = getFocusable(root).filter(isInSidebar);
      const targetNav = findClosestByY(active, sidebarItems);
      if (targetNav) {
        SFX.navigate(dir, getSoundType(targetNav));
        focusElement(targetNav, "none");
        return;
      }
      // Start of a content row with no sidebar — stay put.
      return;
    }
  }

  if (active && dir === "right" && !isInSidebar(active)) {
    // End of a shelf (loaded or still loading) — stay put; Down is how you leave the row.
    if (!hasHorizontalNeighborInRow(active, "right", root)) return;
  }

  if (active && dir === "right" && isInSidebar(active)) {
    const contentItems = getFocusable(root).filter((el) => !isInSidebar(el));
    const targetContent = findClosestByY(active, contentItems);
    if (targetContent) {
      SFX.navigate(dir, getSoundType(targetContent));
      focusElement(targetContent, "center");
      return;
    }
  }

  const zone = active ? zoneOf(active) : "content";
  const all = getFocusableInZone(zone, root);
  const ctx: TvNavCtx = { active, dir, wrap, root, scroll, zone, all };

  // Chrome/search/list edges that don't need an in-zone candidate pool.
  for (const policy of earlyTvNavPolicies) {
    if (policy(ctx)) return;
  }

  if (!all.length) return;

  if (!active || !all.includes(active)) {
    // Prefer page primary CTA over DOM-order (avoids sidebar collapse).
    if (zone === "content") {
      const marked = document.querySelector<HTMLElement>("[data-tv-initial-focus]");
      if (marked && isVisible(marked) && all.includes(marked)) {
        focusElement(marked, "center");
        return;
      }
    }
    const first = getInitialFocus(all);
    if (first) {
      SFX.navigate(dir, getSoundType(first));
      focusElement(first, "center");
    }
    return;
  }

  // Hero (and later surface rules) that replace spatial findBest for a zone.
  for (const policy of inZoneTvNavPolicies) {
    if (policy(ctx)) return;
  }

  const best = findBest(active, all, dir);
  if (best) {
    SFX.navigate(dir, getSoundType(best));
    focusElement(best, scroll);
    return;
  }

  // Don't wrap Left/Right onto another shelf when the current row is exhausted.
  if (dir === "left" || dir === "right") return;

  for (const policy of fallbackTvNavPolicies) {
    if (policy(ctx)) return;
  }

  if (wrap) {
    const ordered = getSpatialOrder(all);
    const idx = ordered.indexOf(active);
    if (idx >= 0) {
      const next =
        dir === "down"
          ? (ordered[idx + 1] ?? ordered[0])
          : (ordered[idx - 1] ?? ordered[ordered.length - 1]);
      if (next) {
        SFX.navigate(dir, getSoundType(next));
        focusElement(next, scroll);
      }
    }
  }
}
