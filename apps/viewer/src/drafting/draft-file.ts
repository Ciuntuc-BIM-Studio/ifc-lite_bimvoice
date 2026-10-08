/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Validating drafted entities and layers read from a project file. A
 * malformed entry fails with its path, like the rest of `project-file.ts`.
 */

import type { AnnotationShape, DraftEntity, DraftLayer, DraftParamValue, DraftShape, EntityShape, Pt } from './types';

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

function readHeight(v: Json, path: string): number {
  if (!isNumber(v.height) || v.height <= 0) fail(`${path}.height`, 'must be a positive text height');
  return v.height;
}

function readAnnotation(v: Json, path: string): AnnotationShape | null {
  const pt = (key: string) => readPt(v[key], `${path}.${key}`);
  switch (v.type) {
    case 'text':
      if (!isString(v.text)) fail(`${path}.text`, 'must be a string');
      return { type: 'text', p: pt('p'), text: v.text, height: readHeight(v, path), rotation: isNumber(v.rotation) ? v.rotation : 0 };
    case 'leader':
      if (!Array.isArray(v.pts) || v.pts.length < 2 || !isString(v.text)) fail(path, 'must be a leader { pts, text }');
      return { type: 'leader', pts: v.pts.map((p, i) => readPt(p, `${path}.pts/${i}`)), text: v.text, height: readHeight(v, path) };
    case 'dimension':
      return {
        type: 'dimension', variant: v.variant === 'linear' ? 'linear' : 'aligned', a: pt('a'), b: pt('b'), at: pt('at'),
        height: readHeight(v, path), ...(isString(v.text) ? { text: v.text } : {}),
      };
    case 'radial':
      if (!isNumber(v.r) || v.r <= 0) fail(`${path}.r`, 'must be a positive radius');
      return { type: 'radial', c: pt('c'), r: v.r, at: pt('at'), diameter: v.diameter === true, height: readHeight(v, path) };
    case 'angular':
      return { type: 'angular', c: pt('c'), a: pt('a'), b: pt('b'), at: pt('at'), height: readHeight(v, path) };
    case 'level':
      if (!isNumber(v.value)) fail(`${path}.value`, 'must be a number');
      return { type: 'level', p: pt('p'), value: v.value, height: readHeight(v, path) };
    case 'hatch': {
      if (!Array.isArray(v.loops) || v.loops.length === 0 || !isString(v.pattern)) fail(path, 'must be a hatch { loops, pattern }');
      const loops = v.loops.map((loop, i) => {
        if (!Array.isArray(loop) || loop.length < 3) fail(`${path}.loops/${i}`, 'must hold at least 3 points');
        return loop.map((p, j) => readPt(p, `${path}.loops/${i}/${j}`));
      });
      return {
        type: 'hatch', loops, pattern: v.pattern, scale: isNumber(v.scale) && v.scale > 0 ? v.scale : 1, angle: isNumber(v.angle) ? v.angle : 0,
        ...(isString(v.color) ? { color: v.color } : {}),
      };
    }
    default:
      return null;
  }
}

function readShape(v: unknown, path: string): EntityShape {
  if (!isObject(v)) fail(path, 'must be a shape');
  const annotation = readAnnotation(v, path);
  if (annotation) return annotation;
  return readGeometry(v, path);
}

function readGeometry(v: Json, path: string): DraftShape {
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
      return fail(`${path}.type`, 'must be a drafting or annotation shape type');
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
    ...(typeof v.lineWeight === 'number' && v.lineWeight > 0 ? { lineWeight: v.lineWeight } : {}),
    ...(v.lineType === 'dashed' || v.lineType === 'dotted' || v.lineType === 'dashdot' ? { lineType: v.lineType } : {}),
    ...(isString(v.group) ? { group: v.group } : {}),
  };
}
