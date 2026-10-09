/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The typical cross-section (assembly) a corridor sweeps along its
 * alignment — lanes and a shoulder from the centreline outward, mirrored on
 * both sides, the pavement courses under the finished grade, and the
 * daylight slopes that tie the road into the ground — and the
 * superelevation that rotates it in curves: the outer side rises to the
 * rate the design speed and radius call for (e + f = V² / 127 R), ramping in
 * over the spiral, or over a runoff length either side of the arc's start.
 */

import type { HorizontalAlignment } from './alignment.js';

export interface AssemblyLane {
  /** Metres. */
  width: number;
  /** Cross slope, percent, measured outward from the centreline: -2.5 falls away. */
  slope: number;
}

export interface AssemblyLayer {
  name: string;
  /** Metres. */
  thickness: number;
  /** CSS hex colour. */
  color: string;
}

export interface AssemblySpec {
  /** From the centreline outward; the other side mirrors them. */
  lanes: AssemblyLane[];
  shoulder: AssemblyLane | null;
  /** Pavement courses, top first. */
  layers: AssemblyLayer[];
  /** Horizontal run per metre of height: 1.5 means 1 : 1.5. */
  daylight: { cutSlope: number; fillSlope: number };
  /** Without a terrain, the embankment is drawn down this far, metres. */
  nominalDepth?: number;
}

export interface SuperelevationDesign {
  /** km/h. */
  designSpeed: number;
  /** Percent. */
  maxSuperelevation: number;
  /** Percent, as a magnitude (2.5 means each side falls 2.5 %). */
  normalCrown: number;
  /** Maximum relative gradient between the edge and the axis, percent (0.5 by default). */
  relativeGradient?: number;
}

export interface SideSlopes {
  /** Percent, outward from the centreline, signed: positive rises. */
  left: number;
  right: number;
}

export function defaultAssembly(): AssemblySpec {
  return {
    lanes: [{ width: 3.5, slope: -2.5 }],
    shoulder: { width: 1.0, slope: -4 },
    layers: [
      { name: 'Wearing course', thickness: 0.04, color: '#3a3a3a' },
      { name: 'Binder course', thickness: 0.06, color: '#4d4d4d' },
      { name: 'Base course', thickness: 0.2, color: '#8a7f6a' },
      { name: 'Sub-base', thickness: 0.3, color: '#b8ae9c' },
    ],
    daylight: { cutSlope: 1, fillSlope: 1.5 },
    nominalDepth: 1,
  };
}

export function defaultDesign(): SuperelevationDesign {
  return { designSpeed: 50, maxSuperelevation: 7, normalCrown: 2.5, relativeGradient: 0.5 };
}

/** Side friction factor by design speed (AASHTO-style table, interpolated). */
function sideFriction(speed: number): number {
  const table: [number, number][] = [[20, 0.18], [30, 0.17], [40, 0.17], [50, 0.16], [60, 0.15], [70, 0.14], [80, 0.14], [90, 0.13], [100, 0.12], [110, 0.11], [120, 0.09], [130, 0.08]];
  if (speed <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (speed <= table[i][0]) {
      const t = (speed - table[i - 1][0]) / (table[i][0] - table[i - 1][0]);
      return table[i - 1][1] + (table[i][1] - table[i - 1][1]) * t;
    }
  }
  return table[table.length - 1][1];
}

/** The full superelevation rate a curve of `radius` needs, percent (0 … max); 0 when a normal crown suffices. */
export function requiredSuperelevation(radius: number, design: SuperelevationDesign): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  const e = (design.designSpeed ** 2 / (127 * radius) - sideFriction(design.designSpeed)) * 100;
  const clamped = Math.min(Math.max(e, 0), design.maxSuperelevation);
  return clamped <= design.normalCrown ? 0 : Math.round(clamped * 10) / 10;
}

/** Half-width the runoff is measured over: the lanes of one side. */
const rotatedWidth = (a: AssemblySpec) => a.lanes.reduce((s, l) => s + l.width, 0);

