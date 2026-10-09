/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cut priorities between structural elements: where two of them overlap,
 * the one of higher priority cuts the other (a column through a wall, a slab
 * over the wall's head). Written as IfcRelInterferesElements with
 * ImpliedOrder TRUE — the RelatedElement (the cutter) is subtracted from the
 * RelatingElement — which the mesher applies like an opening, so both
 * elements keep their own parametric bodies and every edit re-cuts.
 *
 * The priority is per class (footing 95 › column 90 › beam 80 › member 75 ›
 * slab 60 › wall 50 › plate 40), overridden per element by
 * `Pset_IfcLiteCutPriority.Priority` (0 … 100; equal priorities do not cut).
 * Overlap is tested on each element's plan footprint (convex hull, separating
 * axes) and height range, in the project's frame. Only relationships this
 * module wrote (Name 'IfcLite cut') are ever removed.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { toNativeLength, type SpatialAnchor } from './anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';
import { applyFrame, placementInAncestor, refId, type Vec3 } from './host-geometry-frame.js';
import { elementBodyPoints } from './element-geometry-points.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { schemaAttributes, schemaRegistry, canonicalEntity } from './schema-attributes.js';

export const CUT_PRIORITY_PSET = 'Pset_IfcLiteCutPriority';
export const CUT_PRIORITY_PROP = 'Priority';
const CUT_NAME = 'IfcLite cut';

/** Default priorities by class (UPPER CASE); a class not listed takes no part. */
export const DEFAULT_CUT_PRIORITY: Readonly<Record<string, number>> = {
  IFCFOOTING: 95, IFCCOLUMN: 90, IFCCOLUMNSTANDARDCASE: 90, IFCBEAM: 80, IFCBEAMSTANDARDCASE: 80, IFCMEMBER: 75, IFCMEMBERSTANDARDCASE: 75,
  IFCSLAB: 60, IFCSLABSTANDARDCASE: 60, IFCWALL: 50, IFCWALLSTANDARDCASE: 50, IFCPLATE: 40, IFCPLATESTANDARDCASE: 40,
};

const PARTICIPANTS = Object.keys(DEFAULT_CUT_PRIORITY);

type V2 = [number, number];

interface Footprint { hull: V2[]; zMin: number; zMax: number }

/** Lower convex hull + upper (monotone chain); counter-clockwise. */
function convexHull(points: V2[]): V2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: V2[] = [], upper: V2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Whether two convex polygons overlap by more than `eps` along every separating axis. */
function hullsOverlap(a: V2[], b: V2[], eps: number): boolean {
  if (a.length === 0 || b.length === 0) return false;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-12) continue;
      const n: V2 = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
      const range = (poly2: V2[]) => {
        let lo = Infinity, hi = -Infinity;
        for (const v of poly2) { const d = v[0] * n[0] + v[1] * n[1]; lo = Math.min(lo, d); hi = Math.max(hi, d); }
        return [lo, hi];
      };
      const [al, ah] = range(a), [bl, bh] = range(b);
      if (Math.min(ah, bh) - Math.max(al, bl) <= eps) return false;
    }
  }
  return true;
}

function footprint(r: AnchorEntityReader, elementId: number): Footprint | null {
  const placementId = refId(r.entity(elementId)?.attributes[5]);
  const frame = placementId === null ? null : placementInAncestor(r, placementId, null);
  if (!frame) return null;
  const pts = elementBodyPoints(r, elementId).map((p) => applyFrame(frame, p as Vec3));
  if (pts.length < 2) return null;
  return {
    hull: convexHull(pts.map((p) => [p[0], p[1]] as V2)),
    zMin: Math.min(...pts.map((p) => p[2])), zMax: Math.max(...pts.map((p) => p[2])),
  };
}

function nominal(v: unknown): unknown {
  if (v && typeof v === 'object' && 'typed' in v) return (v as { typed: { value: unknown } }).typed.value;
  if (v && typeof v === 'object' && 'value' in v) return (v as { value: unknown }).value;
  return v;
}

/** An element's cut priority: its own override, else its class's; null when it takes no part. */
export function cutPriorityOf(store: IfcDataStore, elementId: number, view?: MutablePropertyView | null): number | null {
  const type = new AnchorEntityReader(store, view).entity(elementId)?.type.toUpperCase();
  const base = type ? DEFAULT_CUT_PRIORITY[type] : undefined;
  if (base === undefined) return null;
  const raw = nominal(view?.getPropertyValue(elementId, CUT_PRIORITY_PSET, CUT_PRIORITY_PROP) ?? null);
  const own = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN;
  return Number.isFinite(own) ? Math.max(0, Math.min(100, own)) : base;
}

