/**
 * App-owned live viewport integration. Does not modify the upstream runtime.
 *
 * A registered region is excluded from the UI variant's measured drawing using
 * its documented data-t-generate-skip attribute. It remains real, live content
 * beneath the original ancestor opacity/clip/filter reveal. No token buffering,
 * DOM cloning, request ownership, or artifact arrival claims happen here.
 *
 * Requirements for each app-owned [data-generation-live-region] boundary:
 * - A definite, nonzero layout slot whose size does not depend on its contents.
 * - Paint containment (contain: layout paint is a suitable declaration), with
 *   overflow: auto/hidden as appropriate. Paint containment prevents even an
 *   internally positioned descendant from painting over measured chrome.
 * - Register after fonts/layout have settled enough to establish that slot.
 *   Do not mark an auto-height StreamingText node instead of its viewport.
 *
 * This helper owns no observer, timer, event listener, or animation frame.
 * The caller must check stable() before measurement and on its geometry monitor.
 */

const LIVE_REGION_ATTRIBUTE = 'data-generation-live-region';
const UPSTREAM_SKIP_ATTRIBUTE = 'data-t-generate-skip';
const GEOMETRY_TOLERANCE = 0.5;

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
type Boundary = Readonly<{
  element: HTMLElement;
  rect: Rect;
  marker: string;
}>;

export interface LiveGenerationRegions {
  /** Cached element identities, including nested registered boundaries. */
  readonly regions: readonly HTMLElement[];
  /**
   * True only for mutations wholly inside a registered boundary. Child-list
   * changes on the boundary itself are internal. EVERY boundary attribute
   * change remains external, including class, style, hidden, and the marker.
   */
  isInternalMutation(record: MutationRecord): boolean;
  /**
   * Scroll events on a boundary are internal: contains(event.target).
   * A finite animation ON a boundary is not internal; use
   * contains((animation.effect as KeyframeEffect).target, false).
   * Do not use this to exempt pointer, keyboard, or focus interaction.
   */
  contains(target: EventTarget | null, includeBoundary?: boolean): boolean;
  /** Checks connectivity, registration, paint containment and boundary rects. */
  stable(): boolean;
  /**
   * Returns false and writes nothing if the boundaries are no longer stable.
   * Keep the marker until the ORIGINAL runtime's deferred measurement completes.
   * Calling twice without restore is harmless and preserves the first baseline.
   */
  applySkip(): boolean;
  /** Restore exact original skip-attribute presence AND value; idempotent. */
  restore(): void;
}

function rectOf(element: HTMLElement): Rect {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

function sameRect(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) <= GEOMETRY_TOLERANCE
    && Math.abs(a.y - b.y) <= GEOMETRY_TOLERANCE
    && Math.abs(a.width - b.width) <= GEOMETRY_TOLERANCE
    && Math.abs(a.height - b.height) <= GEOMETRY_TOLERANCE;
}

function hasPaintContainment(element: HTMLElement): boolean {
  // `content` and `strict` both include paint containment. Inspect the resolved
  // declaration rather than assuming overflow alone contains positioned nodes.
  return /(?:^|\s)(?:paint|content|strict)(?:\s|$)/.test(getComputedStyle(element).contain);
}

function validRect(rect: Rect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.width > 0 && rect.height > 0;
}

