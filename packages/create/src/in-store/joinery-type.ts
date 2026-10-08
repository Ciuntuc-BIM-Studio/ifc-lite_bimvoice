/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A joinery spec written as an IFC type object: `IfcWindowType` or
 * `IfcDoorType` (IFC4 / IFC4X3) with
 *  - its partitioning (window) or operation (door) type,
 *  - IfcWindowLiningProperties / IfcDoorLiningProperties and one
 *    IfcWindowPanelProperties / IfcDoorPanelProperties per panel,
 *  - Pset_WindowCommon / Pset_DoorCommon, and Pset_IfcLiteJoinery holding the
 *    spec itself (JSON), so a model carries what the configurator edits,
 *  - one IfcRepresentationMap ('Body', 'SweptSolid'): the boxes of
 *    `joineryBoxes`, coloured per role.
 * Occurrences share that body through an IfcMappedItem (`emitMappedBody`).
 *
 * `replaceJoineryTypeInStore` rewrites an existing type in place (same
 * entity, same GlobalId): occurrences keep pointing at it and their mapped
 * items at its (rewritten) map.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { StoreEditor } from '@ifc-lite/mutations';
import { toNativeLength, type SpatialAnchor } from './anchor.js';
import { emitSurfaceStyle, ownerHistoryRef, productGuid } from './_emit-helpers.js';
import { canonicalEntity, schemaAttributes, schemaRegistry } from './schema-attributes.js';
import { joineryBoxes, type JoineryRole } from './joinery-geometry.js';
import {
  doorOperation, doorPanelOperation, liningOffsets, panelPosition, panelWidthRatio, windowPanelOperation, windowPartitioning,
} from './joinery-ifc.js';
import { isDoorLeaf, joineryProblem, normalisedPanels, type JoinerySpec } from './joinery-spec.js';

export type JoineryAnchor = Pick<SpatialAnchor, 'ownerHistoryId' | 'schema' | 'guidRandom' | 'lengthUnitScale' | 'bodyContextId'>;

export interface JoineryTypeResult {
  typeId: number;
  /** The IfcRepresentationMap occurrences map. */
  mapId: number;
  globalId: string;
}

export const JOINERY_PSET = 'Pset_IfcLiteJoinery';

type Attr = Parameters<StoreEditor['addEntity']>[1];

function rgb(hex: string): { red: number; green: number; blue: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return { red: 0.8, green: 0.8, blue: 0.8 };
  return { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255 };
}

function roleColor(spec: JoinerySpec, role: JoineryRole): { red: number; green: number; blue: number; alpha?: number } {
  if (role === 'glass') return { ...rgb(spec.colors.glass), alpha: 0.35 };
  if (role === 'leaf') return rgb(spec.colors.leaf);
  if (role === 'handle') return { red: 0.55, green: 0.55, blue: 0.58 };
  if (role === 'board') return { red: 0.92, green: 0.92, blue: 0.9 };
  return rgb(spec.colors.frame);
}

/** The body boxes as extruded solids, styled per role; returns the IfcShapeRepresentation. */
function emitBodyShape(editor: StoreEditor, anchor: JoineryAnchor, spec: JoinerySpec): number {
  const n = (m: number) => toNativeLength(anchor, m);
  const styles = new Map<JoineryRole, number>();
  const items: string[] = [];
  for (const box of joineryBoxes(spec)) {
    const [x0, y0, z0] = box.min.map(n), [x1, y1, z1] = box.max.map(n);
    const centre = editor.addEntity('IfcCartesianPoint', [[(x0 + x1) / 2, (y0 + y1) / 2]]).expressId;
    const pos2 = editor.addEntity('IfcAxis2Placement2D', [`#${centre}`, null]).expressId;
    const profile = editor.addEntity('IfcRectangleProfileDef', ['.AREA.', null, `#${pos2}`, x1 - x0, y1 - y0]).expressId;
    const origin = editor.addEntity('IfcCartesianPoint', [[0, 0, z0]]).expressId;
    const pos3 = editor.addEntity('IfcAxis2Placement3D', [`#${origin}`, null, null]).expressId;
    const dir = editor.addEntity('IfcDirection', [[0, 0, 1]]).expressId;
    const solid = editor.addEntity('IfcExtrudedAreaSolid', [`#${profile}`, `#${pos3}`, `#${dir}`, z1 - z0]).expressId;
    let style = styles.get(box.role);
    if (style === undefined) {
      style = emitSurfaceStyle(editor, anchor.schema ?? 'IFC4', roleColor(spec, box.role), `${spec.name} ${box.role}`).styleRefId;
      styles.set(box.role, style);
    }
    editor.addEntity('IfcStyledItem', [`#${solid}`, [`#${style}`], null]);
    items.push(`#${solid}`);
  }
  return editor.addEntity('IfcShapeRepresentation', [`#${anchor.bodyContextId}`, 'Body', 'SweptSolid', items]).expressId;
}

