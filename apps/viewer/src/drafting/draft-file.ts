/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Validating drafted entities and layers read from a project file. A
 * malformed entry fails with its path, like the rest of `project-file.ts`.
 */

import type { DraftEntity, DraftLayer, DraftParamValue, DraftShape, Pt } from './types';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function fail(path: string, message: string): never {
  throw new Error(`Not a project file: ${path} ${message}`);
}

function readPt(v: unknown, path: string): Pt {
  if (!isObject(v) || !isNumber(v.x) || !isNumber(v.y)) fail(path, 'must be a point { x, y }');
  return { x: v.x, y: v.y };
}

function readShape(v: unknown, path: string): DraftShape {
  if (!isObject(v)) fail(path, 'must be a shape');
  switch (v.type) {
    case 'line':
      return { type: 'line', a: readPt(v.a, `${path}.a`), b: readPt(v.b, `${path}.b`) };
    case 'polyline': {
      if (!Array.isArray(v.pts) || v.pts.length < 2) fail(`${path}.pts`, 'must hold at least 2 points');
      return { type: 'polyline', pts: v.pts.map((p, i) => readPt(p, `${path}.pts/${i}`)), closed: v.closed === true };
    }
    case 'circle':
      if (!isNumber(v.r) || v.r <= 0) fail(`${path}.r`, 'must be a positive radius');
      return { type: 'circle', c: readPt(v.c, `${path}.c`), r: v.r };
    case 'arc':
      if (!isNumber(v.r) || v.r <= 0 || !isNumber(v.start) || !isNumber(v.end)) fail(path, 'must be an arc { c, r, start, end }');
      return { type: 'arc', c: readPt(v.c, `${path}.c`), r: v.r, start: v.start, end: v.end };
    default:
      return fail(`${path}.type`, 'must be line, polyline, circle or arc');
  }
}

function readParams(v: unknown): Record<string, DraftParamValue> {
  if (!isObject(v)) return {};
  const params: Record<string, DraftParamValue> = {};
  for (const [key, value] of Object.entries(v)) {
    if (typeof value === 'string' || typeof value === 'boolean' || isNumber(value)) params[key] = value;
  }
  return params;
}

export function readDraft(v: unknown, path: string): DraftEntity {
  if (!isObject(v) || !isString(v.id) || !isString(v.viewId)) fail(path, 'must have a string id and viewId');
  return {
    id: v.id,
    viewId: v.viewId,
    layerId: isString(v.layerId) ? v.layerId : '0',
    shape: readShape(v.shape, `${path}.shape`),
    params: readParams(v.params),
  };
}

export function readDraftLayer(v: unknown, path: string): DraftLayer {
  if (!isObject(v) || !isString(v.id) || !isString(v.name)) fail(path, 'must be a layer { id, name }');
  return {
    id: v.id,
    name: v.name,
    color: isString(v.color) ? v.color : '#18181b',
    visible: v.visible !== false,
    locked: v.locked === true,
  };
}