export function createLiveGenerationRegions(root: HTMLElement): LiveGenerationRegions {
  // An attribute on the runtime target itself is deliberately not registration:
  // the whole target must still be measured and drawn by the original runtime.
  const boundaries: readonly Boundary[] = Array.from(
    [...root.querySelectorAll<HTMLElement>(`[${LIVE_REGION_ATTRIBUTE}]`)].filter(element => validRect(rectOf(element))),
    element => ({
      element,
      rect: rectOf(element),
      marker: element.getAttribute(LIVE_REGION_ATTRIBUTE)!,
    }),
  );
  const regions = Object.freeze(boundaries.map(boundary => boundary.element));
  const boundaryElements = new Set(regions);
  // null means the attribute was absent; '' means present with an empty value.
  let originalSkip: Map<HTMLElement, string | null> | undefined;

  const owns = (boundary: Boundary): boolean => root.isConnected
    && boundary.element.isConnected
    && root.contains(boundary.element)
    && boundary.element.getAttribute(LIVE_REGION_ATTRIBUTE) === boundary.marker;

  const contains = (target: EventTarget | null, includeBoundary = true): boolean => {
    if (!(target instanceof Node)) return false;
    // A nested registered boundary is still a boundary, not just an internal
    // descendant of an outer one. Its own animations/attributes stay guarded.
    if (!includeBoundary && boundaryElements.has(target as HTMLElement)) return false;
    return boundaries.some(boundary => owns(boundary)
      && (includeBoundary || boundary.element !== target)
      && boundary.element.contains(target));
  };

  const stable = (): boolean => root.isConnected && boundaries.every(boundary => {
    if (!owns(boundary) || !validRect(boundary.rect)) return false;
    const current = rectOf(boundary.element);
    return validRect(current) && sameRect(current, boundary.rect)
      && hasPaintContainment(boundary.element);
  });

  const restore = (): void => {
    if (!originalSkip) return;
    const saved = originalSkip;
    originalSkip = undefined;
    // Detached nodes are restored as well, so an old marker cannot leak into a
    // later remount/reuse. This helper never writes the live-registration attr.
    for (const [element, value] of saved) {
      if (value === null) element.removeAttribute(UPSTREAM_SKIP_ATTRIBUTE);
      else element.setAttribute(UPSTREAM_SKIP_ATTRIBUTE, value);
    }
  };

  return {
    regions,
    contains,
    stable,
    isInternalMutation(record): boolean {
      if (!contains(record.target)) return false;
      if (record.type === 'attributes') return !boundaryElements.has(record.target as HTMLElement);
      if (record.type === 'characterData') return true;
      if (record.type !== 'childList') return false;
      // Replacing/removing a nested registered viewport changes ownership even
      // when the record's parent is inside an outer registered viewport.
      for (const removed of record.removedNodes) {
        if (regions.some(region => removed === region || removed.contains(region))) return false;
      }
      return true;
    },
    applySkip(): boolean {
      if (!stable()) return false;
      if (originalSkip) return true;
      originalSkip = new Map(regions.map(element => [element, element.getAttribute(UPSTREAM_SKIP_ATTRIBUTE)]));
      try {
        for (const element of regions) element.setAttribute(UPSTREAM_SKIP_ATTRIBUTE, '');
      } catch (error) {
        restore();
        throw error;
      }
      return true;
    },
    restore,
  };
}

/**
 * Integration checklist (caller responsibilities, not executable wiring):
 *
 * 1. Preparation: create one registry for this entrance. Ignore a batch only
 *    when EVERY record isInternalMutation(record), and stable() is still true.
 *    Exclude finite animations only with contains(effect.target, false).
 *    Exclude live-region images from the parent's decode barrier; any ready
 *    typed image keeps its own child decode/layout requirement after arrival.
 *    Recreate the registry only before measurement if external layout settles;
 *    never rebaseline an already-running drawing after content moves.
 * 2. Original measurement: live.applySkip() BEFORE excludeClippedParts(root).
 *    Keep both exclusions through the upstream deferred __tGenLayer append.
 *    Restore clipped exclusions first, then live.restore(), before first tick.
 *    Start boundary-attribute observation after these owned temporary writes.
 *    These writes intentionally do NOT pass isInternalMutation().
 * 3. Runtime: ignore only internal mutation records and scroll targets. Check
 *    live.stable() alongside root/native geometry every monitor frame. Keep all
 *    ordinary input, scene, owner, resize, visibility and exit cancellation.
 * 4. Artifact coverage: skip every piece for which live.contains(piece) is true.
 *    Excluded pieces were not drawn. Keep arrival eligibility; ReadyArtifact
 *    must wait until the parent releases ownership, then decode/layout/run once.
 * 5. Every exit path (throw, cancellation, reduced motion, teardown) calls
 *    live.restore(). Do not use upstream skip-attribute presence as the runtime
 *    mutation exemption: this helper's identity registry survives restoration.
 * 6. Register ONLY mounted visible boundaries. A hidden/zero-size marked region
 *    deliberately makes stable() false rather than silently ignoring later work.
 *    Hidden mounted surfaces need their own registry when they become active.
 */
