/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import {
  PRESET_IDS, profileArea, profileFromPreset, profileIfcClass, readProfileLibrary, readStructureProfile, regenerateProfile, signedArea, starterProfiles,
  structureProfileProblem, toCustomProfile, writeProfileLibrary,
} from './structure-profile.js';

describe('structure profiles', () => {
  it('every preset builds a valid, counter-clockwise outline with clockwise holes', () => {
    for (const id of PRESET_IDS) {
      const p = profileFromPreset(id, id);
      expect(structureProfileProblem(p), id).toBeNull();
      expect(signedArea(p.outer), id).toBeGreaterThan(0);
      for (const h of p.holes) expect(signedArea(h), id).toBeLessThan(0);
      expect(profileArea(p), id).toBeGreaterThan(0);
    }
    expect(starterProfiles()).toHaveLength(PRESET_IDS.length);
  });

  it('a parameter change regenerates the outline; areas follow the textbook shapes', () => {
    const box = profileFromPreset('box-tunnel', 't');
    // (W + 2t)(H + 2s) − W·H = 11.2 × 7.1 − 10 × 5.5
    expect(profileArea(box)).toBeCloseTo(11.2 * 7.1 - 55, 9);
    const wider = regenerateProfile({ ...box, preset: { id: 'box-tunnel', params: { ...box.preset!.params, width: 12 } } });
    expect(profileArea(wider)).toBeCloseTo(13.2 * 7.1 - 66, 9);
    const wall = profileFromPreset('cantilever-wall', 'w');
    // Footing 2.2 × 0.4 + stem trapezoid (0.25 + 0.4) / 2 × 3
    expect(profileArea(wall)).toBeCloseTo(0.88 + 0.975, 9);
    expect(wall.anchors.map((a) => a.name)).toEqual(['top', 'toe', 'heel']);
    // Below the minimum, a parameter is held at it.
    const clamped = regenerateProfile({ ...wall, preset: { id: 'cantilever-wall', params: { ...wall.preset!.params, height: -5 } } });
    expect(clamped.preset!.params.height).toBe(0.3);
  });

  it('custom profiles are checked point by point', () => {
    const custom = toCustomProfile(profileFromPreset('gravity-wall', 'g'));
    expect(custom.preset).toBeUndefined();
    expect(structureProfileProblem({ ...custom, outer: [[0, 0], [1, 1], [1, 0], [0, 1]] })).toMatch(/crosses itself/);
    expect(structureProfileProblem({ ...custom, outer: [[0, 0], [1, 0]] })).toMatch(/three points/);
    expect(structureProfileProblem({ ...custom, holes: [[[5, 5], [6, 5], [6, 6]]] })).toMatch(/outside/);
    expect(structureProfileProblem({ ...custom, name: ' ' })).toMatch(/name/);
  });

  it('round-trips a library file and drops what is not a profile', () => {
    const lib = [profileFromPreset('kerb', 'k'), toCustomProfile(profileFromPreset('deck-slab', 'd'))];
    expect(readProfileLibrary(writeProfileLibrary(lib))).toEqual(lib);
    expect(readStructureProfile({ id: 'x', name: 'x', outer: [[0, 0]] })).toBeNull();
    expect(readStructureProfile({ id: 'x', name: 'x', outer: [[0, 0], [1, 0], [0, 1]], color: 'red', ifcClass: 'DROP TABLE' })).toMatchObject({ color: '#a1a1aa', ifcClass: 'IfcBuildingElementProxy', kind: 'custom' });
    expect(() => readProfileLibrary('{"format":"other"}')).toThrow(/Not a structure profile library/);
  });

  it('IFC4X3-only classes fall back in IFC4', () => {
    expect(profileIfcClass(profileFromPreset('kerb', 'k'), 'IFC4X3')).toMatchObject({ ifcClass: 'IfcKerb' });
    expect(profileIfcClass(profileFromPreset('kerb', 'k'), 'IFC4')).toMatchObject({ ifcClass: 'IfcBuildingElementProxy', objectType: 'Kerb' });
    expect(profileIfcClass(profileFromPreset('cantilever-wall', 'w'), 'IFC4')).toMatchObject({ ifcClass: 'IfcWall', predefinedType: 'USERDEFINED' });
  });
});
