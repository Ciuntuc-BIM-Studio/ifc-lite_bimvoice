/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A roof trim around an element's body (`wall-roof-trim.ts`): its body item
 * wrapped in IfcBooleanClippingResult DIFFERENCE results whose cutters are
 * IfcPolygonalBoundedHalfSpace solids (one per roof plane over it). Readers
 * that edit the body (a wall's axis, joins, flip) look through it to the
 * solid inside, so a trimmed wall stays editable; the trim is rebuilt after
 * the edit.
 *
 * Only that shape is looked through: a clipping by plain IfcHalfSpaceSolid
 * (a corner cut written by another tool) is left as it is, since moving the
 * body under it would leave the cut in the wrong place.
 *
 * A body combined in Studio (Unite / Intersect, `element-boolean.ts`) is
 * looked through the same way (`ownSolid`): an IfcBooleanResult UNION or
 * INTERSECTION whose first operand is the element's own solid, the other
 * the solids it was combined with, carried into its frame. Its parameters
 * are read and edited on that solid; what it was combined with stays put in
 * its frame.
 */

type Entity = { type: string; attributes: readonly unknown[] } | null | undefined;

const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

/** Whether `id` is a roof trim (a DIFFERENCE clipping by a polygonal bounded half-space). */
export function isRoofTrim(entity: (id: number) => Entity, id: number): boolean {
  const e = entity(id);
  if (e?.type.toUpperCase() !== 'IFCBOOLEANCLIPPINGRESULT') return false;
  const cutter = entity(refId(e.attributes[2]) ?? -1);
  return String(e.attributes[0]).replace(/\./g, '').toUpperCase() === 'DIFFERENCE' && cutter?.type.toUpperCase() === 'IFCPOLYGONALBOUNDEDHALFSPACE';
}

/** The solid a body item trims (itself when it is no trim). */
export function untrimmedSolid(entity: (id: number) => Entity, id: number): number {
  let at = id;
  for (let guard = 0; guard < 256 && isRoofTrim(entity, at); guard++) {
    const first = refId(entity(at)!.attributes[1]);
    if (first === null) break;
    at = first;
  }
  return at;
}

/** The operation of a Studio combination (an IfcBooleanResult UNION or INTERSECTION), or null. */
export function combinationOf(entity: (id: number) => Entity, id: number): 'union' | 'intersection' | null {
  const e = entity(id);
  if (e?.type.toUpperCase() !== 'IFCBOOLEANRESULT') return null;
  const op = String(e.attributes[0]).replace(/\./g, '').toUpperCase();
  return op === 'UNION' ? 'union' : op === 'INTERSECTION' ? 'intersection' : null;
}

/**
 * The element's own solid inside its body item: through roof trims and
 * Studio combinations (itself when it is neither), with the first
 * combination met (null: none).
 */
export function ownSolidOf(entity: (id: number) => Entity, id: number): { solid: number; combined: 'union' | 'intersection' | null } {
  let at = id;
  let combined: 'union' | 'intersection' | null = null;
  for (let guard = 0; guard < 256; guard++) {
    const op = combinationOf(entity, at);
    if (!op && !isRoofTrim(entity, at)) break;
    combined ??= op;
    const first = refId(entity(at)!.attributes[1]);
    if (first === null) break;
    at = first;
  }
  return { solid: at, combined };
}

/** The element's own solid inside its body item (`ownSolidOf`). */
export function ownSolid(entity: (id: number) => Entity, id: number): number {
  return ownSolidOf(entity, id).solid;
}
