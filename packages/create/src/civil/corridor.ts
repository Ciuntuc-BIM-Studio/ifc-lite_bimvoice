/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The corridor: the assembly swept along the alignment. The alignment is
 * sampled every `interval` metres and at every critical station (curve and
 * vertical-curve limits); at each station a frame — the plan point, the
 * profile grade, the tangent — places the superelevated template, and the
 * shoulder edges daylight to the terrain along the cut or fill slope.
 * Homologous points of consecutive stations are lofted into closed shells
 * (one per pavement course) and open surfaces (the cut and fill slopes);
 * the earthwork areas per station give cut and fill volumes by average end
 * area.
 */

import { buildAlignment, type HorizontalAlignment, type HorizontalAlignmentSpec } from './alignment.js';
import { buildProfile, type VerticalProfile, type VerticalProfileSpec } from './profile.js';
import { slopesAt, templateAt, type AssemblySpec, type SideSlopes, type SuperelevationDesign } from './assembly.js';
import type { Terrain, V3 } from './tin.js';
import { componentSection, suppressesDaylight, sweepComponent, type CorridorComponent, type StationFrame } from './components.js';
import { abutmentSolids, type CorridorBridge } from './bridge.js';
import type { P2, StructureProfile } from './structure-profile.js';

export type V2 = [number, number];

export interface CorridorSpec {
  name: string;
  alignment: HorizontalAlignmentSpec;
  profile: VerticalProfileSpec;
  assembly: AssemblySpec;
  design: SuperelevationDesign;
  /** Station sampling interval, metres. */
  interval: number;
  /** GlobalId of the terrain element (IfcGeographicElement) the corridor daylights to, in the same model. */
  terrainGlobalId?: string | null;
  /** The typical section (project library entry) the assembly was taken from, if any. */
  typicalSectionId?: string;
  /** Library profiles swept over station ranges: walls, tunnels, decks, barriers… */
  components?: CorridorComponent[];
  /** Bridges: a deck over a station range on two abutments with strip footings. */
  bridges?: CorridorBridge[];
}

export type DaylightKind = 'cut' | 'fill' | 'none';

export interface CorridorStation {
  station: number;
  origin: V3;
  /** Radians CCW from +X. */
  direction: number;
  slopes: SideSlopes;
  /** Finished grade, left edge → right edge, world (storey-local) metres. */
  top: V3[];
  daylightLeft: V3 | null;
  daylightRight: V3 | null;
  kindLeft: DaylightKind;
  kindRight: DaylightKind;
  /** Earthwork areas at this station, m². */
  cutArea: number;
  fillArea: number;
}

export interface CorridorSolid {
  /** Stable part key: course:<i>, cut, fill, comp:<id>. */
  key: string;
  name: string;
  color: string;
  kind: 'course' | 'cut' | 'fill' | 'component';
  /** A component's IFC class (its profile's). */
  ifc?: Pick<StructureProfile, 'ifcClass' | 'predefinedType' | 'objectType'>;
  points: V3[];
  triangles: [number, number, number][];
  closed: boolean;
}

export interface CorridorModel {
  alignment: HorizontalAlignment;
  profile: VerticalProfile;
  stations: CorridorStation[];
  solids: CorridorSolid[];
  centreline: V3[];
  /** The finished-grade edges and the daylight lines, for plan drawing. */
  edges: { left: V3[]; right: V3[]; daylightLeft: V3[]; daylightRight: V3[] };
  /** Cut and fill, m³. */
  volumes: { cut: number; fill: number };
  /** The corridor's section at any station (finished grade, daylight, earthwork areas). */
  sectionAt(station: number): CorridorStation;
  /** The components cut by the section at a station: loops in (offset across from the axis, elevation). */
  componentsAt(station: number): { id: string; name: string; color: string; loops: P2[][] }[];
}

const DAYLIGHT_RUN = 150;

/** Ear clipping of a simple polygon (any orientation); indices into `pts`. */
export function triangulatePolygon(pts: readonly V2[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  const area = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * p[1], 0);
  const idx = pts.map((_, i) => i);
  if (area < 0) idx.reverse();
  const cross = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: V2, a: V2, b: V2, c: V2) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  const out: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) <= 1e-12) continue;
      if (idx.some((k) => k !== ia && k !== ib && k !== ic && inside(pts[k], a, b, c))) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