function emitMap(editor: StoreEditor, anchor: JoineryAnchor, spec: JoinerySpec): number {
  const shape = emitBodyShape(editor, anchor, spec);
  const origin = editor.addEntity('IfcCartesianPoint', [[0, 0, 0]]).expressId;
  const placement = editor.addEntity('IfcAxis2Placement3D', [`#${origin}`, null, null]).expressId;
  return editor.addEntity('IfcRepresentationMap', [`#${placement}`, `#${shape}`]).expressId;
}

function singleValue(editor: StoreEditor, name: string, type: string, value: string | number | boolean): string {
  return `#${editor.addEntity('IfcPropertySingleValue', [name, null, { typed: { type, value } }, null]).expressId}`;
}

function propertySet(editor: StoreEditor, anchor: JoineryAnchor, name: string, props: string[]): string {
  return `#${editor.addEntity('IfcPropertySet', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), name, null, props]).expressId}`;
}

/** The lining, panel and common property sets, plus the spec itself. */
function emitPropertySets(editor: StoreEditor, anchor: JoineryAnchor, spec: JoinerySpec): string[] {
  const op = 'addJoineryTypeToStore';
  const registry = schemaRegistry(anchor.schema, op);
  const n = (m: number) => toNativeLength(anchor, m);
  const header = (name: string) => ({ GlobalId: generateIfcGuid(anchor.guidRandom), OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId), Name: name });
  const add = (type: string, values: Record<string, unknown>) => {
    const name = canonicalEntity(registry, type);
    if (!name) throw new Error(`${op}: ${type} does not exist in ${registry.name}`);
    return `#${editor.addEntity(name, schemaAttributes(registry, name, values, op) as Attr).expressId}`;
  };
  const panels = normalisedPanels(spec);
  const sets: string[] = [];
  if (spec.kind === 'window') {
    const { mullions, transoms } = liningOffsets(spec);
    sets.push(add('IfcWindowLiningProperties', {
      ...header('Lining'),
      LiningDepth: n(spec.frame.depth), LiningThickness: n(spec.frame.width),
      TransomThickness: transoms.length ? n(spec.frame.transom) : undefined,
      MullionThickness: mullions.length ? n(spec.frame.mullion) : undefined,
      FirstTransomOffset: transoms[0], SecondTransomOffset: transoms[1],
      FirstMullionOffset: mullions[0], SecondMullionOffset: mullions[1],
      LiningOffset: registry.entities.IfcWindowLiningProperties?.allAttributes?.some((a) => a.name === 'LiningOffset') ? n(spec.frame.offset) : undefined,
    }));
    panels.forEach((p, i) => sets.push(add('IfcWindowPanelProperties', {
      ...header(`Panel ${i + 1}`),
      OperationType: windowPanelOperation(p.operation),
      PanelPosition: panelPosition(spec, p, 'window'),
      FrameDepth: p.operation === 'fixed' ? undefined : n(spec.sash.depth),
      FrameThickness: p.operation === 'fixed' ? undefined : n(spec.sash.width),
    })));
  } else {
    const transoms = liningOffsets(spec).transoms;
    sets.push(add('IfcDoorLiningProperties', {
      ...header('Lining'),
      LiningDepth: n(spec.frame.depth), LiningThickness: n(spec.frame.width),
      ThresholdDepth: spec.threshold > 0 ? n(spec.frame.depth) : undefined,
      ThresholdThickness: spec.threshold > 0 ? n(spec.threshold) : undefined,
      TransomThickness: transoms.length ? n(spec.frame.transom) : undefined,
      TransomOffset: transoms.length ? n(transoms[0] * spec.height) : undefined,
      LiningOffset: n(spec.frame.offset),
    }));
    panels.forEach((p, i) => sets.push(add('IfcDoorPanelProperties', {
      ...header(isDoorLeaf(p.operation) ? `Leaf ${i + 1}` : `Panel ${i + 1}`),
      PanelDepth: n(isDoorLeaf(p.operation) ? spec.sash.leafThickness : spec.sash.glassThickness),
      PanelOperation: doorPanelOperation(p.operation),
      PanelWidth: panelWidthRatio(spec, p),
      PanelPosition: panelPosition(spec, p, 'door'),
    })));
  }

  const c = spec.props;
  const common = [singleValue(editor, 'IsExternal', 'IfcBoolean', c.isExternal)];
  if (c.reference) common.push(singleValue(editor, 'Reference', 'IfcIdentifier', c.reference));
  if (c.thermalTransmittance !== undefined) common.push(singleValue(editor, 'ThermalTransmittance', 'IfcThermalTransmittanceMeasure', c.thermalTransmittance));
  if (c.fireRating) common.push(singleValue(editor, 'FireRating', 'IfcLabel', c.fireRating));
  if (c.acousticRating) common.push(singleValue(editor, 'AcousticRating', 'IfcLabel', c.acousticRating));
  if (c.securityRating) common.push(singleValue(editor, 'SecurityRating', 'IfcLabel', c.securityRating));
  sets.push(propertySet(editor, anchor, spec.kind === 'window' ? 'Pset_WindowCommon' : 'Pset_DoorCommon', common));
  sets.push(propertySet(editor, anchor, JOINERY_PSET, [
    singleValue(editor, 'Mark', 'IfcLabel', spec.mark),
    singleValue(editor, 'Spec', 'IfcText', JSON.stringify(spec)),
  ]));
  return sets;
}

