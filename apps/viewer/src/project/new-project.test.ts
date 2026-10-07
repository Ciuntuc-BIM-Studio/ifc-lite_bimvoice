/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** New Project: generated levels, validation, and the IFC file it writes. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultNewProjectSpec, generateLevels, newProjectFile, validateNewProject } from './new-project.js';

describe('generateLevels', () => {
  it('lists levels top-down from the ground floor, then basements', () => {
    assert.deepEqual(generateLevels(3, 1, 3.2), [
      { name: 'Level 2', elevation: 6.4 },
      { name: 'Level 1', elevation: 3.2 },
      { name: 'Ground Floor', elevation: 0 },
      { name: 'Basement 1', elevation: -3.2 },
    ]);
  });
});

describe('validateNewProject', () => {
  it('accepts the defaults and names what is missing', () => {
    assert.deepEqual(validateNewProject(defaultNewProjectSpec()), []);
    const spec = { ...defaultNewProjectSpec(), buildingName: ' ', levels: [], latitude: 120 };
    assert.deepEqual(validateNewProject(spec), ['buildingName', 'levels', 'latitude']);
  });
});

describe('newProjectFile', () => {
  it('writes the project, site, building and every level', async () => {
    const spec = {
      ...defaultNewProjectSpec(), projectName: 'Casa Popescu', siteName: 'Lot 12', buildingName: 'Corp A',
      latitude: 46.77, longitude: 23.59, levels: generateLevels(2, 1, 3),
    };
    const text = await newProjectFile(spec).text();
    assert.match(text, /IFCPROJECT\('[^']+',#\d+,'Casa Popescu'/);
    assert.match(text, /IFCSITE\('[^']+',#\d+,'Lot 12'/);
    assert.match(text, /IFCBUILDING\('[^']+',#\d+,'Corp A'/);
    assert.equal((text.match(/IFCBUILDINGSTOREY\(/g) ?? []).length, 3);
    assert.match(text, /'Basement 1',\$,\$,#\d+,\$,\$,\.ELEMENT\.,-3/);
  });

  it('states elevations in millimetres for a millimetre file', async () => {
    const text = await newProjectFile({ ...defaultNewProjectSpec(), lengthUnit: 'MILLIMETRE', levels: [{ name: 'L1', elevation: 3.2 }] }).text();
    assert.match(text, /'L1',\$,\$,#\d+,\$,\$,\.ELEMENT\.,3200/);
  });
});
