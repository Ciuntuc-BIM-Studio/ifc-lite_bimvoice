/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project package: a document and its models survive build → zip →
 * unzip → read exactly as the project file reader gives them back, drafts
 * split per view, linked models kept as references, and a damaged, foreign
 * or newer package refused with a reason.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, strToU8 } from 'fflate';
import { defaultWindowSpec } from '@ifc-lite/create';
import { DEFAULT_DIM_STYLE, DEFAULT_TEXT_STYLE } from '@/drafting/styles';
import { parseProjectFile, serializeProject } from '../project-file.js';
import type { ProjectDocument } from '../types.js';
import { MANIFEST_PATH, PACKAGE_VERSION } from './format.js';
import { buildPackage, readPackage, unzipPackage, zipPackage } from './package-io.js';

const doc: ProjectDocument = {
  name: 'House',
  models: [{ key: 'arch', name: 'arch.ifc' }, { key: 'mep', name: 'mep.ifc' }],
  views: [
    { id: 'p1', name: 'Level 1', kind: 'plan', level: { name: 'Level 1', elevation: 3, storeyGlobalIds: ['G1'] }, cutHeight: 1.2, auto: true, createdAt: 1, graphics: { presetId: null, categories: { walls: { fillColor: '#ff0000', cutHatch: 'ANSI31', hatchScale: 2 } } } },
    { id: 'e1', name: 'North Elevation', kind: 'elevation', direction: 'north', auto: true, createdAt: 3, viewDepth: 12 },
  ],
  sheets: [{ id: 'sh1', number: 'A-101', name: 'Plans', createdAt: 5 }],
  drafts: [
    { id: 'd1', viewId: 'p1', layerId: '0', shape: { type: 'line', a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }, params: { ifcClass: 'IfcWall', depth: 2.7 } },
    { id: 'd2', viewId: 'e1', layerId: '0', shape: { type: 'arc', c: { x: 1, y: 1 }, r: 2, start: 0, end: 1.5 }, params: {} },
    { id: 'd3', viewId: 'p1', layerId: '0', shape: { type: 'line', a: { x: 1, y: 0 }, b: { x: 1, y: 4 } }, params: {} },
  ],
  draftLayers: [{ id: '0', name: '0', color: '#18181b', visible: true, locked: false }],
  hatchPatterns: '*MY-LINES, test\n0, 0,0, 0,2\n',
  symbolFlips: { '2O2Fr$t4X7Zf8NOew3FLOH': 3 },
  textStyles: [{ ...DEFAULT_TEXT_STYLE }, { ...DEFAULT_TEXT_STYLE, id: 'big', name: 'Big', height: 5, bold: true, color: '#aa0000' }],
  dimStyles: [{ ...DEFAULT_DIM_STYLE }],
  layerGroups: [{ id: 'g1', name: 'Annotation', visible: false, locked: true }],
  joineryTypes: [{ ...defaultWindowSpec('W-1'), id: 'j1' }],
  currentJoinery: { window: 'j1' },
  schedules: [{ id: 'sc1', name: 'Windows', kind: 'window', createdAt: 6, scale: 50 }],
};

const ifc = (text: string) => strToU8(`ISO-10303-21;\nHEADER;\n/* ${text} */\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`);

async function packaged() {
  const built = await buildPackage({
    projectId: 'prj-1', doc, app: { name: 'BIMVoice', version: '4.0.0' }, now: new Date('2026-10-09T10:00:00Z'),
    models: [
      { id: 'arch', name: 'arch.ifc', role: 'native', bytes: ifc('architecture') },
      { id: 'mep', name: 'mep.ifc', role: 'linked', source: 'mep.ifc', sha256: 'abc' },
    ],
  });
  return { ...built, zip: zipPackage(built.files) };
}