function stationsOf(a: HorizontalAlignment, p: VerticalProfile, interval: number): number[] {
  const set = new Set<number>([a.startStation, a.endStation]);
  for (const s of a.criticalStations()) set.add(s);
  for (const s of p.criticalStations()) if (s > a.startStation && s < a.endStation) set.add(s);
  const step = Math.max(interval, 0.5);
  for (let s = a.startStation + step; s < a.endStation; s += step) set.add(Math.round(s * 1000) / 1000);
  const sorted = [...set].sort((x, y) => x - y);
  // Nothing closer than a centimetre: lofting degenerates otherwise.
  return sorted.filter((s, i) => i === 0 || s - sorted[i - 1] > 0.01 || i === sorted.length - 1);
}

/** Signed area between the ground and a design line, sampled across the section: + cut (ground above), − fill. */
function earthworkAreas(line: { o: number; z: number; x: number; y: number }[], terrain: Terrain): { cut: number; fill: number } {
  let cut = 0, fill = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const run = b.o - a.o;
    if (run <= 1e-9) continue;
    const n = Math.max(2, Math.ceil(run / 0.25));
    let prev: number | null = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const z = terrain.elevationAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      const d = z === null ? null : z - (a.z + (b.z - a.z) * t);
      if (prev !== null && d !== null) {
        const w = run / n;
        // Trapezoid, split where the sign changes.
        if ((prev >= 0) === (d >= 0)) { const area = (prev + d) / 2 * w; if (area >= 0) cut += area; else fill -= area; }
        else { const t0 = prev / (prev - d); cut += Math.abs(prev) * t0 * w / 2 * (prev > 0 ? 1 : 0) + Math.abs(d) * (1 - t0) * w / 2 * (d > 0 ? 1 : 0); fill += Math.abs(prev) * t0 * w / 2 * (prev < 0 ? 1 : 0) + Math.abs(d) * (1 - t0) * w / 2 * (d < 0 ? 1 : 0); }
      }
      prev = d;
    }
  }
  return { cut, fill };
}

