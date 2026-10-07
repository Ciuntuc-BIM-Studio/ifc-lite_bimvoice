/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { roofFacets, roofSolidFaces, type RoofKind } from './roof-surface.js';
import { addFacetedElementToStore, replaceFacetedGeometryInStore } from './faceted.js';

type Vec3 = [number, number, number];
const rect = (w: number, d: number): [number, number][] => [[0, 0], [w, 0], [w, d], [0, d]];

/** Closed and consistently wound: every edge used once each way. */
function closed(faces: Vec3[][]): boolean {
  const k = (p: Vec3) => p.map((v) => v.toFixed(6)).join(',');
  const edges = new Map<string, number>();
  for (const f of faces) f.forEach((p, i) => {
    const e = `${k(p)}|${k(f[(i + 1) % f.length])}`;
    edges.set(e, (edges.get(e) ?? 0) + 1);
  });
  for (const [e, n] of edges) {
    const [a, b] = e.split('|');
    if (n !== 1 || edges.get(`${b}|${a}`) !== 1) return false;
  }
  return true;
}

/** Signed volume (divergence theorem over fan triangles); positive when wound outward. */
function volume(faces: Vec3[][]): number {
  let v = 0;
  for (const f of faces) for (let i = 1; i + 1 < f.length; i++) {
    const [a, b, c] = [f[0], f[i], f[i + 1]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

describe('roof surfaces', () => {
  const slope = Math.PI / 6;
  it.each<[RoofKind, number]>([['flat', 1], ['mono', 1], ['gable', 2], ['hip', 4]])('%s: %i facets, a closed outward shell', (kind, n) => {
    const facets = roofFacets(rect(10, 6), { kind, slope });
    expect(facets).toHaveLength(n);
    const faces = roofSolidFaces(facets, 0.3);
    expect(closed(faces)).toBe(true);
    // Vertical thickness over the whole plan: 10 × 6 × 0.3.
    expect(volume(faces)).toBeCloseTo(18, 6);
  });

  it('puts the ridge at the half-width times the pitch', () => {
    const top = Math.max(...roofFacets(rect(10, 6), { kind: 'gable', slope: Math.PI / 4 }).flat().map((p) => p[2]));
    expect(top).toBeCloseTo(3, 9);
  });

  it('mono-pitches any outline from its eave edge, whichever way it is drawn', () => {
    const l = [[0, 0], [6, 0], [6, 3], [3, 5], [0, 3]] as [number, number][];
    const [facet] = roofFacets([...l].reverse(), { kind: 'mono', slope: Math.PI / 4, eaveEdge: 0 });
    expect(Math.min(...facet.map((p) => p[2]))).toBeCloseTo(0, 9);
    expect(closed(roofSolidFaces([facet], 0.2))).toBe(true);
  });

  it('collapses a hip over a square to a pyramid, and refuses gables over non-rectangles', () => {
    const facets = roofFacets(rect(4, 4), { kind: 'hip', slope: Math.PI / 4 });
    expect(facets.every((f) => f.length === 3)).toBe(true);
    expect(() => roofFacets([[0, 0], [4, 0], [2, 3]], { kind: 'gable', slope: 0.5 })).toThrow(/rectangular/);
  });
});

describe('addFacetedElementToStore', () => {
  const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);
  async function session() {
    const bytes = await readFile(SAMPLE);
    const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
    const view = new MutablePropertyView(null, 'm');
    return { store, view, editor: new StoreEditor(store, view) };
  }

  it('writes an IfcRoof with a faceted brep body, and replaces it in place', async () => {
    const { store, view, editor } = await session();
    const anchor = resolveSpatialAnchor(store, 42, view);
    const faces = roofSolidFaces(roofFacets(rect(8, 5), { kind: 'hip', slope: 0.6 }), 0.25);
    const made = addFacetedElementToStore(editor, anchor, { IfcClass: 'IfcRoof', PredefinedType: 'HIP_ROOF', Faces: faces, Location: [0, 0, 3] });
    expect(made.ifcClass).toBe('IfcRoof');
    expect(view.getNewEntity(made.elementId)?.attributes).toContain('.HIP_ROOF.');
    const kinds = view.getNewEntities().map((e) => e.type);
    expect(kinds).toContain('IfcFacetedBrep');
    expect(kinds.filter((t) => t === 'IfcFace')).toHaveLength(faces.length);
    const rep = view.getNewEntities().find((e) => e.type === 'IfcShapeRepresentation');
    expect(rep?.attributes[2]).toBe('Brep');
    replaceFacetedGeometryInStore(editor, anchor, made.elementId, { IfcClass: 'IfcRoof', Faces: roofSolidFaces(roofFacets(rect(9, 5), { kind: 'flat', slope: 0 }), 0.3), Location: [0, 0, 3] });
    expect(view.getPositionalMutationsForEntity(made.elementId)?.get(6)).not.toBe(`#${made.productShapeId}`);
    expect(view.getNewEntity(made.elementId)?.attributes[0]).toBe(made.globalId);
  });
});
