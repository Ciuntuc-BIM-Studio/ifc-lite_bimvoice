/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData } from '@ifc-lite/geometry';
import { minAreaRect, openingSymbols } from './opening-symbols';

/** A box mesh (corners only), world = origin + positions. */
function box(ifcType: string, min: [number, number, number], max: [number, number, number], origin?: [number, number, number]): MeshData {
  const pts: number[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) pts.push(x, y, z);
  return { expressId: 7, ifcType, positions: new Float32Array(pts), origin } as unknown as MeshData;
}

describe('minAreaRect', () => {
  it('finds a rotated rectangle, width along the long side', () => {
    const a = Math.PI / 6;
    const u = { x: Math.cos(a), y: Math.sin(a) }, n = { x: -u.y, y: u.x };
    const pts = [[-0.45, -0.1], [0.45, -0.1], [0.45, 0.1], [-0.45, 0.1]].map(([s, t]) => ({ x: 2 + u.x * s + n.x * t, y: 1 + u.y * s + n.y * t }));
    const r = minAreaRect(pts)!;
    assert.ok(Math.abs(r.width - 0.9) < 1e-9 && Math.abs(r.depth - 0.2) < 1e-9);
    assert.ok(Math.abs(r.c.x - 2) < 1e-9 && Math.abs(r.c.y - 1) < 1e-9);
    assert.ok(Math.abs(Math.abs(r.u.x * u.x + r.u.y * u.y) - 1) < 1e-9);
  });
});

describe('openingSymbols', () => {
  const plan = { axis: 'y' as const, position: 1.2, flipped: false };

  it('draws a door the cut passes through as a leaf and a quarter arc, at the mesh origin', () => {
    const [door] = openingSymbols([box('IfcDoor', [-0.45, -1.05, -0.03], [0.45, 1.05, 0.03], [5, 1.05, 2])], plan);
    assert.equal(door.kind, 'door');
    const arc = door.shapes.find((s) => s.type === 'arc');
    assert.ok(arc && arc.type === 'arc');
    assert.ok(Math.abs(arc.r - 0.9) < 1e-6);
    let sweep = arc.end - arc.start;
    while (sweep <= 0) sweep += Math.PI * 2;
    assert.ok(Math.abs(sweep - Math.PI / 2) < 1e-6, 'a quarter turn');
    assert.ok(Math.abs(arc.c.x - 4.55) < 1e-6, 'hinged at a jamb');
  });

  it('flips the hinge jamb and the swing side', () => {
    const mesh = box('IfcDoor', [-0.45, -1.05, -0.03], [0.45, 1.05, 0.03], [5, 1.05, 2]);
    const arcOf = (flips: number) => openingSymbols([mesh], plan, () => flips)[0].shapes.find((s) => s.type === 'arc');
    const tipOf = (flips: number) => openingSymbols([mesh], plan, () => flips)[0].shapes.find((s) => s.type === 'line');
    const hand = arcOf(1);
    assert.ok(hand?.type === 'arc' && Math.abs(hand.c.x - 5.45) < 1e-6, 'hinged on the other jamb');
    const plain = tipOf(0), side = tipOf(2);
    assert.ok(plain?.type === 'line' && side?.type === 'line');
    assert.ok(Math.sign(plain.b.y - plain.a.y) === -Math.sign(side.b.y - side.a.y), 'opens to the other side');
  });

  it('draws a window as frame and glazing, and skips what the cut misses', () => {
    const symbols = openingSymbols([
      box('IfcWindow', [0, 0.9, 0], [1.2, 2.1, 0.2]),
      { ...box('IfcDoor', [0, 1.5, 0], [0.9, 3, 0.1]), expressId: 8 } as MeshData,
    ], plan);
    assert.deepEqual(symbols.map((s) => s.kind), ['window']);
    assert.equal(symbols[0].shapes.length, 2);
  });
});
