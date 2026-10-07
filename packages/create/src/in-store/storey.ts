/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Add a building storey (level) to a loaded model, next to an existing one.
 *
 * The new IfcBuildingStorey copies the reference storey's placement frame
 * — same parent placement, same plan position and axes — and only moves
 * its origin up or down by the elevation difference, so everything placed
 * on it lines up with the rest of the building. It joins the building
 * through its own IfcRelAggregates (importers fold parallel aggregates, as
 * `emitRelContainedInSpatialStructure` relies on for containment).
 *
 * `Elevation` is metres (like every builder param) and is written in the
 * file's native length unit, on both `IfcBuildingStorey.Elevation` and the
 * placement.
 */

import { generateIfcGuid, isValidIfcGuid } from '@ifc-lite/encoding';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { StoreEditor } from '@ifc-lite/mutations';
import { AnchorEntityReader } from './resolve-anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';
import { toNativeLength, type SpatialAnchor } from './anchor.js';

export interface StoreyInStoreParams {
  Name: string;
  /** Floor elevation, metres. */
  Elevation: number;
  /** Explicit GlobalId (22-char IFC base64); a fresh one is generated otherwise. */
  GlobalId?: string;
}

export interface StoreyBuildResult {
  storeyId: number;
  placementId: number;
  relAggregatesId: number;
  /** The IfcBuilding the storey was aggregated into. */
  buildingId: number;
  globalId: string;
}

type Raw = unknown;

function refId(raw: Raw): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && /^#[1-9][0-9]*$/.test(raw)) return Number(raw.slice(1));
  return null;
}

function attr(reader: AnchorEntityReader, id: number | null, name: string, fallbackIndex: number): Raw {
  if (id === null) return undefined;
  const entity = reader.entity(id);
  if (!entity) return undefined;
  const index = entity.names.indexOf(name);
  return entity.attributes[index >= 0 ? index : fallbackIndex];
}

function numberOr(raw: Raw, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/**
 * Add a storey at `params.Elevation`, framed like `reference.storeyId`
 * (resolve the anchor with `resolveSpatialAnchor` on any existing storey).
 */
export function addStoreyToStore(
  store: IfcDataStore,
  editor: StoreEditor,
  reference: SpatialAnchor,
  params: StoreyInStoreParams,
): StoreyBuildResult {
  if (!Number.isFinite(params.Elevation)) throw new Error('addStoreyToStore: Elevation must be a finite number of metres');
  const name = params.Name.trim();
  if (!name) throw new Error('addStoreyToStore: a storey needs a name');
  if (params.GlobalId !== undefined && !isValidIfcGuid(params.GlobalId)) {
    throw new Error(`addStoreyToStore: "${params.GlobalId}" is not a valid IFC GlobalId`);
  }
  const reader = new AnchorEntityReader(store, editor.getMutationView());
  const buildingId = reader.firstId('IFCBUILDING');
  if (buildingId === null) throw new Error('addStoreyToStore: the model has no IfcBuilding to add a storey to');

  // The reference storey's frame: parent placement, origin and axes.
  const refPlacement = reference.storeyPlacementId;
  const parent = attr(reader, refPlacement, 'PlacementRelTo', 0);
  const axisId = refId(attr(reader, refPlacement, 'RelativePlacement', 1));
  const pointId = refId(attr(reader, axisId, 'Location', 0));
  const coords = attr(reader, pointId, 'Coordinates', 0);
  const origin = Array.isArray(coords) ? coords.map((c) => numberOr(c, 0)) : [0, 0, 0];
  const refElevation = numberOr(attr(reader, reference.storeyId, 'Elevation', 9), origin[2] ?? 0);

  const elevation = toNativeLength(reference, params.Elevation);
  const z = (origin[2] ?? 0) + (elevation - refElevation);
  const point = editor.addEntity('IfcCartesianPoint', [[origin[0] ?? 0, origin[1] ?? 0, z]]).expressId;
  const refAxis = attr(reader, axisId, 'Axis', 1);
  const refDirection = attr(reader, axisId, 'RefDirection', 2);
  const axis = editor.addEntity('IfcAxis2Placement3D', [
    `#${point}`,
    refId(refAxis) ? `#${refId(refAxis)}` : null,
    refId(refDirection) ? `#${refId(refDirection)}` : null,
  ]).expressId;
  const parentId = refId(parent);
  const placementId = editor.addEntity('IfcLocalPlacement', [parentId ? `#${parentId}` : null, `#${axis}`]).expressId;

  const globalId = params.GlobalId ?? generateIfcGuid(reference.guidRandom);
  const owner = ownerHistoryRef(reference.ownerHistoryId);
  const storeyId = editor.addEntity('IfcBuildingStorey', [
    globalId, owner, name, null, null, `#${placementId}`, null, null, '.ELEMENT.', elevation,
  ]).expressId;
  const relAggregatesId = editor.addEntity('IfcRelAggregates', [
    generateIfcGuid(reference.guidRandom), owner, null, null, `#${buildingId}`, [`#${storeyId}`],
  ]).expressId;
  return { storeyId, placementId, relAggregatesId, buildingId, globalId };
}
