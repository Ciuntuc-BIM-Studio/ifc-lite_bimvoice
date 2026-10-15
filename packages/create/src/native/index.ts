/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The Lapin native model schema (docs/format-lapin-nativ.md, N0). */

export {
  NATIVE_SCHEMA_VERSION,
  type NativeBeam, type NativeColumn, type NativeElement, type NativeElementBase, type NativeId,
  type NativeJoinery, type NativeKind, type NativeLayer, type NativeMaterial, type NativeModel,
  type NativeOpening, type NativeProperty, type NativeRelation, type NativeSlab, type NativeSlabOpening,
  type NativeStorey, type NativeType, type NativeSolid, type NativeSolidShape, type NativeValue, type NativeWall, type NativeWallOpening,
  type PlanPoint as NativePlanPoint, type LocalPoint as NativeLocalPoint,
} from './schema.js';
export { NATIVE_IFC, NATIVE_PSET, nativeGlobalId, nativeIdFromGlobalId, nativePredefinedType, type NativeClassMapping } from './ifc-mapping.js';
export { NATIVE_PARAMS, nativeParam, nativeParamProblem, type NativeParam, type NativeQuantity } from './parameters.js';
export {
  nativeElementProblems, nativeIndex, nativeModelProblems, nativeSection, resolveNativeParam, ringArea2 as nativeRingArea2,
  type NativeIndex,
} from './validate.js';
export { beamStoreParams, columnStoreParams, joineryStoreParams, openingStoreParams, slabStoreParams, wallStoreParams } from './to-store-params.js';
export { liftNativeModel } from './lift.js';
export { nativeIdOf, type LiftResult, type LiftSkip } from './lift-base.js';
export { encodeNativeSolids, nativeElementSolids, nativeModelSolids, type NativeSolidSpec, type SolidProfile } from './solids.js';
export { planNativeRemesh, type NativeRemeshPlan } from './remesh-plan.js';
export { nativePset, nativeQuantities, sectionArea, writeNativeExportSets, type NativeExportSets } from './export-sets.js';
export { convertToNativeInStore, planNativeConversion, sizedJoinerySpec, type NativeConversionPlan, type NativeConversionResult } from './convert.js';
export { nativeExportIds } from './export-ids.js';
export { nativeElementQuantities, type ElementQuantities } from './element-quantities.js';
export { liftSolid, readSolidShape, solidFaces, solidMeasures, solidStoreParams } from './solid.js';
export { NATIVE_SOLID_PSET, nativeIfcClass } from './ifc-mapping.js';
