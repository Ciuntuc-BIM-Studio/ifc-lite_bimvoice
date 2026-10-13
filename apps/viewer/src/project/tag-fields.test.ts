/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { missingRanges } from '@/drafting/styles';
import { encodeMissing, fillTemplate, tagsClass, templateFields } from './tag-fields';

const values: Record<string, string> = { Name: 'W-01', 'Pset_WallCommon.FireRating': 'EI60' };
const lookup = (field: string) => values[field] ?? null;

describe('tag templates', () => {
  it('lists the fields of a template', () => {
    assert.deepEqual(templateFields('{Name} – { Pset_WallCommon.FireRating }'), ['Name', 'Pset_WallCommon.FireRating']);
  });

  it('fills mapped fields and marks the missing ones NaN', () => {
    const filled = fillTemplate('{Name} / {Pset_WallCommon.FireRating} / {Qto.Length}', lookup);
    assert.equal(filled.text, 'W-01 / EI60 / NaN');
    assert.deepEqual(filled.missing, [[14, 17]]);
    assert.equal(filled.text.slice(14, 17), 'NaN');
  });

  it('treats an empty value as missing', () => {
    const filled = fillTemplate('{A}{B}', (f) => (f === 'A' ? '' : 'x'));
    assert.deepEqual(filled, { text: 'NaNx', missing: [[0, 3]] });
  });

  it('round-trips the missing ranges through the entity params', () => {
    const missing: Array<[number, number]> = [[0, 3], [8, 11]];
    assert.deepEqual(missingRanges({ tagMissing: encodeMissing(missing) }), missing);
    assert.deepEqual(missingRanges({}), []);
    assert.deepEqual(missingRanges({ tagMissing: 'junk,5:2' }), []);
  });

  it('tags any class when none is listed, else only the listed ones', () => {
    assert.equal(tagsClass([], 'IfcDoor'), true);
    assert.equal(tagsClass(['IfcWall', 'Door'], 'IfcDoor'), true);
    assert.equal(tagsClass(['IfcWall'], 'IfcDoor'), false);
  });
});
