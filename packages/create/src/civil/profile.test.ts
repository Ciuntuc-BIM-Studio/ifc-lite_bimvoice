/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { buildProfile, profileFromGround, profileProblem } from './profile.js';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('vertical profile', () => {
  it('grades between PVIs, a parabola through a vertical curve', () => {
    const p = buildProfile({ pvis: [{ station: 0, elevation: 100 }, { station: 200, elevation: 106, length: 100 }, { station: 400, elevation: 102 }] });
    close(p.gradeAt(50), 0.03);
    close(p.gradeAt(350), -0.02);
    close(p.elevationAt(100), 103);
    // At the PVI the curve sits (g1 - g2) L / 8 below it.
    close(p.elevationAt(200), 106 - (0.03 + 0.02) * 100 / 8);
    close(p.elevationAt(150), 104.5);
    close(p.elevationAt(250), 105);
    close(p.gradeAt(200), 0.005);
    expect(p.criticalStations()).toEqual([0, 150, 200, 250, 400]);
    // Continuous at BVC and EVC.
    close(p.elevationAt(150 - 1e-9), p.elevationAt(150 + 1e-9), 1e-6);
    close(p.elevationAt(250 - 1e-9), p.elevationAt(250 + 1e-9), 1e-6);
  });

  it('refuses overlapping curves and duplicate stations', () => {
    expect(profileProblem({ pvis: [{ station: 0, elevation: 0 }, { station: 100, elevation: 1, length: 150 }, { station: 200, elevation: 0, length: 150 }, { station: 300, elevation: 0 }] })).toMatch(/overlap/);
    expect(profileProblem({ pvis: [{ station: 0, elevation: 0 }, { station: 0, elevation: 1 }] })).toMatch(/share a station/);
    expect(profileProblem({ pvis: [{ station: 0, elevation: 0 }] })).toMatch(/at least two/);
  });

  it('follows the ground with few PVIs', () => {
    const ground = (s: number) => (s < 100 ? 10 : s < 200 ? 10 + (s - 100) * 0.05 : 15);
    const spec = profileFromGround(0, 300, ground, 10, 0.1);
    expect(spec.pvis.length).toBeGreaterThanOrEqual(4);
    expect(spec.pvis.length).toBeLessThanOrEqual(6);
    expect(profileProblem(spec)).toBeNull();
    const p = buildProfile(spec);
    close(p.elevationAt(50), 10, 0.2);
    close(p.elevationAt(250), 15, 0.2);
  });
});
