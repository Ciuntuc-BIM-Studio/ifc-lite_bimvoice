/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The Lapin native model schema (docs/format-lapin-nativ.md, N0). */

export {
  NATIVE_SCHEMA_VERSION,
  type NativeBeam, type NativeColumn, type NativeElement, type NativeElementBase, type NativeId,
  type NativeJoinery, type NativeKind, type NativeLayer, type NativeMaterial, type NativeModel,
  type NativeOpening, type NativeProperty, type NativeRelation, type NativeSlab, type NativeSlabOpening,
  type NativeStorey, type NativeType, type NativeValue, type NativeWall, type NativeWallOpening,
  type PlanPoint as NativePlanPoint, type LocalPoint as NativeLocalPoint,
} from './schema.js';
export { NATIVE_IFC, NATIVE_PSET, nativeGlobalId, nativeIdFromGlobalId, nativePredefinedType, type NativeClassMapping } from './ifc-mapping.js';
export { NATIVE_PARAMS, nativeParam, nativeParamProblem, type NativeParam, type NativeQuantity } from './parameters.js';
export {
  nativeElementProblems, nativeIndex, nativeModelProblems, nativeSection, resolveNativeParam, ringArea2 as nativeRingArea2,
  type NativeIndex,
} from './validate.js';
export { beamStoreParams, columnStoreParams, openingStoreParams, slabStoreParams, wallStoreParams } from './to-store-params.js';
