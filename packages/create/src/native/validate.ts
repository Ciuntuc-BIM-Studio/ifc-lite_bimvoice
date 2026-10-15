/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Resolution and validation of native elements (N0). A parameter resolves
 * from the element, then from its type (`instanceOrType`), then from its
 * default; validation reports every problem of one element against the
 * model it sits in (missing type / host / storey, wrong kinds, degenerate
 * shapes, out-of-range parameters).
 */

import type {
  NativeElement, NativeId, NativeModel, NativeSolidShape, NativeType, NativeValue, PlanPoint,
} from './schema.js';
import { NATIVE_PARAMS, nativeParamProblem } from './parameters.js';
import { NATIVE_IFC } from './ifc-mapping.js';

const EPS = 1e-9;

/** The lookups resolution and validation need from a model. */
export interface NativeIndex {
  element(id: NativeId): NativeElement | undefined;
  type(id: NativeId): NativeType | undefined;
  hasStorey(id: NativeId): boolean;
}

export function nativeIndex(model: Pick<NativeModel, 'elements' | 'types' | 'storeys'>): NativeIndex {
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  const types = new Map(model.types.map((t) => [t.id, t]));
  const storeys = new Set(model.storeys.map((s) => s.id));
  return { element: (id) => elements.get(id), type: (id) => types.get(id), hasStorey: (id) => storeys.has(id) };
}

/** The value a type supplies for `key`: layer sums for thickness, the joinery spec's sill. */
function typeValue(type: NativeType | undefined, key: string): NativeValue | undefined {
  if (!type) return undefined;
  if (key === 'thickness' && (type.kind === 'wall' || type.kind === 'slab')) {
    return type.layers.reduce((s, l) => s + l.thickness, 0);
  }
  if (key === 'height' && (type.kind === 'wall' || type.kind === 'column')) return type.height;
  if (key === 'sill' && (type.kind === 'door' || type.kind === 'window')) return type.spec.sillHeight;
  return undefined;
}

/** A parameter's effective value: the element's, its type's (where allowed), else the default. */
export function resolveNativeParam(element: NativeElement, key: string, index: Pick<NativeIndex, 'type'>): NativeValue | undefined {
  const param = NATIVE_PARAMS[element.kind].find((p) => p.key === key);
  const own = (element as unknown as Record<string, NativeValue | undefined>)[key];
  if (own !== undefined) return own;
  if (param?.scope === 'instanceOrType' && element.typeId) {
    const fromType = typeValue(index.type(element.typeId), key);
    if (fromType !== undefined) return fromType;
  }
  return param?.default;
}

const finitePoint = (p: readonly number[] | undefined, n: number) =>
  Array.isArray(p) && p.length === n && p.every((v) => typeof v === 'number' && Number.isFinite(v));

