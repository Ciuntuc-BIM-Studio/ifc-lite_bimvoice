/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Artifact-line filtering against the cut area ∪ the meshes' projected
 * footprint: an elevation whose plane cuts almost nothing keeps its real
 * facade lines, while a line longer than the whole model is still dropped.
 */

import { describe, it, expect } from 'vitest';
import type { MeshData } from '@ifc-lite/geometry';
import { dropOutlierProjectionLines, projectedMeshBounds } from './projection-outliers.js';
import type { DrawingLine, SectionPlaneConfig } from './types.js';

function cornersMesh(min: [number, number, number], max: [number, number, number], origin?: [number, number, number]): MeshData {
  const o = origin ?? [0, 0, 0];
  const positions = new Float32Array([
    min[0] - o[0], min[1] - o[1], min[2] - o[2],
    max[0] - o[0], max[1] - o[1], max[2] - o[2],
  ]);
  return {
    expressId: 1, ifcType: 'IfcWall', modelIndex: 0, positions,
    normals: new Float32Array(6), indices: new Uint32Array(0), color: [1, 1, 1, 1],
    ...(origin ? { origin } : {}),
  };
}

function line(length: number): DrawingLine {
  return {
    line: { start: { x: 0, y: 0 }, end: { x: length, y: 0 } },
    category: 'projection', visibility: 'visible', entityId: 1, ifcType: 'IfcWall', modelIndex: 0, depth: 1,
  } as DrawingLine;
}

const front: SectionPlaneConfig = { axis: 'z', position: 9.9, flipped: false };
const empty = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
const tiny = { min: { x: 0, y: 0 }, max: { x: 0.1, y: 0.1 } };

describe('projectedMeshBounds', () => {
  it('projects world positions (origin + local) onto the cardinal plane axes', () => {
    const mesh = cornersMesh([100, 0, 0], [140, 12, 10], [100, 0, 0]);
    expect(projectedMeshBounds([mesh], front)).toEqual({ min: { x: 100, y: 0 }, max: { x: 140, y: 12 } });
  });

  it('mirrors U on a flipped plane', () => {
    const mesh = cornersMesh([0, 0, 0], [40, 12, 10]);
    expect(projectedMeshBounds([mesh], { ...front, flipped: true })).toEqual({ min: { x: -40, y: 0 }, max: { x: -0, y: 12 } });
  });
});

describe('dropOutlierProjectionLines', () => {
  const building = [cornersMesh([0, 0, 0], [40, 12, 10])];

  it('keeps facade lines when the plane cuts only a sliver', () => {
    const kept = dropOutlierProjectionLines([line(40), line(12)], tiny, building, front);
    expect(kept).toHaveLength(2);
  });

  it('still drops a line far longer than the whole model', () => {
    const kept = dropOutlierProjectionLines([line(40), line(500)], tiny, building, front);
    expect(kept.map((l) => l.line.end.x)).toEqual([40]);
  });

  it('keeps everything when neither extent is known', () => {
    expect(dropOutlierProjectionLines([line(500)], empty, [], front)).toHaveLength(1);
  });
});
