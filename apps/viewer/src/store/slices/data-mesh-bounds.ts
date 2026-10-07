/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A model's bounds after authored meshes land in it. Load-time bounds are
 * computed once by the geometry pipeline; meshes created later (a wall drawn
 * past the model's edge, every element of a model that started empty) would
 * otherwise sit outside them, and everything that reads `shiftedBounds` —
 * section planes, the drawing generator's cut position — would not reach
 * them. The bounds only ever grow here; deleting an element keeps them.
 */

import type { CoordinateInfo, MeshData } from '@ifc-lite/geometry';

type Box = CoordinateInfo['shiftedBounds'];

/** An empty box: no extent at all (a model that started with no geometry), or not finite. */
function isEmpty(b: Box): boolean {
  const finite = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite);
  return !finite || (b.max.x <= b.min.x && b.max.y <= b.min.y && b.max.z <= b.min.z);
}

/** `info` grown to hold `meshes` (render frame), or `info` itself when they already fit. */
export function growCoordinateInfo(info: CoordinateInfo, meshes: readonly MeshData[]): CoordinateInfo {
  // A frame with no bounds or shift at all (a partial record) is left as it is.
  if (!info.shiftedBounds || !info.originShift) return info;
  const start = isEmpty(info.shiftedBounds);
  const min = start ? { x: Infinity, y: Infinity, z: Infinity } : { ...info.shiftedBounds.min };
  const max = start ? { x: -Infinity, y: -Infinity, z: -Infinity } : { ...info.shiftedBounds.max };
  let grew = false;
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < min.x) { min.x = x; grew = true; }
      if (y < min.y) { min.y = y; grew = true; }
      if (z < min.z) { min.z = z; grew = true; }
      if (x > max.x) { max.x = x; grew = true; }
      if (y > max.y) { max.y = y; grew = true; }
      if (z > max.z) { max.z = z; grew = true; }
    }
  }
  if (!grew || !Number.isFinite(min.x)) return info;
  const s = info.originShift;
  return {
    ...info,
    shiftedBounds: { min, max },
    originalBounds: { min: { x: min.x + s.x, y: min.y + s.y, z: min.z + s.z }, max: { x: max.x + s.x, y: max.y + s.y, z: max.z + s.z } },
  };
}