describe('project package', () => {
  it('round-trips the document as the project file reader reads it, with its native model', async () => {
    const { zip, manifest } = await packaged();
    const opened = await readPackage(unzipPackage(zip));
    // Drafts come back grouped by view, each view's in the order drawn (the order that matters).
    const expected = parseProjectFile(serializeProject(doc));
    const byView = (d: ProjectDocument) => [...d.drafts].sort((a, b) => a.viewId.localeCompare(b.viewId));
    assert.deepEqual({ ...opened.doc, drafts: byView(opened.doc) }, { ...expected, drafts: byView(expected) });
    assert.deepEqual(opened.doc.drafts.filter((d) => d.viewId === 'p1').map((d) => d.id), ['d1', 'd3']);
    assert.equal(opened.manifest.projectId, 'prj-1');
    assert.equal(manifest.version, PACKAGE_VERSION);
    const arch = opened.models.find((m) => m.model.id === 'arch')!;
    assert.equal(arch.model.role, 'native');
    assert.match(strFromU8(arch.bytes!), /architecture/);
    const mep = opened.models.find((m) => m.model.id === 'mep')!;
    assert.deepEqual(mep, { model: { id: 'mep', name: 'mep.ifc', role: 'linked', source: 'mep.ifc', sha256: 'abc' }, bytes: undefined });
  });

  it('splits the document into parts, one draft part per view', async () => {
    const { files, manifest } = await packaged();
    const paths = manifest.parts.map((p) => p.path);
    for (const p of ['project/document.json', 'project/views.json', 'project/sheets.json', 'project/standards.json', 'project/catalogs.json', 'project/drafts/p1.json', 'project/drafts/e1.json', 'models/arch.ifc']) {
      assert.ok(paths.includes(p), `${p} listed`);
      assert.ok(files.has(p), `${p} written`);
    }
    const p1 = JSON.parse(strFromU8(files.get('project/drafts/p1.json')!)) as { drafts: { id: string }[] };
    assert.deepEqual(p1.drafts.map((d) => d.id), ['d1', 'd3']);
    const core = JSON.parse(strFromU8(files.get('project/document.json')!)) as Record<string, unknown>;
    assert.equal(core.views, undefined);
    assert.equal(core.drafts, undefined);
  });

  it('writes the same part bytes for the same content (only changed parts differ between saves)', async () => {
    const a = await packaged();
    const b = await buildPackage({
      projectId: 'prj-1', doc: { ...doc, drafts: doc.drafts.map((d) => (d.id === 'd2' ? { ...d, layerId: '0', params: { note: 1 } } : d)) },
      models: [{ id: 'arch', name: 'arch.ifc', role: 'native', bytes: ifc('architecture') }],
    });
    const hash = (m: typeof a.manifest, path: string) => m.parts.find((p) => p.path === path)?.sha256;
    assert.equal(hash(a.manifest, 'project/drafts/p1.json'), hash(b.manifest, 'project/drafts/p1.json'));
    assert.equal(hash(a.manifest, 'models/arch.ifc'), hash(b.manifest, 'models/arch.ifc'));
    assert.notEqual(hash(a.manifest, 'project/drafts/e1.json'), hash(b.manifest, 'project/drafts/e1.json'));
  });

  it('refuses a damaged part, a missing model, a foreign archive and a newer format', async () => {
    const { files } = await packaged();
    const tampered = new Map(files);
    tampered.set('project/views.json', strToU8('{"views":[]}'));
    await assert.rejects(readPackage(tampered), /views\.json does not match its checksum/);
    const missing = new Map(files);
    missing.delete('models/arch.ifc');
    await assert.rejects(readPackage(missing), /models\/arch\.ifc is missing/);
    await assert.rejects(readPackage(new Map([['readme.txt', strToU8('hi')]])), /manifest\.json is missing/);
    const newer = new Map(files);
    const manifest = JSON.parse(strFromU8(files.get(MANIFEST_PATH)!));
    newer.set(MANIFEST_PATH, strToU8(JSON.stringify({ ...manifest, version: PACKAGE_VERSION + 1 })));
    await assert.rejects(readPackage(newer), /newer version of the app/);
    assert.throws(() => unzipPackage(strToU8('not a zip')), /not a ZIP archive/);
  });

  it('keeps document fields it does not split out (a newer app\'s fields survive in document.json)', async () => {
    const extra = { ...doc, futureThing: { a: 1 } } as ProjectDocument;
    const { files } = await buildPackage({ projectId: 'p', doc: extra, models: [] });
    const core = JSON.parse(strFromU8(files.get('project/document.json')!)) as Record<string, unknown>;
    assert.deepEqual(core.futureThing, { a: 1 });
  });
});
