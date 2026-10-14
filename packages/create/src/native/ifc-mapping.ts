/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * How each native class is written as IFC (N0): the entity and its type
 * object, the PredefinedType values the schema allows, the representations,
 * how the material is attached, and the standard property and quantity sets.
 * The export (N6) and the IFC projection (N1) read this table; nothing here
 * writes IFC itself.
 */

import { uuidToIfcGuid, ifcGuidToUuid, isValidUuid } from '@ifc-lite/encoding';
import type { NativeElement, NativeId, NativeKind } from './schema.js';

export interface NativeClassMapping {
  /** The occurrence entity. */
  ifcClass: string;
  /** The type object written for its `typeId` (IfcRelDefinesByType). */
  ifcTypeClass: string;
  /** PredefinedType values IFC4 allows for the class (USERDEFINED needs `objectType`). */
  predefinedTypes: readonly string[];
  /** Written when the element names none. */
  defaultPredefinedType: string;
  /** Representation identifiers written, Body first. */
  representations: readonly ('Axis' | 'Body' | 'FootPrint')[];
  /** How the material reaches the element. */
  material: 'layerSetUsage' | 'profileSetUsage' | 'material' | 'none';
  /** The standard property set the class carries. */
  commonPset: string;
  /** The standard base quantity set, or null. */
  quantitySet: string | null;
}

const ELEMENT_TYPES = ['USERDEFINED', 'NOTDEFINED'] as const;

export const NATIVE_IFC: Readonly<Record<NativeKind, NativeClassMapping>> = {
  wall: {
    ifcClass: 'IfcWall', ifcTypeClass: 'IfcWallType',
    predefinedTypes: ['MOVABLE', 'PARAPET', 'PARTITIONING', 'PLUMBINGWALL', 'SHEAR', 'SOLIDWALL', 'STANDARD', 'POLYGONAL', 'ELEMENTEDWALL', 'RETAININGWALL', 'WAVEWALL', ...ELEMENT_TYPES],
    defaultPredefinedType: 'STANDARD',
    representations: ['Body', 'Axis'],
    material: 'layerSetUsage', commonPset: 'Pset_WallCommon', quantitySet: 'Qto_WallBaseQuantities',
  },
  slab: {
    ifcClass: 'IfcSlab', ifcTypeClass: 'IfcSlabType',
    predefinedTypes: ['FLOOR', 'ROOF', 'LANDING', 'BASESLAB', 'APPROACH_SLAB', 'PAVING', 'WEARING', 'SIDEWALK', 'TRACKSLAB', ...ELEMENT_TYPES],
    defaultPredefinedType: 'FLOOR',
    representations: ['Body'],
    material: 'layerSetUsage', commonPset: 'Pset_SlabCommon', quantitySet: 'Qto_SlabBaseQuantities',
  },
  beam: {
    ifcClass: 'IfcBeam', ifcTypeClass: 'IfcBeamType',
    predefinedTypes: ['BEAM', 'JOIST', 'HOLLOWCORE', 'LINTEL', 'SPANDREL', 'T_BEAM', 'GIRDER_SEGMENT', 'DIAPHRAGM', 'PIERCAP', 'HATSTONE', 'CORNICE', 'EDGEBEAM', ...ELEMENT_TYPES],
    defaultPredefinedType: 'BEAM',
    representations: ['Body', 'Axis'],
    material: 'profileSetUsage', commonPset: 'Pset_BeamCommon', quantitySet: 'Qto_BeamBaseQuantities',
  },
  column: {
    ifcClass: 'IfcColumn', ifcTypeClass: 'IfcColumnType',
    predefinedTypes: ['COLUMN', 'PILASTER', 'PIERSTEM', 'PIERSTEM_SEGMENT', 'STANDCOLUMN', ...ELEMENT_TYPES],
    defaultPredefinedType: 'COLUMN',
    representations: ['Body', 'Axis'],
    material: 'profileSetUsage', commonPset: 'Pset_ColumnCommon', quantitySet: 'Qto_ColumnBaseQuantities',
  },
  opening: {
    ifcClass: 'IfcOpeningElement', ifcTypeClass: 'IfcOpeningElementType',
    predefinedTypes: ['OPENING', 'RECESS', ...ELEMENT_TYPES],
    defaultPredefinedType: 'OPENING',
    representations: ['Body'],
    material: 'none', commonPset: 'Pset_OpeningElementCommon', quantitySet: 'Qto_OpeningElementBaseQuantities',
  },
  door: {
    ifcClass: 'IfcDoor', ifcTypeClass: 'IfcDoorType',
    predefinedTypes: ['DOOR', 'GATE', 'TRAPDOOR', 'BOOM_BARRIER', 'TURNSTILE', ...ELEMENT_TYPES],
    defaultPredefinedType: 'DOOR',
    representations: ['Body', 'FootPrint'],
    material: 'material', commonPset: 'Pset_DoorCommon', quantitySet: 'Qto_DoorBaseQuantities',
  },
  window: {
    ifcClass: 'IfcWindow', ifcTypeClass: 'IfcWindowType',
    predefinedTypes: ['WINDOW', 'SKYLIGHT', 'LIGHTDOME', ...ELEMENT_TYPES],
    defaultPredefinedType: 'WINDOW',
    representations: ['Body', 'FootPrint'],
    material: 'material', commonPset: 'Pset_WindowCommon', quantitySet: 'Qto_WindowBaseQuantities',
  },
};

/**
 * The property set a native element's parameters travel in on export, so a
 * Lapin IFC re-imports as native parametric elements (N7). One set for every
 * class: `SchemaVersion`, `Kind` and the class's parameters as JSON.
 */
export const NATIVE_PSET = 'Pset_LapinNative';

/** The PredefinedType written for an element: its own when the class allows it, else the class default. */
export function nativePredefinedType(element: Pick<NativeElement, 'kind' | 'predefinedType'>): string {
  const mapping = NATIVE_IFC[element.kind];
  const own = element.predefinedType?.toUpperCase();
  return own && mapping.predefinedTypes.includes(own) ? own : mapping.defaultPredefinedType;
}

/** The IFC GlobalId of a native id: the UUID's 22-character IFC encoding. Stable across exports. */
export function nativeGlobalId(id: NativeId): string {
  if (!isValidUuid(id)) throw new Error(`native: id ${id} is not a UUID`);
  return uuidToIfcGuid(id);
}

/** The native id an IFC GlobalId was written from (re-import of a Lapin IFC). */
export function nativeIdFromGlobalId(globalId: string): NativeId {
  return ifcGuidToUuid(globalId);
}
