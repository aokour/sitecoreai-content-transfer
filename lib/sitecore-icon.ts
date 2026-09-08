"use client";

import { useCallback, useState } from "react";

// Sitecore's GraphQL returns /-/icon/ URLs which are redirect aliases;
// the actual browser-accessible path uses /temp/iconcache/. That cache isn't
// guaranteed to hold every size, and which sizes exist varies per icon, so we
// try the sizes we want in preference order and let the caller degrade.

/** Sizes to attempt, most-preferred first. We render at 16 CSS px. */
const PREFERRED_SIZES = ["16x16", "32x32"];

/** Matches the /48x48/ style size segment in an icon path. */
const SIZE_SEGMENT = /\/\d+x\d+\//;

/**
 * Browser-accessible URLs for a Sitecore icon, most-preferred first.
 * Callers should walk the list on load failure rather than trusting index 0.
 *
 * The size in the URL Sitecore hands us varies by item (first-level items often
 * come back as 16x16 or 48x48, deeper ones as 32x32), so swap in each preferred
 * size rather than keying off one specific segment — otherwise anything that
 * isn't already the expected size ends up with no fallback at all.
 */
export function getIconUrlCandidates(rawUrl: string): string[] {
  const cached = rawUrl.replace("/-/icon/", "/temp/iconcache/").toLowerCase();
  const size = SIZE_SEGMENT.exec(cached)?.[0];
  if (!size) return [cached];
  const resized = PREFERRED_SIZES.map((s) => cached.replace(size, `/${s}/`));
  // Keep the original size last: if neither preferred size is cached, the size
  // Sitecore actually pointed at is the best remaining guess.
  return [...new Set([...resized, cached])];
}

/**
 * Index of the first candidate known to load for a given raw icon URL, or -1
 * once every candidate has failed. Shared across rows so each distinct icon is
 * probed at most once per session. Not reactive — rows already mounted when a
 * probe fails will each fail once before reading this.
 */
const resolvedIndexByUrl = new Map<string, number>();

function startIndex(rawUrl?: string): number {
  if (!rawUrl) return 0;
  return resolvedIndexByUrl.get(rawUrl) ?? 0;
}

/** Records a failure without ever walking the shared cache backwards. */
function recordFailure(rawUrl: string, next: number) {
  const known = resolvedIndexByUrl.get(rawUrl);
  if (known === -1) return;
  if (known === undefined || next === -1 || next > known) {
    resolvedIndexByUrl.set(rawUrl, next);
  }
}

interface IconState {
  rawUrl: string;
  index: number;
}

/**
 * Resolves a Sitecore icon URL to a renderable `src`, degrading through the
 * available sizes as they fail. `src` is null once nothing is left to try,
 * which is the caller's cue to render a generic fallback glyph.
 */
export function useSitecoreIcon(rawUrl?: string): {
  src: string | null;
  onError: () => void;
} {
  const [state, setState] = useState<IconState>(() => ({
    rawUrl: rawUrl ?? "",
    index: startIndex(rawUrl),
  }));

  // A row keyed by itemId/path shouldn't outlive its icon, but derive rather
  // than trust that — a stale index would point into the wrong candidate list.
  const index =
    state.rawUrl === (rawUrl ?? "") ? state.index : startIndex(rawUrl);

  // Advances from the candidate this render actually rendered, which is by
  // definition the one that just failed. Deriving it from the closure rather
  // than a setState updater keeps the cache write out of the updater (React may
  // skip or double-invoke updaters) and makes a duplicate error event a no-op.
  const onError = useCallback(() => {
    if (!rawUrl || index < 0) return;
    const count = getIconUrlCandidates(rawUrl).length;
    const next = index + 1 >= count ? -1 : index + 1;
    recordFailure(rawUrl, next);
    setState({ rawUrl, index: next });
  }, [rawUrl, index]);

  if (!rawUrl || index < 0) {
    return { src: null, onError };
  }

  return { src: getIconUrlCandidates(rawUrl)[index] ?? null, onError };
}
