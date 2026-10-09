/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Versions over a vault: numbered, sharing unchanged parts, an update keeping
 * what it replaced, a version rebuilt and opened as a package, and two
 * versions compared part by part.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8 } from 'fflate';
import type { ProjectDocument } from '../types.js';
import { buildPackage, readPackage } from './package-io.js';
import type { PackageManifest } from './format.js';
import { compareVersions, memoryVault, saveVersion, updateVersion, versionFiles, type ProjectVault } from './versions.js';

const doc = (lines: number): ProjectDocument => ({
  name: 'House', models: [{ key: 'arch', name: 'arch.ifc' }],
  views: [{ id: 'p1', name: 'Level 1', kind: 'plan', level: { name: 'Level 1', elevation: 3, storeyGlobalIds: [] }, cutHeight: 1.2, auto: true, createdAt: 1 }],
  sheets: [],
  drafts: Array.from({ length: lines }, (_, i) => ({ id: `d${i}`, viewId: 'p1', layerId: '0', shape: { type: 'line' as const, a: { x: i, y: 0 }, b: { x: i, y: 4 } }, params: {} })),
  draftLayers: [{ id: '0', name: '0', color: '#000000', visible: true, locked: false }],
});
const ifc = strToU8('ISO-10303-21;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
const pkg = (lines: number) => buildPackage({ projectId: 'prj', doc: doc(lines), models: [{ id: 'arch', name: 'arch.ifc', role: 'native', bytes: ifc }] });

/** A vault that counts the parts it is asked to store. */
function countingVault(): ProjectVault & { puts: number } {
  const inner = memoryVault();
  const v = { ...inner, puts: 0, putBlob: async (sha: string, bytes: Uint8Array) => { v.puts++; await inner.putBlob(sha, bytes); } };
  return v;
}

describe('project versions', () => {
  it('numbers versions and stores a part shared between them once', async () => {
    const vault = countingVault();
    const a = await pkg(1);
    const v1 = await saveVersion(vault, a.files, a.manifest, { name: 'Concept', message: 'first', now: 1 });
    const firstPuts = vault.puts;
    const b = await pkg(2);
    const v2 = await saveVersion(vault, b.files, b.manifest, { name: '', message: 'more lines', parent: v1.id, now: 2 });
    assert.equal(v1.number, 1);
    assert.equal(v2.number, 2);
    assert.equal(v2.name, 'Version 2');
    assert.equal(v2.parent, v1.id);
    // Only the changed drafts part is new: the model, views, standards and document are shared.
    assert.equal(vault.puts - firstPuts, 1);
    assert.deepEqual((await vault.listVersions('prj')).map((v) => v.number), [1, 2]);
  });

  it('updates a version in place, keeping the replaced content as a revision', async () => {
    const vault = memoryVault();
    const a = await pkg(1);
    const v1 = await saveVersion(vault, a.files, a.manifest, { name: 'Permit', message: 'submitted', now: 1 });
    const b = await pkg(3);
    const updated = await updateVersion(vault, v1, b.files, b.manifest, 'fixed after review', 5);
    assert.equal(updated.id, v1.id);
    assert.equal(updated.number, 1);
    assert.equal(updated.revisions.length, 1);
    assert.equal(updated.revisions[0].message, 'submitted');
    assert.equal(updated.manifest.versionInfo?.message, 'fixed after review');
    assert.deepEqual((await vault.listVersions('prj')).map((v) => v.id), [v1.id]);
  });

  it('rebuilds a version into a package that opens with its document and model', async () => {
    const vault = memoryVault();
    const a = await pkg(2);
    const v1 = await saveVersion(vault, a.files, a.manifest, { name: 'A', message: '' });
    const opened = await readPackage(await versionFiles(vault, v1));
    assert.equal(opened.doc.drafts.length, 2);
    assert.equal(opened.manifest.versionInfo?.id, v1.id);
    assert.ok(opened.models[0].bytes);
  });

  it('compares two versions part by part, grouped by area', async () => {
    const a = await pkg(1);
    const b = await pkg(2);
    const diff = compareVersions(a.manifest, b.manifest);
    assert.deepEqual(diff.changed, ['project/drafts/p1.json']);
    assert.deepEqual(diff.areas, { drawings: 1 });
    assert.deepEqual(diff.added, []);
  });
});

describe('version comparison of models', () => {
  it('counts an edited model once although its file is renamed by its content', () => {
    const part = (path: string, sha: string) => ({ path, sha256: sha, size: 1 });
    const base: Omit<PackageManifest, 'parts'> = { format: 'bimvoice-project', version: 1, app: { name: 'x', version: '1' }, projectId: 'p', projectName: 'p', savedAt: '', models: [] };
    const diff = compareVersions(
      { ...base, parts: [part('models/a.ifc', 'a'), part('project/document.json', 'd')] },
      { ...base, parts: [part('models/b.ifc', 'b'), part('project/document.json', 'd')] },
    );
    assert.deepEqual(diff.areas, { models: 1 });
  });
});
