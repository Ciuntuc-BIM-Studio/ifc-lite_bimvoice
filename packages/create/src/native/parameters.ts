/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The scalar parameters of each native class, typed (N0): quantity and unit,
 * limits, default, whether a type may supply it, and the standard IFC
 * quantity or property it also appears as on export. Validation (`validate.ts`)
 * and, later, generic parameter editing read this table. Shape fields (axis
 * points, outlines, sections) are checked by `validate.ts` directly.
 */

import type { NativeKind, NativeValue } from './schema.js';

/** Length in metres, angle in radians; `enum` values are listed in `values`. */
export type NativeQuantity = 'length' | 'angle' | 'number' | 'boolean' | 'enum' | 'text';

export interface NativeParam {
  /** The element field. */
  key: string;
  quantity: NativeQuantity;
  /**
   * `instance`: only the element sets it. `instanceOrType`: the element's
   * value overrides the type's, which applies when the element has none.
   */
  scope: 'instance' | 'instanceOrType';
  /** Must resolve to a value (from the element, its type, or `default`). */
  required?: boolean;
  /** Inclusive lower bound, or exclusive with `minExclusive`. */
  min?: number;
  minExclusive?: boolean;
  max?: number;
  default?: NativeValue;
  values?: readonly string[];
  /** The standard quantity (Qto_*) or property (Pset_*Common) it is also written as. */
  ifc?: { set: string; name: string };
}

const ALIGNMENT = ['center', 'left', 'right'] as const;

export const NATIVE_PARAMS: Readonly<Record<NativeKind, readonly NativeParam[]>> = {
  wall: [
    { key: 'height', quantity: 'length', scope: 'instanceOrType', required: true, min: 0, minExclusive: true, ifc: { set: 'Qto_WallBaseQuantities', name: 'Height' } },
    { key: 'thickness', quantity: 'length', scope: 'instanceOrType', required: true, min: 0, minExclusive: true, ifc: { set: 'Qto_WallBaseQuantities', name: 'Width' } },
    { key: 'baseOffset', quantity: 'length', scope: 'instance', default: 0 },
    { key: 'alignment', quantity: 'enum', scope: 'instance', values: ALIGNMENT, default: 'center' },
    { key: 'offset', quantity: 'length', scope: 'instance', default: 0 },
    { key: 'flipLayers', quantity: 'boolean', scope: 'instance', default: false },
  ],
  slab: [
    { key: 'thickness', quantity: 'length', scope: 'instanceOrType', required: true, min: 0, minExclusive: true, ifc: { set: 'Qto_SlabBaseQuantities', name: 'Depth' } },
    { key: 'topOffset', quantity: 'length', scope: 'instance', default: 0 },
  ],
  beam: [
    { key: 'rotation', quantity: 'angle', scope: 'instance', default: 0 },
  ],
  column: [
    { key: 'height', quantity: 'length', scope: 'instanceOrType', required: true, min: 0, minExclusive: true, ifc: { set: 'Qto_ColumnBaseQuantities', name: 'Length' } },
    { key: 'rotation', quantity: 'angle', scope: 'instance', default: 0 },
  ],
  opening: [
    { key: 'width', quantity: 'length', scope: 'instance', required: true, min: 0, minExclusive: true, ifc: { set: 'Qto_OpeningElementBaseQuantities', name: 'Width' } },
    { key: 'height', quantity: 'length', scope: 'instance', min: 0, minExclusive: true, ifc: { set: 'Qto_OpeningElementBaseQuantities', name: 'Height' } },
    { key: 'depth', quantity: 'length', scope: 'instance', min: 0, minExclusive: true },
    { key: 'along', quantity: 'length', scope: 'instance' },
    { key: 'sill', quantity: 'length', scope: 'instance', default: 0 },
    { key: 'rotation', quantity: 'angle', scope: 'instance', default: 0 },
  ],
  door: [
    { key: 'along', quantity: 'length', scope: 'instance', required: true },
    { key: 'sill', quantity: 'length', scope: 'instanceOrType', default: 0 },
    { key: 'flipFacing', quantity: 'boolean', scope: 'instance', default: false },
    { key: 'flipHand', quantity: 'boolean', scope: 'instance', default: false },
  ],
  window: [
    { key: 'along', quantity: 'length', scope: 'instance', required: true },
    { key: 'sill', quantity: 'length', scope: 'instanceOrType' },
    { key: 'flipFacing', quantity: 'boolean', scope: 'instance', default: false },
    { key: 'flipHand', quantity: 'boolean', scope: 'instance', default: false },
  ],
};

/** The parameter `key` of a class, or undefined. */
export function nativeParam(kind: NativeKind, key: string): NativeParam | undefined {
  return NATIVE_PARAMS[kind].find((p) => p.key === key);
}

/** Why `value` is not acceptable for `param`, or null. `undefined` is "not set" and always passes here. */
export function nativeParamProblem(param: NativeParam, value: unknown): string | null {
  if (value === undefined) return null;
  switch (param.quantity) {
    case 'length':
    case 'angle':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${param.key} must be a finite number`;
      if (param.min !== undefined && (param.minExclusive ? value <= param.min : value < param.min)) {
        return `${param.key} must be ${param.minExclusive ? 'greater than' : 'at least'} ${param.min}`;
      }
      if (param.max !== undefined && value > param.max) return `${param.key} must be at most ${param.max}`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${param.key} must be true or false`;
    case 'enum':
      return typeof value === 'string' && (param.values ?? []).includes(value)
        ? null
        : `${param.key} must be one of ${(param.values ?? []).join(', ')}`;
    case 'text':
      return typeof value === 'string' ? null : `${param.key} must be text`;
  }
}
