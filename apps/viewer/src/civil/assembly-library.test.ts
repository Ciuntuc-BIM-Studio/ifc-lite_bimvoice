/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorridor, defaultDesign } from '@ifc-lite/create';
import { EMPTY_PROJECT, loadProjectDocument, projectDocument } from '@/project/project-store';
import { parseProjectFile, serializeProject } from '@/project/project-file';
import { addTypicalSection, ensureStarterTypicalSections, matchingTypicalSection, removeTypicalSection, starterTypicalSections, typicalSections, updateTypicalSection } from './assembly-library';

beforeEach(() => loadProjectDocument({ ...EMPTY_PROJECT }));

describe('typical sections', () => {
  it('starts with four buildable road sections', () => {
    ensureStarterTypicalSections();
    assert.equal(typicalSections().length, 4);
    for (const t of starterTypicalSections()) {
      const model = buildCorridor({ name: t.name, alignment: { pis: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, profile: { pvis: [{ station: 0, elevation: 0 }, { station: 100, elevation: 1 }] }, assembly: t.assembly, design: defaultDesign(), interval: 10 }, null);
      assert.equal(model.solids.filter((s) => s.kind === 'course').length, t.assembly.layers.length, t.name);
    }
  });

  it('saves, updates, matches and removes; round-trips through the project file', () => {
    const [first] = starterTypicalSections();
    const id = addTypicalSection('Mine', first.assembly);
    assert.equal(matchingTypicalSection(first.assembly)?.id, id);
    const wider = { ...first.assembly, lanes: [{ width: 4, slope: -2.5 }] };
    updateTypicalSection(id, wider);
    assert.deepEqual(typicalSections().find((t) => t.id === id)?.assembly.lanes, [{ width: 4, slope: -2.5 }]);
    assert.deepEqual(parseProjectFile(serializeProject(projectDocument())).typicalSections, typicalSections());
    removeTypicalSection(id);
    assert.equal(typicalSections().length, 0);
  });
});