/** Twice the signed area of a plan ring (positive counter-clockwise). */
export function ringArea2(ring: readonly PlanPoint[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

/** What is wrong with a Studio solid's history, or nothing. */
export function solidShapeProblems(shape: NativeSolidShape | undefined): string[] {
  if (!shape || typeof shape !== 'object') return ['the solid has no shape'];
  const ring = (r: readonly (readonly number[])[] | undefined, dims: 2 | 3) => Array.isArray(r) && r.length >= 3 && r.every((p) => finitePoint(p, dims));
  switch (shape.operation) {
    case 'extrude':
      if (!ring(shape.outer, 2) || Math.abs(ringArea2(shape.outer)) <= EPS) return ['an extrusion needs a profile of at least 3 points with an area'];
      if (!(Number.isFinite(shape.depth) && shape.depth > 0)) return ['an extrusion needs a depth greater than zero'];
      if (![shape.location, shape.axis, shape.refDirection].every((p) => finitePoint(p, 3))) return ['an extrusion needs its plane (location, axis, direction)'];
      return [];
    case 'sweep':
      if (!ring(shape.profile, 2)) return ['a sweep needs a profile of at least 3 points'];
      if (!Array.isArray(shape.path) || shape.path.length < 2 || !shape.path.every((p) => finitePoint(p, 3))) return ['a sweep needs a path of at least 2 points'];
      return [];
    case 'revolve':
      if (!ring(shape.profile, 3)) return ['a revolve needs a profile of at least 3 points'];
      if (!finitePoint(shape.origin, 3) || !finitePoint(shape.direction, 3) || Math.hypot(...shape.direction) <= EPS) return ['a revolve needs an axis'];
      if (!(Number.isFinite(shape.angle) && shape.angle > 0 && shape.angle <= 2 * Math.PI + EPS)) return ['a revolve needs an angle in (0, 360°]'];
      return [];
    default:
      return ['unknown solid operation'];
  }
}

function shapeProblems(element: NativeElement): string[] {
  const out: string[] = [];
  switch (element.kind) {
    case 'wall':
      if (!finitePoint(element.start, 2) || !finitePoint(element.end, 2)) out.push('start and end must be finite plan points');
      else if (Math.hypot(element.end[0] - element.start[0], element.end[1] - element.start[1]) <= EPS) out.push('start and end must be distinct');
      break;
    case 'slab':
      if (!Array.isArray(element.outline) || element.outline.length < 3 || !element.outline.every((p) => finitePoint(p, 2))) {
        out.push('outline must have at least 3 finite points');
      } else if (Math.abs(ringArea2(element.outline)) <= EPS) out.push('outline encloses no area');
      for (const hole of element.holes ?? []) {
        if (hole.length < 3 || !hole.every((p) => finitePoint(p, 2)) || Math.abs(ringArea2(hole)) <= EPS) out.push('every hole must be a ring of at least 3 points with an area');
      }
      break;
    case 'solid':
      out.push(...solidShapeProblems(element.shape));
      break;
    case 'beam':
      if (!finitePoint(element.start, 3) || !finitePoint(element.end, 3)) out.push('start and end must be finite points');
      else if (Math.hypot(element.end[0] - element.start[0], element.end[1] - element.start[1], element.end[2] - element.start[2]) <= EPS) out.push('start and end must be distinct');
      break;
    case 'column':
      if (!finitePoint(element.position, 3)) out.push('position must be a finite point');
      break;
    case 'opening':
      if (element.host === 'wall' && !(typeof element.along === 'number' && Number.isFinite(element.along))) out.push('along must be a finite number');
      if (element.host === 'wall' && element.height === undefined) out.push('height is required in a wall');
      if (element.host === 'slab') {
        if (!finitePoint(element.center, 2)) out.push('center must be a finite plan point');
        if (element.depth === undefined) out.push('depth is required in a slab');
      }
      break;
    case 'door':
    case 'window':
      break;
  }
  return out;
}

function sectionOf(element: NativeElement, index: Pick<NativeIndex, 'type'>) {
  if (element.kind !== 'beam' && element.kind !== 'column') return undefined;
  if (element.section) return element.section;
  const type = element.typeId ? index.type(element.typeId) : undefined;
  return type && (type.kind === 'beam' || type.kind === 'column') ? type.section : undefined;
}

/** Every problem with `element` in the model `index` describes; empty when it can be built. */
export function nativeElementProblems(element: NativeElement, index: NativeIndex): string[] {
  const out: string[] = [];
  if (!NATIVE_IFC[element.kind]) return [`unknown kind ${String((element as { kind?: unknown }).kind)}`];
  if (!index.hasStorey(element.storeyId)) out.push(`storey ${element.storeyId} does not exist`);
  if (element.typeId) {
    const type = index.type(element.typeId);
    if (!type) out.push(`type ${element.typeId} does not exist`);
    else if (type.kind !== element.kind) out.push(`type ${element.typeId} is a ${type.kind} type, not a ${element.kind} type`);
  }
  if (element.kind === 'opening' || element.kind === 'door' || element.kind === 'window') {
    const host = index.element(element.hostId);
    const wanted = element.kind === 'opening' ? element.host : 'wall';
    if (!host) out.push(`host ${element.hostId} does not exist`);
    else if (host.kind !== wanted) out.push(`host ${element.hostId} is a ${host.kind}, not a ${wanted}`);
  }
  if ((element.kind === 'door' || element.kind === 'window') && !element.typeId) out.push(`a ${element.kind} needs its joinery type`);
  if ((element.kind === 'beam' || element.kind === 'column') && !sectionOf(element, index)) out.push('a section is required (on the element or its type)');
  out.push(...shapeProblems(element));
  for (const param of NATIVE_PARAMS[element.kind]) {
    const value = resolveNativeParam(element, param.key, index);
    if (value === undefined) {
      if (param.required) out.push(`${param.key} is required (on the element or its type)`);
      continue;
    }
    const problem = nativeParamProblem(param, value);
    if (problem) out.push(problem);
  }
  return out;
}

/** Every problem in a model, by element id; empty when every element can be built. */
export function nativeModelProblems(model: NativeModel): Map<NativeId, string[]> {
  const index = nativeIndex(model);
  const problems = new Map<NativeId, string[]>();
  const seen = new Set<NativeId>();
  for (const element of model.elements) {
    const list = nativeElementProblems(element, index);
    if (seen.has(element.id)) list.unshift(`duplicate id ${element.id}`);
    seen.add(element.id);
    if (list.length) problems.set(element.id, list);
  }
  return problems;
}

export { sectionOf as nativeSection };
