/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { defaultWindowSpec } from '../in-store/joinery-spec.js';
import { NATIVE_SCHEMA_VERSION, type NativeElement, type NativeModel } from './schema.js';
import { nativeIndex } from './validate.js';
import { encodeNativeSolids, nativeElementSolids, nativeModelSolids } from './solids.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const S = id(1);

function model(elements: NativeElement[]): NativeModel {
  return {
    schemaVersion: NATIVE_SCHEMA_VERSION, id: id(0), name: 't', storeys: [{ id: S, name: '', elevation: 0 }],
    types: [{ id: id(9), kind: 'window', name: 'W', spec: defaultWindowSpec('W') }], materials: [], relations: [], properties: [], elements,
  };
}

/** Apply a column-major matrix to a point. */
const apply = (m: number[], [x, y, z]: number[]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);

describe('native solids', () => {
  it('places a wall body at its start along its axis and cuts what it hosts', () => {
    const wall: NativeElement = { id: id(2), kind: 'wall', storeyId: S, start: [1, 1], end: [1, 5], thickness: 0.3, height: 2.8, baseOffset: 0.1, endCut: { left: 0.15, right: -0.15 } };
    const opening: NativeElement = { id: id(3), kind: 'opening', host: 'wall', storeyId: S, hostId: id(2), along: 1, sill: 0.9, width: 1, height: 1.2 };
    const win: NativeElement = { id: id(4), kind: 'window', storeyId: S, hostId: id(2), typeId: id(9), along: 3 };
    const m = model([wall, opening, win]);
    const [solid] = nativeElementSolids(wall, nativeIndex(m), m.elements);
    expect(solid.depth).toBe(2.8);
    expect(solid.profile).toEqual({ kind: 'polygon', outer: [[-0, -0.15], [4 - 0.15, -0.15], [4 + 0.15, 0.15], [-0, 0.15]] });
    // Local X runs up the plan's Y axis from the start, at the base offset.
    expect(apply(solid.placement, [2, 0, 0]).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 3, 0.1]);
    expect(solid.cuts).toHaveLength(2);
    const window = solid.cuts![1];
    // The window's opening is its type's size, from its type's sill.
    expect(window.depth).toBe(1.5);
    expect(apply(window.placement, [0, 0, 0]).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 1, 0.1 + 0.9]);
  });

  it('hangs a slab below its top and turns a column; a vertical beam keeps a valid frame', () => {
    const slab: NativeElement = { id: id(5), kind: 'slab', storeyId: S, outline: [[0, 0], [4, 0], [4, 3], [0, 3]], thickness: 0.2, topOffset: 3 };
    const col: NativeElement = { id: id(6), kind: 'column', storeyId: S, position: [2, 2, 0], height: 3, rotation: Math.PI / 2, section: { Type: 'Rectangle', XDim: 0.3, YDim: 0.5 } };
    const beam: NativeElement = { id: id(7), kind: 'beam', storeyId: S, start: [0, 0, 0], end: [0, 0, 3], section: { Type: 'Circle', Radius: 0.1 } };
    const m = model([slab, col, beam]);
    const solids = nativeModelSolids(m.elements, nativeIndex(m));
    expect(apply(solids.get(id(5))![0].placement, [0, 0, 0])).toEqual([0, 0, 2.8]);
    const c = solids.get(id(6))![0];
    expect(apply(c.placement, [1, 0, 0]).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([2, 3, 0]);
    const b = solids.get(id(7))![0];
    expect(b.depth).toBe(3);
    expect(apply(b.placement, [0, 0, 3]).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 0, 3]);
  });

  it('encodes the wire format the Rust mesher reads', () => {
    const col: NativeElement = { id: id(6), kind: 'column', storeyId: S, position: [0, 0, 0], height: 3, section: { Type: 'I', OverallWidth: 0.2, OverallDepth: 0.3, WebThickness: 0.01, FlangeThickness: 0.02 } };
    const m = model([col]);
    const buf = encodeNativeSolids(nativeElementSolids(col, nativeIndex(m)));
    // count, code, dimCount, 5 dims (fillet absent = NaN), 16 placement, depth, cutCount
    expect(buf.length).toBe(1 + 2 + 5 + 16 + 1 + 1);
    expect([...buf.slice(0, 7)]).toEqual([1, 2, 5, 0.2, 0.3, 0.01, 0.02]);
    expect(Number.isNaN(buf[7])).toBe(true);
    expect(buf[buf.length - 2]).toBe(3);
  });
});
