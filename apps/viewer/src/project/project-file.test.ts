/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The `.ifclite-project.json` sidecar: a document survives a save/parse
 * round trip, and malformed files fail with the path of the problem.
 */

import { DEFAULT_DIM_STYLE, DEFAULT_TEXT_STYLE } from '@/drafting/styles';
import { describe, it } from 'node:test';
import { defaultWindowSpec } from '@ifc-lite/create';
import assert from 'node:assert/strict';
import { parseProjectFile, serializeProject } from './project-file.js';
import type { ProjectDocument } from './types.js';

const doc: ProjectDocument = {
  name: 'House',
  models: [{ key: 'hash-arch', name: 'arch.ifc' }],
  views: [
    { id: 'p1', name: 'Level 1', kind: 'plan', level: { name: 'Level 1', elevation: 3, storeyGlobalIds: ['G1'] }, cutHeight: 1.2, auto: true, createdAt: 1, graphics: { presetId: null, categories: { walls: { fillColor: '#ff0000', cutHatch: 'ANSI31', hatchScale: 2 }, doors: { visible: false } } } },
    { id: 's1', name: 'Section A', kind: 'section', plane: { axis: 'front', offset: -2.5, flipped: true }, auto: false, createdAt: 2 },
    { id: 'e1', name: 'North Elevation', kind: 'elevation', direction: 'north', auto: true, createdAt: 3, viewDepth: 12 },
    { id: 'd1', name: '{3D}', kind: '3d', viewpoint: null, auto: true, createdAt: 4 },
  ],
  sheets: [{ id: 'sh1', number: 'A-101', name: 'Plans', createdAt: 5 }],
  drafts: [
    { id: 'd1', viewId: 'p1', layerId: '0', shape: { type: 'line', a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }, params: { ifcClass: 'IfcWall', depth: 2.7 } },
    { id: 'd2', viewId: 'p1', layerId: '0', shape: { type: 'arc', c: { x: 1, y: 1 }, r: 2, start: 0, end: 1.5 }, params: {} },
  ],
  draftLayers: [{ id: '0', name: '0', color: '#18181b', visible: true, locked: false }],
  hatchPatterns: '*MY-LINES, test\n0, 0,0, 0,2\n',
  symbolFlips: { '2O2Fr$t4X7Zf8NOew3FLOH': 3 },
  textStyles: [{ ...DEFAULT_TEXT_STYLE }, { ...DEFAULT_TEXT_STYLE, id: 'big', name: 'Big', height: 5, bold: true, color: '#aa0000' }],
  dimStyles: [{ ...DEFAULT_DIM_STYLE }, { ...DEFAULT_DIM_STYLE, id: 'arch', name: 'Arch', arrow: 'arrow', placement: 'below', unit: 'mm', precision: 0 }],
  layerGroups: [{ id: 'g1', name: 'Annotation', visible: false, locked: true }],
  joineryTypes: [{ ...defaultWindowSpec('W-1'), id: 'j1', columns: [2, 1], panels: [{ col: 0, row: 0, operation: 'tilt-turn-right' }] }],
  currentJoinery: { window: 'j1' },
  elementTypes: [
    { id: 't1', kind: 'wall', name: 'Brick 30', mark: 'WT1', height: 3, layers: [{ name: 'Brick', thickness: 0.25, color: '#b5651d' }, { name: 'Plaster', thickness: 0.015 }] },
    { id: 't2', kind: 'column', name: 'HEA 200', mark: 'C1', height: 3.2, section: { Type: 'I', OverallWidth: 0.2, OverallDepth: 0.19, WebThickness: 0.0065, FlangeThickness: 0.01 } },
    { id: 't3', kind: 'opening', name: 'Shaft', mark: 'O1', width: 0.6, height: 0.6, sill: 0 },
  ],
  currentTypes: { wall: 't1', column: 't2' },
  schedules: [{ id: 's1', name: 'Window schedule', kind: 'window', createdAt: 5, scale: 25 }],
  structureProfiles: [],
  civilDrawings: [{ id: 'c1', name: 'DN1 profile', kind: 'profile', createdAt: 3, corridorGlobalId: '2O2Fr$t4X7Zf8NOew3FLOH', scale: 1000, vExaggeration: 10 }],
};

describe('project file', () => {
  it('round-trips a project document', () => {
    assert.deepEqual(parseProjectFile(serializeProject(doc)), doc);
  });

  it('rejects a file of another format', () => {
    assert.throws(() => parseProjectFile(JSON.stringify({ format: 'ifclite-document', version: 1 })), /\/format/);
  });

  it('rejects an unsupported version', () => {
    assert.throws(() => parseProjectFile(JSON.stringify({ format: 'ifclite-project', version: 2 })), /\/version 2 is not supported/);
  });

  it('names the view that is malformed', () => {
    const bad = JSON.parse(serializeProject(doc));
    bad.views[2].direction = 'up';
    assert.throws(() => parseProjectFile(JSON.stringify(bad)), /\/views\/2\.direction/);
  });

  it('names a malformed drafted shape', () => {
    const bad = JSON.parse(serializeProject(doc));
    bad.drafts[1].shape.r = -1;
    assert.throws(() => parseProjectFile(JSON.stringify(bad)), /\/drafts\/1\.shape\.r|\/drafts\/1\.shape must be an arc/);
  });

  it('reports invalid JSON', () => {
    assert.throws(() => parseProjectFile('{'), /invalid JSON/);
  });
});
