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