export function buildCorridor(spec: CorridorSpec, terrain: Terrain | null): CorridorModel {
  const alignment = buildAlignment(spec.alignment);
  const profile = buildProfile(spec.profile);
  const a = spec.assembly;
  const depth = a.layers.reduce((s, l) => s + l.thickness, 0);
  // A bridge's deck sweeps like a centred component that takes the earthworks away.
  const decks = (spec.bridges ?? []).map((b): CorridorComponent => ({
    id: `bridge:${b.id}:deck`, profileId: b.deck.profileId, profile: { ...b.deck.profile, name: `${b.name} — deck` }, side: 'centre', attach: 'axis',
    offset: b.deck.offset, from: b.from, to: b.to, daylight: 'both',
  }));
  const components = [...(spec.components ?? []), ...decks];
  const section = (station: number): CorridorStation => {
    const at = alignment.pointAt(station);
    const z = profile.elevationAt(station);
    const right: V2 = [Math.sin(at.direction), -Math.cos(at.direction)];
    const slopes = slopesAt(alignment, a, spec.design, station);
    const template = templateAt(a, slopes);
    const place = (offset: number, dz: number): V3 => [at.x + right[0] * offset, at.y + right[1] * offset, z + dz];
    const top = template.map((p) => place(p.offset, p.dz));
    const edgeL = top[0], edgeR = top[top.length - 1];
    const daylight = (edge: V3, side: 1 | -1): { p: V3 | null; kind: DaylightKind } => {
      if (components.some((c) => suppressesDaylight(c, station, side < 0 ? 'left' : 'right'))) return { p: null, kind: 'none' };
      if (!terrain) {
        const run = (a.nominalDepth ?? 1) * a.daylight.fillSlope;
        return { p: [edge[0] + right[0] * side * run, edge[1] + right[1] * side * run, edge[2] - (a.nominalDepth ?? 1)], kind: 'none' };
      }
      const ground = terrain.elevationAt(edge[0], edge[1]);
      if (ground === null) return { p: null, kind: 'none' };
      const cut = ground > edge[2];
      const slope = cut ? a.daylight.cutSlope : a.daylight.fillSlope;
      const dir: V3 = [right[0] * side * slope, right[1] * side * slope, cut ? 1 : -1];
      const hit = terrain.hit(edge, dir, DAYLIGHT_RUN);
      return { p: hit, kind: hit ? (cut ? 'cut' : 'fill') : 'none' };
    };
    const dl = daylight(edgeL, -1), dr = daylight(edgeR, 1);
    let cutArea = 0, fillArea = 0;
    // Under a bridge deck (or through a tunnel) there are no earthworks.
    const noEarthworks = components.some((c) => c.daylight === 'both' && station >= Math.min(c.from, c.to) - 1e-9 && station <= Math.max(c.from, c.to) + 1e-9);
    if (terrain && !noEarthworks) {
      // The earthwork design line: daylight → top edge → subgrade across → top edge → daylight.
      const o = (p: V3) => (p[0] - at.x) * right[0] + (p[1] - at.y) * right[1];
      const line = [
        ...(dl.p ? [{ o: o(dl.p), z: dl.p[2], x: dl.p[0], y: dl.p[1] }] : []),
        { o: o(edgeL), z: edgeL[2], x: edgeL[0], y: edgeL[1] },
        ...template.map((p, i) => ({ o: p.offset, z: top[i][2] - depth, x: top[i][0], y: top[i][1] })),
        { o: o(edgeR), z: edgeR[2], x: edgeR[0], y: edgeR[1] },
        ...(dr.p ? [{ o: o(dr.p), z: dr.p[2], x: dr.p[0], y: dr.p[1] }] : []),
      ];
      ({ cut: cutArea, fill: fillArea } = earthworkAreas(line, terrain));
    }
    return { station, origin: [at.x, at.y, z], direction: at.direction, slopes, top, daylightLeft: dl.p, daylightRight: dr.p, kindLeft: dl.kind, kindRight: dr.kind, cutArea, fillArea };
  };
  const stations = stationsOf(alignment, profile, spec.interval).map(section);

  const solids: CorridorSolid[] = [];
  const m = stations[0]?.top.length ?? 0;
  let above = 0;
  a.layers.forEach((layer, li) => {
    const below = above + layer.thickness;
    const ring = (st: CorridorStation): V3[] => [
      ...st.top.map((p): V3 => [p[0], p[1], p[2] - above]),
      ...[...st.top].reverse().map((p): V3 => [p[0], p[1], p[2] - below]),
    ];
    const points: V3[] = [];
    const triangles: [number, number, number][] = [];
    const n = 2 * m;
    stations.forEach((st) => points.push(...ring(st)));
    for (let i = 0; i + 1 < stations.length; i++) {
      for (let j = 0; j < n; j++) {
        const a0 = i * n + j, a1 = i * n + (j + 1) % n, b0 = (i + 1) * n + j, b1 = (i + 1) * n + (j + 1) % n;
        triangles.push([a0, b0, b1], [a0, b1, a1]);
      }
    }
    // End caps, in the section plane (offset, height).
    const cap = (i: number, flip: boolean) => {
      const st = stations[i];
      const right: V2 = [Math.sin(st.direction), -Math.cos(st.direction)];
      const local = ring(st).map((p): V2 => [(p[0] - st.origin[0]) * right[0] + (p[1] - st.origin[1]) * right[1], p[2]]);
      for (const [x, y, z] of triangulatePolygon(local)) triangles.push(flip ? [i * n + x, i * n + z, i * n + y] : [i * n + x, i * n + y, i * n + z]);
    };
    if (stations.length > 1) { cap(0, true); cap(stations.length - 1, false); }
    solids.push({ key: `course:${li}`, name: layer.name, color: layer.color, kind: 'course', points, triangles, closed: true });
    above = below;
  });

  // Daylight strips, by kind.
  const strips: Record<'cut' | 'fill', { points: V3[]; triangles: [number, number, number][] }> = { cut: { points: [], triangles: [] }, fill: { points: [], triangles: [] } };
  const addQuad = (kind: 'cut' | 'fill', q: [V3, V3, V3, V3]) => {
    const s = strips[kind];
    const base = s.points.length;
    s.points.push(...q);
    s.triangles.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
  };
  for (let i = 0; i + 1 < stations.length; i++) {
    const s0 = stations[i], s1 = stations[i + 1];
    for (const side of ['left', 'right'] as const) {
      const d0 = side === 'left' ? s0.daylightLeft : s0.daylightRight, d1 = side === 'left' ? s1.daylightLeft : s1.daylightRight;
      const k0 = side === 'left' ? s0.kindLeft : s0.kindRight, k1 = side === 'left' ? s1.kindLeft : s1.kindRight;
      const e0 = side === 'left' ? s0.top[0] : s0.top[m - 1], e1 = side === 'left' ? s1.top[0] : s1.top[m - 1];
      if (!d0 || !d1) continue;
      const kind = k0 !== 'none' ? k0 : k1 !== 'none' ? k1 : 'fill';
      addQuad(kind, side === 'left' ? [e0, d0, d1, e1] : [e0, e1, d1, d0]);
    }
  }
  for (const kind of ['cut', 'fill'] as const) {
    if (strips[kind].triangles.length) solids.push({ key: kind, name: kind === 'cut' ? 'Cut slopes' : 'Fill slopes', color: kind === 'cut' ? '#a0783c' : '#6b8e23', kind, ...strips[kind], closed: false });
  }

  const frame = (c: CorridorComponent, st: CorridorStation): StationFrame => {
    const right: [number, number] = [Math.sin(st.direction), -Math.cos(st.direction)];
    const across: [number, number] = c.side === 'left' ? [-right[0], -right[1]] : right;
    const origin = c.attach === 'axis' || c.side === 'centre' ? st.origin : c.side === 'left' ? st.top[0] : st.top[st.top.length - 1];
    return { station: st.station, origin, across };
  };
  const framesOf = (c: CorridorComponent): StationFrame[] => {
    const lo = Math.max(Math.min(c.from, c.to), alignment.startStation), hi = Math.min(Math.max(c.from, c.to), alignment.endStation);
    if (hi - lo < 0.01) return [];
    const inner = stations.filter((st) => st.station > lo + 0.01 && st.station < hi - 0.01);
    return [section(lo), ...inner, section(hi)].map((st) => frame(c, st));
  };
  for (const c of components) {
    const swept = sweepComponent(c, framesOf(c), terrain);
    if (!swept) continue;
    solids.push({ key: `comp:${c.id}`, name: c.profile.name, color: c.profile.color, kind: 'component', ifc: { ifcClass: c.profile.ifcClass, predefinedType: c.profile.predefinedType, objectType: c.profile.objectType }, ...swept, closed: true });
  }

  for (const b of spec.bridges ?? []) {
    const { start, end } = abutmentSolids(b, alignment, profile, terrain);
    const wall = { ifcClass: 'IfcWall', predefinedType: 'USERDEFINED', objectType: 'Abutment' };
    const strip = { ifcClass: 'IfcFooting', predefinedType: 'STRIP_FOOTING', objectType: 'Abutment footing' };
    for (const [end_, a] of [['start', start], ['end', end]] as const) {
      solids.push({ key: `bridge:${b.id}:${end_}`, name: `${b.name} — ${end_} abutment`, color: '#a8a29e', kind: 'component', ifc: wall, ...a.body, closed: true });
      solids.push({ key: `bridge:${b.id}:${end_}-footing`, name: `${b.name} — ${end_} footing`, color: '#78716c', kind: 'component', ifc: strip, ...a.footing, closed: true });
    }
  }

  let cut = 0, fill = 0;
  for (let i = 0; i + 1 < stations.length; i++) {
    const ds = stations[i + 1].station - stations[i].station;
    cut += (stations[i].cutArea + stations[i + 1].cutArea) / 2 * ds;
    fill += (stations[i].fillArea + stations[i + 1].fillArea) / 2 * ds;
  }
  return {
    alignment, profile, stations, solids,
    centreline: stations.map((s) => s.origin),
    edges: {
      left: stations.map((s) => s.top[0]), right: stations.map((s) => s.top[m - 1]),
      daylightLeft: stations.flatMap((s) => (s.daylightLeft ? [s.daylightLeft] : [])), daylightRight: stations.flatMap((s) => (s.daylightRight ? [s.daylightRight] : [])),
    },
    volumes: { cut, fill },
    sectionAt: (station: number) => section(Math.min(Math.max(station, alignment.startStation), alignment.endStation)),
    componentsAt: (station: number) => {
      const st = section(Math.min(Math.max(station, alignment.startStation), alignment.endStation));
      const right: [number, number] = [Math.sin(st.direction), -Math.cos(st.direction)];
      return components
        .filter((c) => station >= Math.min(c.from, c.to) - 1e-9 && station <= Math.max(c.from, c.to) + 1e-9)
        .map((c) => ({ id: c.id, name: c.profile.name, color: c.profile.color, loops: componentSection(c, frame(c, st), st.origin, right, terrain) }));
    },
  };
}

/** The finished-grade surface as a TIN (points and triangles), for export. */
export function finishedGradeSurface(model: CorridorModel): { points: V3[]; triangles: [number, number, number][] } {
  const points: V3[] = [];
  const triangles: [number, number, number][] = [];
  const m = model.stations[0]?.top.length ?? 0;
  for (const st of model.stations) points.push(...st.top);
  for (let i = 0; i + 1 < model.stations.length; i++) {
    for (let j = 0; j + 1 < m; j++) {
      const a0 = i * m + j, a1 = a0 + 1, b0 = (i + 1) * m + j, b1 = b0 + 1;
      triangles.push([a0, b1, b0], [a0, a1, b1]);
    }
  }
  return { points, triangles };
}
