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
  getSpatialOrder,
  isInNav,
  isInSidebar,
  isInTopChrome,
  type TvNavPolicy,
} from "./core";

/**
 * Settings column: Up/Down move by row (skip horizontal neighbors like slider
 * thumbs / paired buttons). JumpBar is excluded via data-tv-nav-exclude so
 * below-the-fold Export/Restore aren't stolen by the fixed chip rail.
 */
const settingsListNav: TvNavPolicy = ({ active, dir }) => {
  if (!active || (dir !== "up" && dir !== "down")) return false;
  const listRoot = active.closest<HTMLElement>("[data-tv-list-nav]");
  if (!listRoot) return false;
  const items = getFocusable(listRoot);
  const next = findVerticalNeighbor(active, items, dir);
  if (next) {
    SFX.navigate(dir, getSoundType(next));
    focusElement(next, "center");
    return true;
  }
  // Edge of the settings column — stay put (don't leap to JumpBar/sidebar).
  return true;
};

/** Top chrome Down → hero (Play) when present, else first content item. */
const chromeDownToHero: TvNavPolicy = ({ active, dir, root }) => {
  if (!active || dir !== "down" || !isInTopChrome(active)) return false;
  const heroItems = getFocusableInZone("hero", root);
  const contentItems = getFocusableInZone("content", root);
  const first = getInitialFocus(heroItems) ?? getInitialFocus(contentItems);
  if (!first) return false;
  SFX.navigate(dir, getSoundType(first));
  focusElement(first, "center");
  return true;
};

/**
 * Search query bar is wide — spatial Down prefers centered result rows over the
 * left-aligned Top Match Open CTA. Jump to the marked primary action instead.
 */
const searchQueryBarDown: TvNavPolicy = ({ active, dir }) => {
  if (!active || dir !== "down" || !active.closest("[data-search-query-bar]")) return false;
  const overlay = active.closest<HTMLElement>("[data-search-overlay]");
  const resultsRoot = overlay?.querySelector<HTMLElement>("[data-search-results]");
  if (!resultsRoot) return false;
  const pool = getFocusable(resultsRoot);
  const target = getInitialFocus(pool);
  if (!target) return false;
  SFX.navigate(dir, getSoundType(target));
  focusElement(target, "center");
  return true;
};

/**
 * Hero is its own strip. Up/Down stay on primary/action controls; carousel
 * chevrons & dots are Left/Right only so Up isn't trapped on the prev arrow.
 */
const heroVertical: TvNavPolicy = ({ active, dir, root, zone, all, scroll }) => {
  if (!active || zone !== "hero" || (dir !== "up" && dir !== "down")) return false;
  const verticalPool = all.filter((el) => !el.closest("[data-tv-hero-rail]"));
  const bestInHero = findBest(active, verticalPool, dir);
  if (bestInHero) {
    SFX.navigate(dir, getSoundType(bestInHero));
    focusElement(bestInHero, scroll);
    return true;
  }
  if (dir === "down") {
    const contentItems = getFocusableInZone("content", root);
    const first = getInitialFocus(contentItems);
    if (first) {
      SFX.navigate(dir, getSoundType(first));
      focusElement(first, "center");
    }
    return true;
  }
  // dir === 'up' — leave hero to top chrome, or sidebar when there's no top bar
  const topItems = getFocusable(root).filter(isInTopChrome);
  const chromeTarget =
    findBest(active, topItems, "up") ?? findClosestByY(active, topItems);
  if (chromeTarget) {
    SFX.navigate(dir, getSoundType(chromeTarget));
    focusElement(chromeTarget, "none");
    return true;
  }
  const navItems = getFocusable(root).filter((el) => isInSidebar(el) || isInNav(el));
  const navTarget = findClosestByY(active, navItems) ?? navItems[0] ?? null;
  if (navTarget) {
    SFX.navigate(dir, getSoundType(navTarget));
    focusElement(navTarget, "none");
  }
  return true;
};

/** Content with nowhere above → hero (if any), else top chrome. */
const contentUpToHero: TvNavPolicy = ({ active, dir, root, zone }) => {
  if (!active || dir !== "up" || zone !== "content") return false;
  const heroItems = getFocusableInZone("hero", root);
  const intoHero =
    findBest(active, heroItems, "up") ??
    (heroItems.length ? getSpatialOrder(heroItems)[heroItems.length - 1]! : null);
  if (intoHero) {
    SFX.navigate(dir, getSoundType(intoHero));
    focusElement(intoHero, "center");
    return true;
  }
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
  chromeDownToHero,
  searchQueryBarDown,
];

/** Surface policies that run once focus is known to be in the zone pool. */
export const inZoneTvNavPolicies: TvNavPolicy[] = [
  heroVertical,
];

/** Surface policies that run when spatial findBest finds nothing. */
export const fallbackTvNavPolicies: TvNavPolicy[] = [
  contentUpToHero,
];
