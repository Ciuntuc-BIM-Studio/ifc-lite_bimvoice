/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The `.ifclite-project.json` sidecar: a document survives a save/parse
 * round trip, and malformed files fail with the path of the problem.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectFile, serializeProject } from './project-file.js';
import type { ProjectDocument } from './types.js';

const doc: ProjectDocument = {
  name: 'House',
  models: [{ key: 'hash-arch', name: 'arch.ifc' }],
  views: [
    { id: 'p1', name: 'Level 1', kind: 'plan', level: { name: 'Level 1', elevation: 3, storeyGlobalIds: ['G1'] }, cutHeight: 1.2, auto: true, createdAt: 1 },
    { id: 's1', name: 'Section A', kind: 'section', plane: { axis: 'front', offset: -2.5, flipped: true }, auto: false, createdAt: 2 },
    { id: 'e1', name: 'North Elevation', kind: 'elevation', direction: 'north', auto: true, createdAt: 3, viewDepth: 12 },
    { id: 'd1', name: '{3D}', kind: '3d', viewpoint: null, auto: true, createdAt: 4 },
  ],
  sheets: [{ id: 'sh1', number: 'A-101', name: 'Plans', createdAt: 5 }],
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

  it('reports invalid JSON', () => {
    assert.throws(() => parseProjectFile('{'), /invalid JSON/);
  });
});
