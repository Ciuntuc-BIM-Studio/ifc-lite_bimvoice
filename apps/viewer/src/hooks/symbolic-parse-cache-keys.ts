/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import { createElementFieldReader } from '@/lib/charts/element-field-reader';
import { effectiveScheduleGroups } from '@/lib/effective-spatial-groups';
import type { OverlayRtcContext } from '../lib/overlay-parse/rtc-context.js';

const FLOAT_BITS = new Float64Array(1);
const FLOAT_WORDS = new Uint32Array(FLOAT_BITS.buffer);

/** One 32-bit word folded into an FNV-1a lane. */
const fold = (h: number, word: number): number => Math.imul(h ^ word, 0x01000193) >>> 0;

/** A well-mixed 32-bit hash of one `id → value` pair under `seed` (murmur3 finaliser). */
function pairHash(seed: number, id: number, value: number): number {
  FLOAT_BITS[0] = value;
  let h = fold(fold(seed, id >>> 0), Math.floor(id / 0x100000000) >>> 0);
  h = fold(fold(h, FLOAT_WORDS[0]), FLOAT_WORDS[1]);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Stable value key for the live lookups used by buildParseResult's buckets:
 * a 64-bit digest of every lookup pair, bounded even for large models (the
 * source's contentKey contract). The pairs are summed, so equivalent maps
 * give the same key whatever their insertion order — without sorting, and
 * in integer arithmetic: a million-element model keyed in milliseconds, not
 * the seconds a sorted BigInt walk over its pairs took on every load.
 */
export function spatialBucketKey(
  elementToStorey: ReadonlyMap<number, number> | undefined,
  storeyElevations: ReadonlyMap<number, number> | undefined,
): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  const pairs = (tag: number, map: ReadonlyMap<number, number> | undefined): void => {
    // The map's tag and size keep the two maps and an absent map distinct.
    a = fold(fold(a, tag), map ? map.size + 1 : 0);
    b = fold(fold(b, tag), map ? map.size + 1 : 0);
    if (!map) return;
    let sumA = 0;
    let sumB = 0;
    for (const [id, value] of map) {
      sumA = (sumA + pairHash(0x9e3779b9 ^ tag, id, value)) >>> 0;
      sumB = (sumB + pairHash(0x7f4a7c15 ^ tag, id, value)) >>> 0;
    }
    a = fold(a, sumA);
    b = fold(b, sumB);
  };
  pairs(1, elementToStorey);
  pairs(2, storeyElevations);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function sourceFlatKey(
  store: IfcDataStore,
  rtc: Exclude<OverlayRtcContext, { mode: 'pending' }>,
): string | null {
  const source = store.source;
  return source?.contentKey ? `${source.contentKey}|${rtc.key}` : null;
}

export interface SpatialBucketSnapshot {
  elementToStorey?: ReadonlyMap<number, number>;
  storeyElevations?: ReadonlyMap<number, number>;
  deletedOwners?: ReadonlySet<number>;
  key: string;
}

let SPATIAL_SNAPSHOTS = new WeakMap<IfcDataStore, {
  elementToStoreyRef: ReadonlyMap<number, number> | undefined;
  storeyElevationsRef: ReadonlyMap<number, number> | undefined;
  mutationVersion: number;
  view: MutablePropertyView | undefined;
  snapshot: SpatialBucketSnapshot;
}>();
let VIEW_IDS = new WeakMap<MutablePropertyView, number>();
let nextViewId = 1;

/**
 * Copy and digest live bucket lookups once per map identity / mutationVersion.
 * Hook renders call this from getParseFor, so a render only does O(1) work;
 * in-place authored hierarchy edits bump mutationVersion and refresh the copy.
 */
export function spatialBucketSnapshotFor(
  store: IfcDataStore,
  mutationVersion: number,
  view?: MutablePropertyView,
): SpatialBucketSnapshot {
  // @raw-entity-enumeration-ok immutable source hierarchy snapshot; live viewers supply the effective schedule graph below
  const elementToStoreyRef = store.spatialHierarchy?.elementToStorey;
  const storeyElevationsRef = store.spatialHierarchy?.storeyElevations;
  const cached = SPATIAL_SNAPSHOTS.get(store);
  if (cached && cached.elementToStoreyRef === elementToStoreyRef
    && cached.storeyElevationsRef === storeyElevationsRef
    && cached.mutationVersion === mutationVersion && cached.view === view) return cached.snapshot;

  // Source hierarchy maps are authoritative until a mutation overlay exists.
  // When it does, rebuild the bucket lookups from the effective relationship
  // graph once per mutation revision. This reflects retargeted/deleted edges
  // and newly authored storeys without scanning the graph for every owner.
  let elementToStorey = elementToStoreyRef ? new Map(elementToStoreyRef) : undefined;
  let storeyElevations = storeyElevationsRef ? new Map(storeyElevationsRef) : undefined;
  if (view?.hasPendingChanges()) {
    const groups = effectiveScheduleGroups(store, view, 'IfcBuildingStorey', { includeSpatialNodes: true });
    elementToStorey = new Map();
    storeyElevations = new Map();
    const reader = createElementFieldReader(store, view);
    const scale = store.lengthUnitScale ?? 1;
    for (const [storeyId, owners] of groups) {
      for (const ownerId of owners) elementToStorey.set(ownerId, storeyId);
      const value = reader.read(storeyId, { kind: 'attribute', attributeName: 'Elevation', valueKind: 'number' });
      const elevation = typeof value === 'number' ? value * scale : store.spatialHierarchy?.storeyElevations.get(storeyId);
      if (elevation !== undefined && Number.isFinite(elevation)) storeyElevations.set(storeyId, elevation);
    }
  }
  const deletedOwners = view?.hasPendingChanges() ? new Set(view.getTombstones()) : undefined;
  const viewId = view && view.hasPendingChanges()
    ? (VIEW_IDS.get(view) ?? (VIEW_IDS.set(view, nextViewId), nextViewId++))
    : 0;
  const key = `${spatialBucketKey(elementToStorey, storeyElevations)}|overlay:${viewId}:${viewId ? mutationVersion : 0}`;
  const snapshot = { elementToStorey, storeyElevations, deletedOwners, key };
  SPATIAL_SNAPSHOTS.set(store, {
    elementToStoreyRef, storeyElevationsRef, mutationVersion, view, snapshot,
  });
  return snapshot;
}

export function resetSpatialBucketSnapshotsForTests(): void {
  SPATIAL_SNAPSHOTS = new WeakMap();
  VIEW_IDS = new WeakMap();
  nextViewId = 1;
}
