/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { compoundAngle, setSiteGeolocationInStore } from './site-geolocation.js';
import { exportText, newStorey } from './wall-join-mesh.oracle.js';

describe('site geolocation', () => {
  it('writes an angle as degrees, minutes, seconds and millionths, each with the sign', () => {
    expect(compoundAngle(44.4268)).toEqual([44, 25, 36, 480000]);
    expect(compoundAngle(-3.70379)).toEqual([-3, -42, -13, -644000]);
    expect(compoundAngle(0)).toEqual([0, 0, 0, 0]);
  });

  it('puts the latitude, longitude and elevation on the site and true north on the model context', async () => {
    const s = await newStorey('IFC4X3');
    const written = setSiteGeolocationInStore(s.store, s.editor, { latitude: 44.4268, longitude: 26.1025, elevation: 87.35, trueNorth: [-0.2, 0.98] });
    expect(written).toHaveLength(2);
    const text = exportText(s);
    expect(text).toMatch(/IFCSITE\([^;]*\(44,25,36,480000\),\(26,6,9,0\),87\.35/);
    const context = /IFCGEOMETRICREPRESENTATIONCONTEXT\([^;]*,(#\d+)\);/.exec(text);
    expect(context).not.toBeNull();
    const north = new RegExp(`${context![1]}=IFCDIRECTION\\(\\(([^,]+),([^)]+)\\)\\)`).exec(text);
    expect(Number(north![1])).toBeCloseTo(-0.2 / Math.hypot(0.2, 0.98), 9);
    expect(Number(north![2])).toBeCloseTo(0.98 / Math.hypot(0.2, 0.98), 9);
  });
});
