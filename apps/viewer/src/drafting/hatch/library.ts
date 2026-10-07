/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Built-in hatch library. All patterns are original designs, expressed in
 * millimetres as they should look printed at 1:1 on paper; the caller scales
 * them to drawing units (e.g. × sheet scale / 1000 for metre drawings).
 */

import { parsePat, type HatchPattern } from './pattern';

const BUILT_IN_PAT = `
;; ifc-lite built-in hatch patterns (millimetre units)
*SOLID, Solid fill

*LINES45, Single diagonal lines at 45 degrees
45, 0,0, 0,3

*HORIZONTAL, Horizontal lines
0, 0,0, 0,2.5

*CROSS, Diagonal cross-hatch
45, 0,0, 0,3.5
135, 0,0, 0,3.5

*TILES, Square tile grid 8 mm
0, 0,0, 0,8
90, 0,0, 0,8

*BRICK, Running-bond brick courses 8 x 4 mm
0, 0,0, 0,4
90, 0,0, 4,4, 4,-4

*STEEL, Paired diagonal lines (steel section)
45, 0,0, 0,4.2
45, -0.55,0.55, 0,4.2

*CONCRETE, Concrete speckle
50, 0,0, 2.1,5.3, 0.9,-6.7
140, 1.3,0.4, 3.7,4.9, 0.6,-5.9
15, 0.7,2.2, 4.4,6.1, 0,-4.3, 0,-7.1
95, 2.6,1.5, 3.2,5.7, 0,-5.2

*INSULATION, Batt insulation zig-zag rows
60, 0,0, -2.309401,4, 4.618802,-4.618802
120, 4.618802,0, 2.309401,4, 4.618802,-4.618802

*EARTH, Groups of short strokes (earth)
0, 0,0, 6,6, 4,-8
0, 0,0.8, 6,6, 4,-8
0, 0,1.6, 6,6, 4,-8
90, 5.2,-2.6, -6,6, 4,-8
90, 6,-2.6, -6,6, 4,-8
90, 6.8,-2.6, -6,6, 4,-8

*WOOD, Wood grain (approximated waves)
0, 0,0, 7.3,2.4, 9,-1.5
8, 0,0.9, 5.1,2.4, 4.2,-11
352, 3,1.4, 6.7,2.4, 3.6,-9.8

*GRAVEL, Gravel dots and grains
0, 0,0, 1.7,2.9, 0,-3.3
37, 0.8,1.1, 2.3,3.1, 0.5,-4.2
118, 2.1,0.4, 1.9,3.6, 0.4,-3.9
74, 1.4,2.2, 2.6,3.4, 0,-2.8
`;

let cache: HatchPattern[] | null = null;

/** The built-in patterns (fresh copies; safe to mutate). */
export function builtInPatterns(): HatchPattern[] {
  if (!cache) cache = parsePat(BUILT_IN_PAT).patterns;
  return cache.map((p) => ({
    ...p,
    families: p.families.map((f) => ({ ...f, origin: { ...f.origin }, dashes: [...f.dashes] })),
  }));
}

/** Case-insensitive lookup; `extra` (user-imported) patterns take precedence. */
export function findPattern(name: string, extra?: readonly HatchPattern[]): HatchPattern | undefined {
  const key = name.trim().toUpperCase();
  if (extra) {
    const hit = extra.find((p) => p.name.toUpperCase() === key);
    if (hit) return hit;
  }
  return builtInPatterns().find((p) => p.name === key);
}
