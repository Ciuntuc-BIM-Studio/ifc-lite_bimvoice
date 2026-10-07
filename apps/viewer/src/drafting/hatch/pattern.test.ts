/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parsePat, serializePat } from './pattern.js';
import { builtInPatterns, findPattern } from './library.js';

const SAMPLE = [
  '; a test file',
  '*demo, Demo pattern ; trailing comment',
  '0, 0,0, 0,1',
  '',
  '45, 0.5, 0.25 , 1, 2, 3, -1.5, 0, -1.5',
  '*Other',
  '90, 0,0, 0, 4, bogus',
  '30, 1,2',
  '  ; indented comment',
  '60, 0,0, 0,3, 0,-2',
  '*empty-solid, nothing here',
].join('\r\n');

describe('parsePat', () => {
  const { patterns, errors } = parsePat(SAMPLE);

  it('reads all patterns with uppercase names and descriptions', () => {
    assert.equal(patterns.length, 3);
    assert.equal(patterns[0].name, 'DEMO');
    assert.equal(patterns[0].description, 'Demo pattern');
    assert.equal(patterns[1].name, 'OTHER');
    assert.equal(patterns[1].description, '');
    assert.equal(patterns[2].name, 'EMPTY-SOLID');
  });

  it('parses families, dashes and dots', () => {
    const [a, b] = patterns[0].families;
    assert.equal(patterns[0].families.length, 2);
    assert.equal(a.angleDeg, 0);
    assert.deepEqual(a.dashes, []);
    assert.equal(a.deltaY, 1);
    assert.equal(b.angleDeg, 45);
    assert.deepEqual(b.origin, { x: 0.5, y: 0.25 });
    assert.equal(b.deltaX, 1);
    assert.equal(b.deltaY, 2);
    assert.deepEqual(b.dashes, [3, -1.5, 0, -1.5]);
    assert.deepEqual(patterns[1].families[0].dashes, [0, -2]);
  });

  it('reports bad lines with line numbers and skips them', () => {
    assert.equal(errors.length, 2);
    assert.match(errors[0], /^line 7:/);
    assert.match(errors[0], /bogus/);
    assert.match(errors[1], /^line 8:/);
    assert.equal(patterns[1].families.length, 1);
  });

  it('treats a pattern without families as solid', () => {
    assert.equal(patterns[2].solid, true);
    assert.equal(patterns[0].solid, undefined);
  });

  it('reports a family before any header', () => {
    const r = parsePat('0,0,0,0,1\n*X\n0,0,0,0,1');
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /^line 1:/);
    assert.equal(r.patterns.length, 1);
  });

  it('accepts spaces inside number fields', () => {
    const r = parsePat('*S\n 4 5 , 0 , 0 , 0 , 1 . 5');
    assert.equal(r.errors.length, 0);
    assert.equal(r.patterns[0].families[0].angleDeg, 45);
    assert.equal(r.patterns[0].families[0].deltaY, 1.5);
  });
});

describe('serializePat', () => {
  it('round-trips through parsePat', () => {
    const { patterns } = parsePat(SAMPLE);
    const text = serializePat(patterns);
    const again = parsePat(text);
    assert.deepEqual(again.errors, []);
    assert.deepEqual(again.patterns, patterns);
  });

  it('round-trips the built-in library', () => {
    const lib = builtInPatterns();
    const again = parsePat(serializePat(lib));
    assert.deepEqual(again.errors, []);
    assert.deepEqual(again.patterns, lib);
  });
});

describe('library', () => {
  const lib = builtInPatterns();

  it('contains all required patterns', () => {
    const names = lib.map((p) => p.name);
    for (const n of [
      'SOLID', 'LINES45', 'CROSS', 'HORIZONTAL', 'BRICK', 'CONCRETE',
      'INSULATION', 'EARTH', 'STEEL', 'WOOD', 'GRAVEL', 'TILES',
    ]) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
  });

  it('every pattern has families except SOLID', () => {
    for (const p of lib) {
      if (p.name === 'SOLID') {
        assert.equal(p.solid, true);
        assert.equal(p.families.length, 0);
      } else {
        assert.ok(p.families.length >= 1, `${p.name} has no families`);
        for (const f of p.families) assert.ok(Math.abs(f.deltaY) > 0, `${p.name} has zero spacing`);
      }
    }
  });

  it('findPattern is case-insensitive and prefers extra patterns', () => {
    assert.equal(findPattern('brick')?.name, 'BRICK');
    assert.equal(findPattern('nope'), undefined);
    const custom = { name: 'BRICK', description: 'mine', families: [] };
    assert.equal(findPattern('Brick', [custom])?.description, 'mine');
  });

  it('returns independent copies', () => {
    const a = builtInPatterns();
    a[1].families[0].deltaY = 999;
    assert.notEqual(builtInPatterns()[1].families[0].deltaY, 999);
  });
});
