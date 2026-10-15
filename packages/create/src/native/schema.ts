/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Lapin native model schema (N0, docs/format-lapin-nativ.md): what a
 * native element IS — its intent (axis, outline, section, host, type,
 * level) — rather than the IFC entities that describe its solid. Geometry is
 * derived from these records; IFC is a translation of them (`ifc-mapping.ts`,
 * `to-store-params.ts`).
 *
 * The schema is "IFC-shaped": every element names its IFC class and
 * PredefinedType, types and materials follow IFC's type / material-layer
 * model, the spatial structure is IFC's, and every relation has a direct IFC
 * equivalent — so export is a 1:1 translation.
 *
 * Units: SI throughout — metres, radians. Plan coordinates are
 * storey-local (x, y); heights are relative to the storey's elevation.
 */

import type { ProfileSection } from '../in-store/profile.js';
import type { JoinerySpec } from '../in-store/joinery-spec.js';
import type { WallAlignment, WallEndCut } from '../in-store/wall-join.js';

/** Bumped when a reader of an older schema could misread a newer file; migrations take older files forward. */
export const NATIVE_SCHEMA_VERSION = 1;

/** A stable element / type / material id: a UUID (RFC 4122). The IFC GlobalId derives from it. */
export type NativeId = string;

/** A point in a storey's plan, metres. */
export type PlanPoint = [number, number];
/** A point in a storey's frame (z up from the storey elevation), metres. */
export type LocalPoint = [number, number, number];

/** The classes of the first round (docs/format-lapin-nativ.md, decision 4), and Studio's free solids. */
export type NativeKind = 'wall' | 'slab' | 'beam' | 'column' | 'opening' | 'door' | 'window' | 'solid';

/** The attributes every native element carries, named as IfcRoot / IfcElement name them. */
export interface NativeElementBase {
  id: NativeId;
  kind: NativeKind;
  /** IfcElement.PredefinedType without the dots; the class's default when absent. */
  predefinedType?: string;
  /** IfcRoot.Name. */
  name?: string;
  description?: string;
  /** IfcObject.ObjectType (USERDEFINED types put their label here). */
  objectType?: string;
  /** IfcElement.Tag (schedule mark). */
  tag?: string;
  /** The storey containing the element (IfcRelContainedInSpatialStructure). */
  storeyId: NativeId;
  /** The type it instantiates (IfcRelDefinesByType); instance parameters fill what the type leaves open. */
  typeId?: NativeId;
  /**
   * Its body was combined in Studio (Unite / Intersect) with other solids,
   * kept in its frame: the parameters are its own solid's, the body is more.
   */
  combined?: 'union' | 'intersection';
}

/** A straight wall along an axis, extruded up from its base. */
export interface NativeWall extends NativeElementBase {
  kind: 'wall';
  start: PlanPoint;
  end: PlanPoint;
  /** Base above the storey elevation. Default 0. */
  baseOffset?: number;
  /** Instance height; the type's when absent. */
  height?: number;
  /** Instance thickness; the type's layers' sum when absent (and required without a type). */
  thickness?: number;
  /** Which face the axis runs along. Default `center`. */
  alignment?: WallAlignment;
  /** Extra shift of the body across the axis, positive to the left of start -> end. Default 0. */
  offset?: number;
  startCut?: WallEndCut;
  endCut?: WallEndCut;
  /** Layers in reverse order (Flip Y): the type's right face becomes the left one. */
  flipLayers?: boolean;
}

/** A slab: a closed plan outline, with holes, extruded down or up by its thickness. */
export interface NativeSlab extends NativeElementBase {
  kind: 'slab';
  /** Counter-clockwise, not closed (the last point does not repeat the first); >= 3 points. */
  outline: PlanPoint[];
  /** Each clockwise, not closed. */
  holes?: PlanPoint[][];
  /** Top of the slab above the storey elevation. Default 0. */
  topOffset?: number;
  /** Instance thickness; the type's layers' sum when absent. */
  thickness?: number;
}

/** A linear member between two points; the section is centred on the axis. */
export interface NativeBeam extends NativeElementBase {
  kind: 'beam';
  start: LocalPoint;
  end: LocalPoint;
  /** Instance section; the type's when absent. */
  section?: ProfileSection;
  /** Turn of the section about the axis. Default 0. */
  rotation?: number;
}

/** A vertical member standing on a base point. */
export interface NativeColumn extends NativeElementBase {
  kind: 'column';
  /** Base centre; z is the base above the storey elevation. */
  position: LocalPoint;
  /** Instance height; the type's when absent. */
  height?: number;
  section?: ProfileSection;
  /** Direction of the section's X in plan, from plan X, counter-clockwise. Default 0. */
  rotation?: number;
}

/** A void cut in a wall or a slab (IfcOpeningElement + IfcRelVoidsElement). */
export type NativeOpening = NativeWallOpening | NativeSlabOpening;

interface NativeOpeningBase extends NativeElementBase {
  kind: 'opening';
  /** The wall or slab it cuts. */
  hostId: NativeId;
}

