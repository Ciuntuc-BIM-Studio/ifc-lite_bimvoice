/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { parseStepAttributes } from './step-attrs.js';

describe('STEP attribute text → editor values', () => {
  it('parses strings, references, nulls, enumerations, numbers, typed markers and lists', () => {
    expect(parseStepAttributes("'a''b',#12,$,.CONTINUOUS.,1.5,0.,-3,(#1,#2),(1.,(2.,3.)),IFCLENGTHMEASURE(0.),IFCBOOLEAN(.T.),'x'"))
      .toEqual(["a'b", '#12', null, '.CONTINUOUS.', { real: 1.5 }, { real: 0 }, -3, ['#1', '#2'], [{ real: 1 }, [{ real: 2 }, { real: 3 }]],
        { typed: { type: 'IfcLengthMeasure', value: 0 } }, { typed: { type: 'IfcBoolean', value: true } }, 'x']);
    expect(parseStepAttributes('')).toEqual([]);
    expect(parseStepAttributes('()')).toEqual([[]]);
    expect(parseStepAttributes('1.E-8,5.E+21')).toEqual([{ real: 1e-8 }, { real: 5e21 }]);
  });

  it('refuses malformed text', () => {
    expect(() => parseStepAttributes("'open")).toThrow(/unterminated/);
    expect(() => parseStepAttributes('(1,2')).toThrow();
    expect(() => parseStepAttributes('#1 #2')).toThrow(/trailing/);
  });
});
