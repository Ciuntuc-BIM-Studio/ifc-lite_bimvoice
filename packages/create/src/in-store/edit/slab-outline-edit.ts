/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reshape a slab's outline after it is placed (a slab, flat roof, plate or
 * space: what `resolveSlabEditChain` reads): its extrusion takes a closed
 * polyline profile at the new outline, written as the slab split writes its
 * kept half (`emitClippedProfile`), at the height and with the thickness it
 * has now. Its placement, openings and metadata stay; the caller re-meshes
 * it (its openings re-cut).
 *
 * Refused for a slab that is not a vertical extrusion of its outline, one
 * whose placement is turned, one sharing its solid with another element, and
 * an outline that is not a simple polygon.
 */

import { editOwnershipRefusal } from '@ifc-lite/export';
import { emitClippedProfile } from '../element-split-slab.js';
import { readElementPlacement } from '../element-relocate.js';
import { getModelLengthUnitScale } from './length-unit-scale.js';
import { resolveSlabEditChain } from './slab-edit.js';
import type { Point2D } from './polygon-clip.js';
import type { EditTarget } from './target.js';

export type SlabOutlineOutcome =
  | { readonly ok: true; readonly remesh: number[] }
  | { readonly ok: false; readonly reason: string };

const cross = (o: Point2D, a: Point2D, b: Point2D) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Whether segments ab and cd cross (touching at an end does not count). */
function crosses(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Why `outline` is not a simple polygon of positive area, or null. */
export function slabOutlineProblem(outline: readonly Point2D[]): string | null {
  if (outline.length < 3) return 'An outline needs at least three corners';
  if (!outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return 'The outline has a corner that is not a number';
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const [p, q] = [outline[i], outline[(i + 1) % n]];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-4) return 'Two corners of the outline are on top of each other';
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through the closing edge
      if (crosses(outline[i], outline[(i + 1) % n], outline[j], outline[(j + 1) % n])) return 'The outline crosses itself';
    }
  }
  let area = 0;
  for (let i = 0; i < n; i++) area += cross([0, 0], outline[i], outline[(i + 1) % n]);
  return Math.abs(area / 2) < 1e-4 ? 'The outline encloses no area' : null;
}

/** Give slab `id` the outline `outline` (storey-local metres, no repeated closing corner). */
export function setSlabOutlineInStore(target: EditTarget, id: number, outline: readonly Point2D[]): SlabOutlineOutcome {
  const problem = slabOutlineProblem(outline);
  if (problem) return { ok: false, reason: problem };
  const { dataStore, view, editor } = target;
  const scale = getModelLengthUnitScale(dataStore);
  const chain = resolveSlabEditChain(dataStore, view, editor, id, scale);
  if (!chain) return { ok: false, reason: `#${id} has no outline that can be edited` };
  if (chain.baseElevation === null) return { ok: false, reason: `#${id} is not a vertical extrusion of its outline` };
  const placement = readElementPlacement(dataStore, editor, id);
  const square = (deg: number) => Math.abs(deg) < 1e-6;
  if (!placement || !placement.onStorey || !square(placement.rx) || !square(placement.ry) || !square(placement.rz)) {
    return { ok: false, reason: `#${id} is placed turned or off its storey; its outline cannot be edited here` };
  }
  const ownership = editOwnershipRefusal(dataStore, view, [chain.extrudedSolidId], new Set([id]));
  if (ownership) return { ok: false, reason: ownership };
  // The extrusion starts where it does now: on the profile plane, or under it for a slab that hangs down.
  const bottom = chain.extrusionUp ? chain.baseElevation : chain.baseElevation - chain.thickness;
  const origin = chain.placementOrigin;
  const emitted = emitClippedProfile(editor, outline.map(([x, y]): Point2D => [x, y]), origin, bottom - origin[2], scale);
  editor.setPositionalAttribute(chain.extrudedSolidId, 0, `#${emitted.profile}`);
  editor.setPositionalAttribute(chain.extrudedSolidId, 1, `#${emitted.solidPosition}`);
  editor.setPositionalAttribute(chain.extrudedSolidId, 2, `#${emitted.up}`);
  return { ok: true, remesh: [id] };
}