/** The slopes of a side pair at transition fraction t (0 = normal crown, 1 = full e). */
function ramp(t: number, e: number, nc: number): { outer: number; inner: number } {
  const k = Math.min(Math.max(t, 0), 1);
  const outer = -nc + (e + nc) * k;
  const tStar = (2 * nc) / (e + nc);
  const inner = k <= tStar ? -nc : -nc - (e - nc) * (k - tStar) / (1 - tStar);
  return { outer, inner };
}

/**
 * The cross slopes at a station: a normal crown on tangents, superelevated
 * through curves with linear transitions — over the spirals when the curve
 * has them, else over a runoff length placed two thirds on the tangent and
 * one third on the arc.
 */
export function slopesAt(a: HorizontalAlignment, assembly: AssemblySpec, design: SuperelevationDesign, station: number): SideSlopes {
  const nc = design.normalCrown;
  let best: SideSlopes = { left: -nc, right: -nc };
  let bestWeight = 0;
  const arcs = a.segments.filter((s) => s.kind === 'arc');
  for (const arc of arcs) {
    const e = requiredSuperelevation(arc.radius, design);
    if (e <= 0) continue;
    const spiralIn = a.segments.find((s) => s.kind === 'spiralIn' && s.pi === arc.pi);
    const spiralOut = a.segments.find((s) => s.kind === 'spiralOut' && s.pi === arc.pi);
    const runoff = (e / 100) * rotatedWidth(assembly) / ((design.relativeGradient ?? 0.5) / 100) + (nc / 100) * rotatedWidth(assembly) / ((design.relativeGradient ?? 0.5) / 100);
    const inStart = spiralIn ? spiralIn.station : arc.station - runoff * 2 / 3;
    const inEnd = spiralIn ? spiralIn.station + spiralIn.length : arc.station + runoff / 3;
    const arcEnd = arc.station + arc.length;
    const outStart = spiralOut ? spiralOut.station : arcEnd - runoff / 3;
    const outEnd = spiralOut ? spiralOut.station + spiralOut.length : arcEnd + runoff * 2 / 3;
    if (station < inStart || station > outEnd) continue;
    const t = station < inEnd ? (station - inStart) / Math.max(inEnd - inStart, 1e-9) : station <= outStart ? 1 : 1 - (station - outStart) / Math.max(outEnd - outStart, 1e-9);
    const { outer, inner } = ramp(t, e, nc);
    // Turning left: the right side is the outer one.
    const slopes: SideSlopes = arc.turn > 0 ? { left: inner, right: outer } : { left: outer, right: inner };
    const weight = Math.abs(slopes.left) + Math.abs(slopes.right);
    if (weight > bestWeight) { best = slopes; bestWeight = weight; }
  }
  return best;
}

export interface TemplatePoint {
  /** Metres from the centreline, positive right. */
  offset: number;
  /** Metres above the profile grade line. */
  dz: number;
  kind: 'centre' | 'lane' | 'shoulder';
}

/**
 * The finished-grade points of one side, from the centreline outward, at a
 * given side slope (percent): every lane takes the side's slope; the
 * shoulder keeps its own unless the side rises more steeply than it.
 */
export function templateSide(a: AssemblySpec, slope: number): TemplatePoint[] {
  const out: TemplatePoint[] = [];
  let offset = 0, dz = 0;
  for (const lane of a.lanes) {
    offset += lane.width;
    dz += lane.width * slope / 100;
    out.push({ offset, dz, kind: 'lane' });
  }
  if (a.shoulder && a.shoulder.width > 0) {
    const s = slope > Math.abs(a.shoulder.slope) ? slope : a.shoulder.slope;
    offset += a.shoulder.width;
    dz += a.shoulder.width * s / 100;
    out.push({ offset, dz, kind: 'shoulder' });
  }
  return out;
}

/** The whole finished grade, left edge to right edge, offsets negative on the left. */
export function templateAt(a: AssemblySpec, slopes: SideSlopes): TemplatePoint[] {
  const left = templateSide(a, slopes.left).map((p) => ({ ...p, offset: -p.offset })).reverse();
  return [...left, { offset: 0, dz: 0, kind: 'centre' }, ...templateSide(a, slopes.right)];
}

export const assemblyWidth = (a: AssemblySpec): number => rotatedWidth(a) + (a.shoulder?.width ?? 0);
export const pavementThickness = (a: AssemblySpec): number => a.layers.reduce((s, l) => s + l.thickness, 0);
