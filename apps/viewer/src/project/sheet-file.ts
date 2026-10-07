/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading a sheet's paper, title block and viewports from a project file.
 * Lenient where a default is obvious (paper A1 landscape), strict where a
 * value is malformed (a viewport without a view or a positive scale).
 */

import type { PaperSize, ProjectSheet, SheetViewport } from './types';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const PAPERS: readonly PaperSize[] = ['A0', 'A1', 'A2', 'A3', 'A4'];

function fail(path: string, message: string): never {
  throw new Error(`Not a project file: ${path} ${message}`);
}

function readViewport(v: unknown, path: string): SheetViewport {
  if (!isObject(v) || !isString(v.id) || !isString(v.viewId)) fail(path, 'must be a viewport { id, viewId }');
  if (!isNumber(v.scale) || v.scale <= 0) fail(`${path}.scale`, 'must be a positive scale denominator');
  const num = (key: string, fallback: number) => (isNumber(v[key]) ? (v[key] as number) : fallback);
  const center = isObject(v.center) && isNumber(v.center.x) && isNumber(v.center.y) ? { x: v.center.x, y: v.center.y } : null;
  return {
    id: v.id, viewId: v.viewId, scale: v.scale,
    x: num('x', 100), y: num('y', 100), width: Math.max(0, num('width', 0)), height: Math.max(0, num('height', 0)), center,
  };
}

/** The optional sheet layout fields, read from `v` (already known to be an object). */
export function readSheetLayout(v: Json, path: string): Pick<ProjectSheet, 'paper' | 'orientation' | 'viewports' | 'titleBlock'> {
  const out: Pick<ProjectSheet, 'paper' | 'orientation' | 'viewports' | 'titleBlock'> = {};
  if (PAPERS.includes(v.paper as PaperSize)) out.paper = v.paper as PaperSize;
  if (v.orientation === 'portrait' || v.orientation === 'landscape') out.orientation = v.orientation;
  if (v.viewports !== undefined) {
    if (!Array.isArray(v.viewports)) fail(`${path}.viewports`, 'must be an array');
    out.viewports = v.viewports.map((vp, i) => readViewport(vp, `${path}.viewports/${i}`));
  }
  if (isObject(v.titleBlock)) {
    out.titleBlock = Object.fromEntries(Object.entries(v.titleBlock).filter((e): e is [string, string] => isString(e[1])));
  }
  return out;
}
