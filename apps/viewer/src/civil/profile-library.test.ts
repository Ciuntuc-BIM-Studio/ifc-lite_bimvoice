/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The structure profile library in the project: starters, edits, files, a profile from a drawn contour. */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_IDS, profileArea, structureProfileProblem } from '@ifc-lite/create';
import { EMPTY_PROJECT, loadProjectDocument, projectDocument, useProjectStore } from '@/project/project-store';
import { parseProjectFile, serializeProject } from '@/project/project-file';
import type { DraftEntity } from '@/drafting/types';
import {
  reflectProfile, addProfile, duplicateProfile, ensureStarterProfiles, exportProfiles, importProfiles, moveOrigin, profileFromDraft, removeProfile, structureProfile, structureProfiles, updateProfile,
} from './profile-library';

const poly = (id: string, pts: [number, number][]): DraftEntity => ({ id, viewId: 'v', layerId: '0', shape: { type: 'polyline', pts: pts.map(([x, y]) => ({ x, y })), closed: true }, params: {} });

beforeEach(() => loadProjectDocument({ ...EMPTY_PROJECT, structureProfiles: [] }));

describe('structure profile library', () => {
  it('starts with one profile per preset, then adds, copies, changes and removes', () => {
    ensureStarterProfiles();
    assert.equal(structureProfiles().length, PRESET_IDS.length);
    ensureStarterProfiles();
    assert.equal(structureProfiles().length, PRESET_IDS.length, 'only an empty library is seeded');
    const id = addProfile('box-tunnel');
    const copy = duplicateProfile(id)!;
    assert.equal(structureProfile(copy)?.name, 'Box tunnel copy');
    updateProfile({ ...structureProfile(copy)!, name: 'Twin box' });
    assert.equal(structureProfile(copy)?.name, 'Twin box');
    removeProfile(id);
    assert.equal(structureProfile(id), null);
    assert.equal(useProjectStore.getState().dirty, true);
  });

  it('mirrors and flips a profile for good, keeping it counter-clockwise and valid', () => {
    const id = addProfile('cantilever-wall');
    const p = structureProfile(id)!;
    const m = reflectProfile(p, 'x');
    assert.equal(m.preset, undefined);
    assert.ok(m.outer.every((q, i) => q[0] === -[...p.outer].reverse()[i][0]));
    assert.equal(structureProfileProblem(m), null);
    assert.ok(Math.abs(profileArea(m) - profileArea(p)) < 1e-9);
    const f = reflectProfile(p, 'y');
    assert.equal(f.anchors.find((a) => a.name === 'top')!.at[1], -3);
  });

  it('round-trips through a library file and the project file', () => {
    const id = addProfile('cantilever-wall');
    const text = exportProfiles();
    removeProfile(id);
    assert.equal(importProfiles(text), 1);
    assert.deepEqual(structureProfile(id)?.preset?.id, 'cantilever-wall');
    const doc = parseProjectFile(serializeProject(projectDocument()));
    assert.deepEqual(doc.structureProfiles, structureProfiles());
  });

  it('makes a custom profile from a drawn contour, its inner contour a hole, origin at its lowest point', () => {
    useProjectStore.setState({ drafts: [poly('outer', [[10, 5], [14, 5], [14, 9], [10, 9]]), poly('inner', [[11, 6], [13, 6], [13, 8], [11, 8]])] });
    const made = profileFromDraft('outer', 'Culvert');
    assert.ok(made.ok);
    const p = structureProfile(made.id)!;
    assert.equal(p.kind, 'custom');
    assert.equal(p.preset, undefined);
    assert.deepEqual(p.outer[0], [0, 0]);
    assert.equal(p.holes.length, 1);
    assert.equal(structureProfileProblem(p), null);
    assert.ok(Math.abs(profileArea(p) - 12) < 1e-9);
    const moved = moveOrigin(p, [2, 0]);
    assert.ok(moved.outer.some((q) => q[0] === -2 && q[1] === 0));
    assert.deepEqual(profileFromDraft('missing', 'x'), { ok: false, error: 'notClosed' });
  });
});
