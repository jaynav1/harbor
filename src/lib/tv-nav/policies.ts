import { SFX } from "@/lib/sfx";
import {
  findBest,
  findClosestByY,
  findVerticalNeighbor,
  focusElement,
  getFocusable,
  getFocusableInZone,
  getInitialFocus,
  getSoundType,
  isInTopChrome,
  type TvNavPolicy,
} from "./core";

/** Top chrome Down → first content item (stock main behavior). */
const chromeDownToContent: TvNavPolicy = ({ active, dir, root }) => {
  if (!active || dir !== "down" || !isInTopChrome(active)) return false;
  const contentItems = getFocusableInZone("content", root);
  const first = getInitialFocus(contentItems);
  if (!first) return false;
  SFX.navigate(dir, getSoundType(first));
  focusElement(first, "center");
  return true;
};

/**
 * Settings column: Up/Down move by row (skip horizontal neighbors like slider
 * thumbs / paired buttons). JumpBar is excluded via data-tv-nav-exclude so
 * below-the-fold Export/Restore aren't stolen by the fixed chip rail.
 */
const settingsListNav: TvNavPolicy = ({ active, dir }) => {
  if (!active || (dir !== 'up' && dir !== 'down')) return false;
  const listRoot = active.closest<HTMLElement>('[data-tv-list-nav]');
  if (!listRoot) return false;
  const items = getFocusable(listRoot);
  const next = findVerticalNeighbor(active, items, dir);
  if (next) {
    SFX.navigate(dir, getSoundType(next));
    focusElement(next, 'center');
    return true;
  }
  // Edge of the settings column — stay put (don't leap to JumpBar/sidebar).
  return true;
};

/**
 * Hero is its own strip. Stock: Down → content; Up does nothing (stay in hero).
 * Runs after we know `active` is in the zone pool, before spatial findBest.
 */
const heroVertical: TvNavPolicy = ({ active, dir, root, zone }) => {
  if (!active || zone !== "hero" || (dir !== "up" && dir !== "down")) return false;
  if (dir === "down") {
    const contentItems = getFocusableInZone("content", root);
    const first = getInitialFocus(contentItems);
    if (first) {
      SFX.navigate(dir, getSoundType(first));
      focusElement(first, "center");
    }
  }
  return true;
};

/** Content with nowhere above → enter the top chrome strip. */
const contentUpToChrome: TvNavPolicy = ({ active, dir, root, zone }) => {
  if (!active || dir !== "up" || zone !== "content") return false;
  const topItems = getFocusable(root).filter(isInTopChrome);
  const target = findBest(active, topItems, "up") ?? findClosestByY(active, topItems);
  if (!target) return false;
  SFX.navigate(dir, getSoundType(target));
  focusElement(target, "none");
  return true;
};

/** Surface policies that run after sidebar engine, before the zone pool check. */
export const earlyTvNavPolicies: TvNavPolicy[] = [
  settingsListNav,
  chromeDownToContent,
];

/** Surface policies that run once focus is known to be in the zone pool. */
export const inZoneTvNavPolicies: TvNavPolicy[] = [heroVertical];

/** Surface policies that run when spatial findBest finds nothing. */
export const fallbackTvNavPolicies: TvNavPolicy[] = [contentUpToChrome];