function typeAttributes(anchor: JoineryAnchor, spec: JoinerySpec, globalId: string, sets: string[], mapId: number): { type: string; attrs: unknown[] } {
  const op = 'addJoineryTypeToStore';
  const registry = schemaRegistry(anchor.schema, op);
  const type = canonicalEntity(registry, spec.kind === 'window' ? 'IfcWindowType' : 'IfcDoorType');
  if (!type) throw new Error(`${registry.name} has no ${spec.kind} type objects; joinery types need IFC4 or IFC4X3`);
  const kind = spec.kind === 'window' ? windowPartitioning(spec) : doorOperation(spec);
  const enumName = spec.kind === 'window' ? 'IfcWindowTypePartitioningEnum' : 'IfcDoorTypeOperationEnum';
  const known = registry.enums[enumName] ?? [];
  const value = known.includes(kind.type) ? kind.type : 'USERDEFINED';
  const userDefined = value === 'USERDEFINED' ? (kind.userDefined ?? kind.type) : undefined;
  const attrs = schemaAttributes(registry, type, {
    GlobalId: globalId,
    OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId),
    Name: spec.name,
    HasPropertySets: sets,
    RepresentationMaps: [`#${mapId}`],
    Tag: spec.mark,
    PredefinedType: spec.kind === 'window' ? 'WINDOW' : 'DOOR',
    ParameterTakesPrecedence: false,
    ...(spec.kind === 'window'
      ? { PartitioningType: value, UserDefinedPartitioningType: userDefined }
      : { OperationType: value, UserDefinedOperationType: userDefined }),
  }, op);
  return { type, attrs };
}