/** The structural elements cut priorities apply to, in the model. */
export function cutParticipants(store: IfcDataStore, view?: MutablePropertyView | null): number[] {
  const r = new AnchorEntityReader(store, view);
  return PARTICIPANTS.flatMap((type) => [...r.ids(type)]);
}

interface CutRel { relId: number; cut: number; cutter: number; ours: boolean }

function readCuts(r: AnchorEntityReader): CutRel[] {
  const out: CutRel[] = [];
  for (const relId of r.ids('IFCRELINTERFERESELEMENTS')) {
    const rel = r.entity(relId);
    const cut = refId(rel?.attributes[4]), cutter = refId(rel?.attributes[5]);
    if (!rel || cut === null || cutter === null) continue;
    out.push({ relId, cut, cutter, ours: rel.attributes[2] === CUT_NAME });
  }
  return out;
}

export interface CutSyncResult {
  added: number;
  removed: number;
  /** Elements whose mesh the change re-cuts (both ends of every added or removed cut). */
  remesh: number[];
}

/**
 * Bring the cuts of `elements` up to date against `candidates` (default:
 * every participant in the model): add the cut each overlapping pair of
 * different priority needs, remove this module's cuts that no longer apply
 * (or whose element is gone). The caller owns the atomic commit.
 */
export function syncCutsInStore(
  store: IfcDataStore, editor: StoreEditor, anchor: Pick<SpatialAnchor, 'ownerHistoryId' | 'schema' | 'guidRandom' | 'lengthUnitScale'>,
  elements: Iterable<number>, candidates?: Iterable<number>,
): CutSyncResult {
  const view = editor.getMutationView();
  const r = new AnchorEntityReader(store, view);
  const result: CutSyncResult = { added: 0, removed: 0, remesh: [] };
  const registry = schemaRegistry(anchor.schema, 'syncCutsInStore');
  const relClass = canonicalEntity(registry, 'IfcRelInterferesElements');
  if (!relClass) return result;
  const remesh = new Set<number>();
  const touched = new Set([...elements].filter((id) => r.entity(id)));
  const pool = [...new Set([...(candidates ?? cutParticipants(store, view)), ...touched])].filter((id) => r.entity(id));
  const prints = new Map<number, Footprint | null>();
  const printOf = (id: number) => {
    if (!prints.has(id)) prints.set(id, footprint(r, id));
    return prints.get(id)!;
  };
  const priorities = new Map<number, number | null>();
  const priorityOf = (id: number) => {
    if (!priorities.has(id)) priorities.set(id, cutPriorityOf(store, id, view));
    return priorities.get(id)!;
  };
  // A millimetre of real overlap, in the file's units.
  const eps = toNativeLength(anchor, 0.001);

  const wanted = new Map<string, { cut: number; cutter: number }>();
  for (const id of touched) {
    const pa = priorityOf(id), fa = pa === null ? null : printOf(id);
    if (pa === null || !fa) continue;
    for (const other of pool) {
      if (other === id) continue;
      const pb = priorityOf(other);
      if (pb === null || pb === pa) continue;
      const fb = printOf(other);
      if (!fb || Math.min(fa.zMax, fb.zMax) - Math.max(fa.zMin, fb.zMin) <= eps || !hullsOverlap(fa.hull, fb.hull, eps)) continue;
      const [cut, cutter] = pa < pb ? [id, other] : [other, id];
      wanted.set(`${cut}:${cutter}`, { cut, cutter });
    }
  }

  for (const rel of readCuts(r)) {
    const key = `${rel.cut}:${rel.cutter}`;
    if (wanted.has(key)) { wanted.delete(key); continue; }
    if (!rel.ours) continue;
    const gone = !r.entity(rel.cut) || !r.entity(rel.cutter);
    if (!gone && !touched.has(rel.cut) && !touched.has(rel.cutter)) continue;
    editor.removeEntity(rel.relId);
    result.removed++;
    for (const id of [rel.cut, rel.cutter]) if (r.entity(id)) remesh.add(id);
  }
  for (const { cut, cutter } of wanted.values()) {
    const attrs = schemaAttributes(registry, relClass, {
      GlobalId: generateIfcGuid(anchor.guidRandom), OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId), Name: CUT_NAME,
      RelatingElement: `#${cut}`, RelatedElement: `#${cutter}`, InterferenceType: 'Cut', ImpliedOrder: true,
    }, 'syncCutsInStore');
    editor.addEntity(relClass, attrs as Parameters<StoreEditor['addEntity']>[1]);
    result.added++;
    remesh.add(cut);
    remesh.add(cutter);
  }
  result.remesh = [...remesh];
  return result;
}
