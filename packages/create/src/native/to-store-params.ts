/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Native element -> the parameters of the existing IFC writers
 * (`addWallToStore`, `addSlabToStore`, `addBeamToStore`, `addColumnToStore`,
 * `addOpeningToStore`). N1 projects native models into the in-memory IFC
 * store through these, so every IFC detail the writers already get right
 * (units, placements, axis representations, end cuts) is reused unchanged.
 *
 * Throws on an element that does not validate, and on what the writers
 * cannot express yet (a slab with holes, a turned beam section, a turned
 * slab opening) — named, so N1 knows exactly what it still has to add.
 */

import type { WallInStoreParams } from '../in-store/wall.js';
import type { SlabPolygonParams } from '../in-store/slab.js';
import type { ProfiledBeamInStoreParams } from '../in-store/beam.js';
import type { ProfiledColumnInStoreParams } from '../in-store/column.js';
import type { SlabOpeningInStoreParams, WallOpeningInStoreParams } from '../in-store/opening.js';
import type { HostedDoorInStoreParams, HostedWindowInStoreParams } from '../in-store/hosted-fill.js';
import type { NativeBeam, NativeColumn, NativeElement, NativeJoinery, NativeOpening, NativeSlab, NativeWall } from './schema.js';
import { nativeGlobalId } from './ifc-mapping.js';
import { nativeElementProblems, nativeSection, resolveNativeParam, type NativeIndex } from './validate.js';

function assertValid(element: NativeElement, index: NativeIndex): void {
  const problems = nativeElementProblems(element, index);
  if (problems.length) throw new Error(`native ${element.kind} ${element.id}: ${problems.join('; ')}`);
}

function unsupported(element: NativeElement, what: string): never {
  throw new Error(`native ${element.kind} ${element.id}: ${what} is not supported by the IFC writer yet`);
}

/** IfcRoot / IfcElement attributes shared by every writer. */
function root(element: NativeElement) {
  return {
    GlobalId: nativeGlobalId(element.id),
    ...(element.name !== undefined ? { Name: element.name } : {}),
    ...(element.description !== undefined ? { Description: element.description } : {}),
    ...(element.objectType !== undefined ? { ObjectType: element.objectType } : {}),
    ...(element.tag !== undefined ? { Tag: element.tag } : {}),
  };
}

const num = (element: NativeElement, key: string, index: NativeIndex): number => {
  const v = resolveNativeParam(element, key, index);
  return typeof v === 'number' ? v : 0;
};

export function wallStoreParams(wall: NativeWall, index: NativeIndex): WallInStoreParams {
  assertValid(wall, index);
  const z = num(wall, 'baseOffset', index);
  return {
    ...root(wall),
    Start: [wall.start[0], wall.start[1], z],
    End: [wall.end[0], wall.end[1], z],
    Thickness: num(wall, 'thickness', index),
    Height: num(wall, 'height', index),
    ...(wall.alignment ? { Alignment: wall.alignment } : {}),
    ...(wall.offset ? { Offset: wall.offset } : {}),
    ...(wall.startCut ? { StartCut: { ...wall.startCut } } : {}),
    ...(wall.endCut ? { EndCut: { ...wall.endCut } } : {}),
  };
}

/** A slab extrudes up from `Position` by its thickness, so its base is the top less the thickness. */
export function slabStoreParams(slab: NativeSlab, index: NativeIndex): SlabPolygonParams {
  assertValid(slab, index);
  if (slab.holes?.length) unsupported(slab, 'a slab with holes');
  const thickness = num(slab, 'thickness', index);
  return {
    ...root(slab),
    Profile: 'polygon',
    OuterCurve: slab.outline.map(([x, y]) => [x, y] as [number, number]),
    Position: [0, 0, num(slab, 'topOffset', index) - thickness],
    Thickness: thickness,
  };
}

export function beamStoreParams(beam: NativeBeam, index: NativeIndex): ProfiledBeamInStoreParams {
  assertValid(beam, index);
  if (Math.abs(num(beam, 'rotation', index)) > 1e-12) unsupported(beam, 'a turned section');
  return {
    ...root(beam),
    Start: [...beam.start],
    End: [...beam.end],
    Profile: nativeSection(beam, index)!,
  };
}

export function columnStoreParams(column: NativeColumn, index: NativeIndex): ProfiledColumnInStoreParams {
  assertValid(column, index);
  const turn = num(column, 'rotation', index);
  return {
    ...root(column),
    Position: [...column.position],
    Height: num(column, 'height', index),
    Profile: nativeSection(column, index)!,
    RefDirection: [Math.cos(turn), Math.sin(turn), 0],
  };
}

/** A wall opening sits in the wall's frame (origin at its start, X along it, Z up from its base). */
export function openingStoreParams(opening: NativeOpening, index: NativeIndex): WallOpeningInStoreParams | SlabOpeningInStoreParams {
  assertValid(opening, index);
  if (opening.host === 'wall') {
    return {
      ...root(opening),
      Offset: opening.along,
      Sill: num(opening, 'sill', index),
      Width: opening.width,
      Height: opening.height,
    };
  }
  if (Math.abs(num(opening, 'rotation', index)) > 1e-12) unsupported(opening, 'a turned slab opening');
  return {
    ...root(opening),
    Position: [opening.center[0], opening.center[1]],
    Width: opening.width,
    Depth: opening.depth,
  };
}

/**
 * A door or window in its wall (`addHostedElementInStore`): its size is its
 * type's. The caller writes the type (`addJoineryTypeToStore`, GlobalId from
 * the type's id), passes its map as `MappedBody` and types the occurrence.
 */
export function joineryStoreParams(joinery: NativeJoinery, index: NativeIndex):
  { kind: 'door'; params: HostedDoorInStoreParams } | { kind: 'window'; params: HostedWindowInStoreParams } {
  assertValid(joinery, index);
  const type = index.type(joinery.typeId!);
  if (type?.kind !== joinery.kind) throw new Error(`native ${joinery.kind} ${joinery.id}: its type is not a ${joinery.kind} type`);
  const placed = { ...root(joinery), Offset: joinery.along, Sill: num(joinery, 'sill', index), Width: type.spec.width, Height: type.spec.height };
  return joinery.kind === 'door' ? { kind: 'door', params: placed } : { kind: 'window', params: placed };
}
