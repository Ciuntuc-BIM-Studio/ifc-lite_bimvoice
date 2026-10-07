/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where each project view puts the live section plane, against a
 * [0,20] x [-1,11] x [0,10] model box (viewer Y-up).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectPlaneFromSection, sectionPlaneForView } from './view-plane.js';
import type { ProjectLevel, ProjectView } from './types.js';

const bounds = { min: { x: 0, y: -1, z: 0 }, max: { x: 20, y: 11, z: 10 } };
const level: ProjectLevel = { name: 'L1', elevation: 3, storeyGlobalIds: ['G1'] };
const base = { id: 'v', name: 'v', createdAt: 0 };

describe('sectionPlaneForView', () => {
  it('puts a plan cut its cut height above the resolved level', () => {
    const plan: ProjectView = { ...base, kind: 'plan', level, cutHeight: 1.2 };
    const plane = sectionPlaneForView(plan, bounds, [level]);
    assert.equal(plane?.axis, 'down');
    assert.equal(plane?.flipped, false);
    // 4.2 m on a -1..11 range is 43.33 %.
    assert.ok(Math.abs((plane?.position ?? 0) - (5.2 / 12) * 100) < 1e-9);
  });

  it('cannot open a plan whose level is not among the loaded levels', () => {
    const plan: ProjectView = { ...base, kind: 'plan', level, cutHeight: 1.2 };
    const other: ProjectLevel = { name: 'Roof', elevation: 9, storeyGlobalIds: ['R'] };
    assert.equal(sectionPlaneForView(plan, bounds, [other]), null);
  });

  it('looks at each facade from just inside the bounds, from outside the building', () => {
    const elevation = (direction: 'north' | 'south' | 'east' | 'west'): ProjectView => ({ ...base, kind: 'elevation', direction });
    // 5 cm on a 10 m Z range is 0.5 %, on a 20 m X range 0.25 %.
    assert.deepEqual(sectionPlaneForView(elevation('south'), bounds, []), { axis: 'front', position: 99.5, flipped: false });
    assert.deepEqual(sectionPlaneForView(elevation('north'), bounds, []), { axis: 'front', position: 0.5, flipped: true });
    assert.deepEqual(sectionPlaneForView(elevation('east'), bounds, []), { axis: 'side', position: 99.75, flipped: false });
    assert.deepEqual(sectionPlaneForView(elevation('west'), bounds, []), { axis: 'side', position: 0.25, flipped: true });
  });

  it('has no plane for a 3D view', () => {
    assert.equal(sectionPlaneForView({ ...base, kind: '3d', viewpoint: null }, bounds, []), null);
  });
});

describe('projectPlaneFromSection', () => {
  it('round-trips a cardinal section through world metres', () => {
    const captured = projectPlaneFromSection({ axis: 'side', position: 25, flipped: true }, bounds);
    assert.deepEqual(captured, { axis: 'side', offset: 5, flipped: true });
    const view: ProjectView = { ...base, kind: 'section', plane: captured! };
    assert.deepEqual(sectionPlaneForView(view, bounds, []), { axis: 'side', position: 25, flipped: true });
  });

  it('keeps the section where it is in the world when the model bounds grow', () => {
    const view: ProjectView = { ...base, kind: 'section', plane: { axis: 'side', offset: 5, flipped: false } };
    const wider = { ...bounds, max: { ...bounds.max, x: 40 } };
    assert.equal(sectionPlaneForView(view, wider, [])?.position, 12.5);
  });

  it('returns null without bounds', () => {
    assert.equal(projectPlaneFromSection({ axis: 'down', position: 50, flipped: false }, null), null);
  });
});
