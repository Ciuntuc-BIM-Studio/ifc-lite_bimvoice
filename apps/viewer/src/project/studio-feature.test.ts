/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { draftsOfView, drawRank } from '@/drafting/draft-store';
import type { DraftEntity } from '@/drafting/types';
import { featureOfProfile, holeEntities, sketchIds, sketchOfFace } from './studio-feature';
import type { ProjectView } from './types';

const square = (id: string, x: number, y: number, size: number, params: DraftEntity['params'] = {}): DraftEntity => ({
  id, viewId: 'v', layerId: '0', params,
  shape: { type: 'polyline', closed: true, pts: [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }] },
});

const linked = { ifcGlobalId: 'G1', ifcModelId: 'm', ifcClass: 'IfcSlab', depth: 0.2 };
const plate = square('plate', 0, 0, 100, linked);
const hole = square('hole', 10, 10, 40);
const island = square('island', 20, 20, 10);
const face: DraftEntity = { id: 'face', viewId: 'v', layerId: '0', params: { face: 'plate' }, shape: { type: 'hatch', loops: [], pattern: 'FACE', scale: 1, angle: 0 } };
const text: DraftEntity = { id: 'note', viewId: 'v', layerId: '0', params: {}, shape: { type: 'text', p: { x: 0, y: 0 }, text: 'A', height: 1 } as DraftEntity['shape'] };
const view = { id: 'v', name: 'Level 0', kind: 'plan' } as ProjectView;

describe('draw order', () => {
  it('puts hatches and faces behind contours, annotations on top, whatever order they were drawn in', () => {
    assert.deepEqual([face, plate, text].map(drawRank), [0, 1, 2]);
    assert.deepEqual(draftsOfView('v', [text, plate, face, hole]).map((e) => e.id), ['face', 'plate', 'hole', 'note']);
  });
});

describe('Studio feature', () => {
  const drafts = [plate, hole, island, face];

  it('takes only the first-level contours inside a profile as its holes', () => {
    assert.deepEqual(holeEntities(plate, drafts).map((e) => e.id), ['hole']);
  });

  it('reads an extrusion back: sketch, holes, face, depth and class', () => {
    const f = featureOfProfile(plate, drafts, [view], 7)!;
    assert.equal(f.operation, 'extrude');
    assert.equal(f.depth, 0.2);
    assert.equal(f.ifcClass, 'IfcSlab');
    assert.equal(f.face?.id, 'face');
    assert.deepEqual(sketchIds(f), ['plate', 'hole']);
  });

  it('reads a sweep with its path, and a revolve with its angle', () => {
    const path: DraftEntity = { id: 'path', viewId: 'v', layerId: '0', params: {}, shape: { type: 'line', a: { x: 0, y: 0 }, b: { x: 5, y: 0 } } };
    const swept = square('profile', 200, 0, 1, { ...linked, depth: undefined as never, solid: 'sweep', path: 'path' });
    const sweep = featureOfProfile(swept, [swept, path], [view], 8)!;
    assert.equal(sweep.operation, 'sweep');
    assert.equal(sweep.guide?.id, 'path');
    assert.deepEqual(sketchIds(sweep), ['profile', 'path']);
    const turned = square('turned', 200, 0, 1, { ...linked, solid: 'revolve', axis: 'gone', angle: 90 });
    const revolve = featureOfProfile(turned, [turned], [view], 9)!;
    assert.equal(revolve.angle, 90);
    assert.equal(revolve.guide, null);
  });

  it('leaves roofs and corridors to their own editors', () => {
    assert.equal(featureOfProfile(square('r', 0, 0, 10, { ...linked, roofKind: 'hip' }), [], [view], 1), null);
  });

  it('opens a face onto its sketch: the contour and its holes', () => {
    assert.deepEqual(sketchOfFace(face, drafts), ['plate', 'hole']);
  });
});
