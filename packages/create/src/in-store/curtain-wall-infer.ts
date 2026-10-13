/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A curtain wall placed before it kept its spec, read back from its parts
 * (Lapin's own layout, `curtain-wall.ts`): its line from its placement, the
 * grid from where its mullions and transoms stand, the sections and the
 * panel thickness from their rectangle profiles. Regenerating it with the
 * spec read makes it parametric (`curtain-wall-system.ts`).
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { fromNativeLength, type SpatialAnchor } from './anchor.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { DEFAULT_CURTAIN_WALL_TYPE, readCurtain, refId, type CurtainGridRule, type CurtainRead, type CurtainWallSpec } from './curtain-wall-system.js';

type Vec3 = [number, number, number];

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object') {
    const o = v as { real?: unknown; value?: unknown; typed?: { value?: unknown } };
    return num(o.real ?? o.value ?? o.typed?.value);
  }
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const vec = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x) ?? 0) : []);

/** A local placement's location and X direction (its relative placement only), native units. */
function placementOf(reader: AnchorEntityReader, placementRef: unknown): { at: number[]; x: number[] } | null {
  const lp = reader.entity(refId(placementRef) ?? -1);
  const axes = lp ? reader.entity(refId(lp.attributes[1]) ?? -1) : null;
  if (!axes) return null;
  const at = vec(reader.entity(refId(axes.attributes[0]) ?? -1)?.attributes[0]);
  const dir = axes.attributes[2] ? vec(reader.entity(refId(axes.attributes[2]) ?? -1)?.attributes[0]) : [1, 0, 0];
  return { at: [at[0] ?? 0, at[1] ?? 0, at[2] ?? 0], x: [dir[0] ?? 1, dir[1] ?? 0, dir[2] ?? 0] };
}

/** A part's extrusion: its depth and its rectangle profile (native units). */
function extrusionOf(reader: AnchorEntityReader, shapeRef: unknown): { depth: number; x: number; y: number } | null {
  const shape = reader.entity(refId(shapeRef) ?? -1);
  for (const repRef of Array.isArray(shape?.attributes[2]) ? shape!.attributes[2] : []) {
    const rep = reader.entity(refId(repRef) ?? -1);
    for (const itemRef of Array.isArray(rep?.attributes[3]) ? rep!.attributes[3] : []) {
      const item = reader.entity(refId(itemRef) ?? -1);
      if (item?.type.toUpperCase() !== 'IFCEXTRUDEDAREASOLID') continue;
      const profile = reader.entity(refId(item.attributes[0]) ?? -1);
      const depth = num(item.attributes[3]);
      const x = num(profile?.attributes[3]);
      const y = num(profile?.attributes[4]);
      if (depth !== null && x !== null && y !== null) return { depth, x, y };
    }
  }
  return null;
}

const evenRule = (lines: number[], extent: number): CurtainGridRule => {
  if (lines.length === 0) return { mode: 'count', count: 1 };
  const all = [0, ...lines, extent];
  const steps = all.slice(1).map((x, i) => x - all[i]);
  return steps.every((s) => Math.abs(s - steps[0]) < 1e-3) ? { mode: 'count', count: steps.length } : { mode: 'offsets', offsets: lines.map((x) => Math.round(x * 1e4) / 1e4) };
};

/**
 * A spec read back from a curtain wall's parts (Lapin's own layout: mullions
 * standing at their U lines, transoms lying at their V lines, rectangle
 * sections, panels between), or null when the parts do not read that way.
 */
export function inferCurtainWallSpec(store: IfcDataStore, anchor: Pick<SpatialAnchor, 'lengthUnitScale'>, curtainWallId: number, view?: MutablePropertyView | null): CurtainWallSpec | null {
  const current = readCurtain(store, curtainWallId, view);
  if (!current || current.parts.length === 0) return null;
  const reader = new AnchorEntityReader(store, view);
  const wall = reader.entity(curtainWallId)!;
  const m = (native: number) => fromNativeLength(anchor, native);
  const frame = placementOf(reader, wall.attributes[5]);
  if (!frame) return null;
  const kind = (p: CurtainRead['parts'][number]) => (p.tag.split(':')[0] || p.name.split(' ')[0].toLowerCase());
  const members = current.parts.map((p) => {
    const part = reader.entity(p.id);
    return { kind: kind(p), at: part ? placementOf(reader, part.attributes[5]) : null, body: part ? extrusionOf(reader, part.attributes[6]) : null };
  });
  const mullions = members.filter((p) => p.kind === 'mullion' && p.at && p.body);
  const transoms = members.filter((p) => p.kind === 'transom' && p.at && p.body);
  const panels = members.filter((p) => p.kind === 'panel' && p.at && p.body);
  if (mullions.length === 0 && panels.length === 0) return null;
  const height = m(Math.max(...[...mullions, ...panels].map((p) => (p.kind === 'mullion' ? p.body!.depth : p.at!.at[2] + p.body!.depth))));
  const mullion = mullions[0]?.body ? { width: m(mullions[0].body.x), depth: m(mullions[0].body.y) } : DEFAULT_CURTAIN_WALL_TYPE.mullion;
  const transom = transoms[0]?.body ? { width: m(transoms[0].body.x), depth: m(transoms[0].body.y) } : mullion;
  const us = [...new Set(mullions.map((p) => Math.round(m(p.at!.at[0]) * 1e5) / 1e5))].sort((a, b) => a - b);
  const panelEnd = Math.max(0, ...panels.map((p) => m(p.at!.at[0] + p.body!.x)));
  const edge = us.length > 0 && Math.abs(us[0] - mullion.width / 2) < 1e-4;
  const length = edge ? us[us.length - 1] + mullion.width / 2 : panelEnd;
  const interiorU = (edge ? us.slice(1, -1) : us).filter((u) => u > 1e-4 && u < length - 1e-4);
  const vs = [...new Set(transoms.map((p) => Math.round(m(p.at!.at[2]) * 1e5) / 1e5))].sort((a, b) => a - b);
  const interiorV = (edge ? vs.slice(1, -1) : vs).filter((v) => v > 1e-4 && v < height - 1e-4);
  const thickness = panels[0]?.body ? m(panels[0].body.y) : DEFAULT_CURTAIN_WALL_TYPE.panel.thickness;
  const dir = Math.hypot(frame.x[0], frame.x[1]) > 1e-9 ? [frame.x[0] / Math.hypot(frame.x[0], frame.x[1]), frame.x[1] / Math.hypot(frame.x[0], frame.x[1])] : [1, 0];
  const start: Vec3 = [m(frame.at[0]), m(frame.at[1]), m(frame.at[2])];
  const name = typeof wall.attributes[2] === 'string' && wall.attributes[2] ? wall.attributes[2] : 'Curtain Wall';
  return {
    ...DEFAULT_CURTAIN_WALL_TYPE,
    version: 1, name, start, end: [start[0] + dir[0] * length, start[1] + dir[1] * length, start[2]], height,
    u: evenRule(interiorU, length), v: evenRule(interiorV, height),
    mullion, transom, edge, panel: { thickness, kind: 'glass' },
  };
}