export function addJoineryTypeToStore(editor: StoreEditor, anchor: JoineryAnchor, spec: JoinerySpec, params: { GlobalId?: string } = {}): JoineryTypeResult {
  const problem = joineryProblem(spec);
  if (problem) throw new Error(`addJoineryTypeToStore: ${problem}`);
  const globalId = productGuid(params, anchor.guidRandom);
  const sets = emitPropertySets(editor, anchor, spec);
  const mapId = emitMap(editor, anchor, spec);
  const { type, attrs } = typeAttributes(anchor, spec, globalId, sets, mapId);
  const typeId = editor.addEntity(type, attrs as Attr).expressId;
  return { typeId, mapId, globalId };
}

/**
 * Rewrite type `typeId` from `spec`: new property sets and body, written into
 * the same type entity and the same representation map entity (occurrences'
 * mapped items keep pointing at it). The old sets and shape are left for the
 * exporter's orphan sweep.
 */
export function replaceJoineryTypeInStore(editor: StoreEditor, anchor: JoineryAnchor, typeId: number, mapId: number, globalId: string, spec: JoinerySpec): JoineryTypeResult {
  const problem = joineryProblem(spec);
  if (problem) throw new Error(`replaceJoineryTypeInStore: ${problem}`);
  const sets = emitPropertySets(editor, anchor, spec);
  editor.setPositionalAttribute(mapId, 1, `#${emitBodyShape(editor, anchor, spec)}`);
  const { attrs } = typeAttributes(anchor, spec, globalId, sets, mapId);
  // GlobalId (0) and OwnerHistory (1) stay; everything after is the spec's.
  attrs.forEach((value, index) => { if (index >= 2) editor.setPositionalAttribute(typeId, index, value as Attr[number]); });
  return { typeId, mapId, globalId };
}

/**
 * An occurrence's body: one IfcMappedItem of the type's map. The
 * occurrence's own placement puts it in the wall; `flips` turns it there —
 * bit 1 mirrors it across its width (hinges on the other jamb), bit 2 turns
 * it 180° about the vertical (opens to the other side). Both are written as
 * the operator's axes (Axis3 explicit, so a mirror is a left-handed basis):
 * IFC requires a positive Scale, so a negative scale is not an option.
 */
export function emitMappedBody(editor: StoreEditor, bodyContextId: number, mapId: number, flips = 0): { shapeRepId: number; productShapeId: number } {
  const origin = editor.addEntity('IfcCartesianPoint', [[0, 0, 0]]).expressId;
  let operator: number;
  if (flips & 3) {
    const turned = (flips & 2) !== 0, mirrored = ((flips & 1) !== 0) !== turned;
    const axis1 = editor.addEntity('IfcDirection', [[mirrored ? -1 : 1, 0, 0]]).expressId;
    const axis2 = editor.addEntity('IfcDirection', [[0, turned ? -1 : 1, 0]]).expressId;
    const axis3 = editor.addEntity('IfcDirection', [[0, 0, 1]]).expressId;
    operator = editor.addEntity('IfcCartesianTransformationOperator3D', [`#${axis1}`, `#${axis2}`, `#${origin}`, null, `#${axis3}`]).expressId;
  } else {
    operator = editor.addEntity('IfcCartesianTransformationOperator3D', [null, null, `#${origin}`, null, null]).expressId;
  }
  const item = editor.addEntity('IfcMappedItem', [`#${mapId}`, `#${operator}`]).expressId;
  const shapeRepId = editor.addEntity('IfcShapeRepresentation', [`#${bodyContextId}`, 'Body', 'MappedRepresentation', [`#${item}`]]).expressId;
  const productShapeId = editor.addEntity('IfcProductDefinitionShape', [null, null, [`#${shapeRepId}`]]).expressId;
  return { shapeRepId, productShapeId };
}

/** Apply `flips` (as `emitMappedBody`) to a point of the type frame. */
export function flipPoint(x: number, y: number, flips: number): [number, number] {
  let px = flips & 1 ? -x : x, py = y;
  if (flips & 2) { px = -px; py = -py; }
  return [px, py];
}