export interface NativeWallOpening extends NativeOpeningBase {
  host: 'wall';
  /** Centre along the wall axis from its start. */
  along: number;
  /** Bottom edge above the wall base. Default 0. */
  sill?: number;
  width: number;
  height: number;
}

export interface NativeSlabOpening extends NativeOpeningBase {
  host: 'slab';
  /** Centre in the storey plan. */
  center: PlanPoint;
  width: number;
  depth: number;
  /** Turn of the opening's width direction from plan X. Default 0. */
  rotation?: number;
}

/** A door or window placed in a wall: it fills an opening it brings with it (IfcRelFillsElement). */
export interface NativeJoinery extends NativeElementBase {
  kind: 'door' | 'window';
  hostId: NativeId;
  /** Centre along the wall axis from its start. */
  along: number;
  /** Bottom above the wall base; the type's sill height when absent. */
  sill?: number;
  /** Opening side mirrored across the wall. */
  flipFacing?: boolean;
  /** Hinge side mirrored along the wall. */
  flipHand?: boolean;
}

/**
 * How a Studio solid is built (its history, FreeCAD-style), in the storey's
 * frame, metres and radians — the inputs of the builders, from which it is
 * rebuilt:
 *  - `extrude`: a profile (outer ring and holes, in the plane at `location`
 *    with `refDirection` as its x and `axis` as its normal) carried `depth`
 *    along `axis`;
 *  - `sweep`: a profile standing upright on a path (its x to the path's
 *    left, y up, its bounding box's bottom centre on the path);
 *  - `revolve`: a profile (points in the storey) turned `angle` about the
 *    line through `origin` along `direction`.
 */
export type NativeSolidShape =
  | { operation: 'extrude'; outer: PlanPoint[]; holes?: PlanPoint[][]; depth: number; location: LocalPoint; axis: LocalPoint; refDirection: LocalPoint }
  | { operation: 'sweep'; profile: PlanPoint[]; path: LocalPoint[]; closed?: boolean }
  | { operation: 'revolve'; profile: LocalPoint[]; origin: LocalPoint; direction: LocalPoint; angle: number };

/** A free solid modelled in Studio, of any element class: rebuilt from its operation. */
export interface NativeSolid extends NativeElementBase {
  kind: 'solid';
  /** The IFC class it is written as (IfcBuildingElementProxy, IfcFurnishingElement, IfcWall…). */
  ifcClass: string;
  shape: NativeSolidShape;
}

export type NativeElement = NativeWall | NativeSlab | NativeBeam | NativeColumn | NativeOpening | NativeJoinery | NativeSolid;

/** One layer of a wall or slab type (IfcMaterialLayer). */
export interface NativeLayer {
  materialId: NativeId;
  thickness: number;
  /** IfcMaterialLayer.IsVentilated / Category, kept for export. */
  category?: string;
}

export type NativeType =
  | { id: NativeId; kind: 'wall'; name: string; mark?: string; layers: NativeLayer[]; height?: number; predefinedType?: string }
  | { id: NativeId; kind: 'slab'; name: string; mark?: string; layers: NativeLayer[]; predefinedType?: string }
  | { id: NativeId; kind: 'beam'; name: string; mark?: string; section: ProfileSection; materialId?: NativeId; predefinedType?: string }
  | { id: NativeId; kind: 'column'; name: string; mark?: string; section: ProfileSection; height?: number; materialId?: NativeId; predefinedType?: string }
  | { id: NativeId; kind: 'door' | 'window'; name: string; spec: JoinerySpec };

export interface NativeMaterial {
  id: NativeId;
  name: string;
  /** IfcMaterial.Category (e.g. `concrete`, `timber`). */
  category?: string;
  /** #rrggbb surface colour (IfcSurfaceStyleRendering). */
  color?: string;
  /** 0..1. */
  transparency?: number;
}

export interface NativeStorey {
  id: NativeId;
  name: string;
  /** Above the project's zero, metres. */
  elevation: number;
}

/**
 * The relations that are not already a field of an element (containment is
 * `storeyId`, typing `typeId`, hosting `hostId`). Each has a direct IFC form.
 */
export type NativeRelation =
  | { kind: 'wallJoin'; a: NativeId; b: NativeId; style: 'butt' | 'mitre'; /** The wall whose body runs through a butt joint. */ through?: NativeId }
  | { kind: 'aggregate'; whole: NativeId; parts: NativeId[] }
  | { kind: 'group'; group: NativeId; name: string; members: NativeId[] };

export type NativeValue = string | number | boolean | null;

/** One property of a property set (IfcPropertySingleValue in an IfcPropertySet), long form. */
export interface NativeProperty {
  elementId: NativeId;
  pset: string;
  name: string;
  value: NativeValue;
  /** The IFC measure type the value is written as (e.g. `IfcLengthMeasure`, `IfcLabel`). */
  ifcType?: string;
}

/** One native model: what a `.lapin` package stores under `models/<id>/native/`. */
export interface NativeModel {
  schemaVersion: number;
  id: NativeId;
  name: string;
  storeys: NativeStorey[];
  elements: NativeElement[];
  types: NativeType[];
  materials: NativeMaterial[];
  relations: NativeRelation[];
  properties: NativeProperty[];
}
