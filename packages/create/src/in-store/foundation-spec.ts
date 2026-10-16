/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Foundations as Lapin builds them, and their dimensions (no model access):
 *
 * - a strip foundation: a foundation wall (the stem) on a strip footing. The
 *   stem is layered like a wall; its reinforced-concrete core carries the
 *   axis, the other layers (waterproofing, insulation, a finish) lie on
 *   either side. The footing is centred on the axis under it. The footing's
 *   underside sits `bottom` below (or above) the storey; the stem stands on
 *   the footing, `stemHeight` tall.
 * - a pad footing in steps: a stepped pyramid, steps listed from the
 *   bottom up, each centred on the footing's point.
 */

import type { MaterialAppearance } from './material-appearance.js';

type Vec3 = [number, number, number];

export interface FoundationMaterial {
  name: string;
  /** #rrggbb. */
  color?: string;
  /** Its full appearance (colour and drafting hatches) when the project defines the material. */
  appearance?: MaterialAppearance;
}

export interface FoundationLayer extends FoundationMaterial {
  /** Metres. */
  thickness: number;
  /** The structural core, which carries the axis (one layer). */
  core?: boolean;
}

export interface StripFoundationType {
  /** The project catalogue entry. */
  typeId: string;
  name: string;
  /** Through the stem, from the face right of the drawn direction to the left face. */
  layers: FoundationLayer[];
  stemHeight: number;
  footingWidth: number;
  footingHeight: number;
  /** The footing's underside, metres from the storey (negative below it). */
  bottom: number;
  /** The footing's material. */
  concrete: FoundationMaterial;
}

export interface StripFoundationSpec extends StripFoundationType {
  /** The core's axis, storey-local metres (z is ignored: the type sets the heights). */
  start: Vec3;
  end: Vec3;
  /** The footing runs on past an end by half its width (an end at a corner of a chain). */
  extendStart?: boolean;
  extendEnd?: boolean;
}

export interface PadStep {
  /** Along the footing's direction, metres. */
  length: number;
  width: number;
  height: number;
}

export interface PadFootingType {
  typeId: string;
  name: string;
  /** From the bottom up. */
  steps: PadStep[];
  /** The underside, metres from the storey. */
  bottom: number;
  concrete: FoundationMaterial;
}

export interface PadFootingSpec extends PadFootingType {
  /** The footing's centre in plan, storey-local metres (z is ignored). */
  position: Vec3;
  /** Its direction (the steps' length), radians from storey X. */
  rotation: number;
}

export const DEFAULT_CONCRETE: FoundationMaterial = { name: 'Reinforced concrete', color: '#a8a8a8' };

export const DEFAULT_STRIP_FOUNDATION: Omit<StripFoundationType, 'typeId' | 'name'> = {
  layers: [
    { name: 'Protection board', thickness: 0.02, color: '#8c8c8c' },
    { name: 'XPS insulation', thickness: 0.1, color: '#f2c46d' },
    { name: 'Waterproofing', thickness: 0.005, color: '#303030' },
    { name: 'Reinforced concrete', thickness: 0.3, color: '#a8a8a8', core: true },
  ],
  stemHeight: 1.4,
  footingWidth: 0.6,
  footingHeight: 0.4,
  bottom: -1.8,
  concrete: DEFAULT_CONCRETE,
};

export const DEFAULT_PAD_FOOTING: Omit<PadFootingType, 'typeId' | 'name'> = {
  steps: [
    { length: 1.8, width: 1.8, height: 0.5 },
    { length: 1.0, width: 1.0, height: 0.4 },
  ],
  bottom: -1.8,
  concrete: DEFAULT_CONCRETE,
};

/** The core layer: the one marked, else the thickest. */
export function coreIndex(layers: readonly FoundationLayer[]): number {
  const marked = layers.findIndex((l) => l.core);
  if (marked >= 0) return marked;
  return layers.reduce((best, l, i) => (l.thickness > layers[best].thickness ? i : best), 0);
}

/**
 * Where the stem's layers lie across its axis: its thickness, the body's
 * shift to the left of a centred wall (`WallInStoreParams.Offset`), and the
 * first layer's offset from the axis (`OffsetFromReferenceLine`), so that
 * the core is centred on the axis.
 */
export function stemSection(layers: readonly FoundationLayer[]): { thickness: number; bodyOffset: number; layerOffset: number } {
  const thickness = layers.reduce((sum, l) => sum + l.thickness, 0);
  const core = coreIndex(layers);
  const coreCentre = layers.slice(0, core).reduce((sum, l) => sum + l.thickness, 0) + layers[core].thickness / 2;
  return { thickness, bodyOffset: thickness / 2 - coreCentre, layerOffset: -coreCentre };
}

/** Problems that keep a strip foundation from being built (none: it can be). */
export function stripFoundationProblems(t: Omit<StripFoundationType, 'typeId' | 'name' | 'concrete'>): string[] {
  const out: string[] = [];
  if (!t.layers.length) out.push('the stem needs at least one layer');
  if (t.layers.some((l) => !(l.thickness > 0))) out.push('every layer needs a thickness');
  if (t.layers.filter((l) => l.core).length > 1) out.push('only one layer can be the core');
  for (const [key, v] of [['stem height', t.stemHeight], ['footing width', t.footingWidth], ['footing height', t.footingHeight]] as const) {
    if (!(v > 0)) out.push(`the ${key} must be positive`);
  }
  if (!Number.isFinite(t.bottom)) out.push('the footing level must be a number');
  return out;
}

export function padFootingProblems(t: Omit<PadFootingType, 'typeId' | 'name' | 'concrete'>): string[] {
  const out: string[] = [];
  if (!t.steps.length) out.push('a pad footing needs at least one step');
  if (t.steps.some((s) => !(s.length > 0 && s.width > 0 && s.height > 0))) out.push('every step needs a length, a width and a height');
  if (!Number.isFinite(t.bottom)) out.push('the footing level must be a number');
  return out;
}

/** A strip footing's run: its length along the axis and how far it starts before the axis start. */
export function stripFootingRun(spec: StripFoundationSpec): { length: number; before: number } {
  const axis = Math.hypot(spec.end[0] - spec.start[0], spec.end[1] - spec.start[1]);
  const before = spec.extendStart ? spec.footingWidth / 2 : 0;
  return { length: axis + before + (spec.extendEnd ? spec.footingWidth / 2 : 0), before };
}

/** A strip foundation's quantities: its run, the footing's concrete and the stem's, by layer. */
export function stripFoundationQuantities(spec: StripFoundationSpec): { length: number; footingVolume: number; stemVolume: number; coreVolume: number; footingArea: number; stemSideArea: number } {
  const axis = Math.hypot(spec.end[0] - spec.start[0], spec.end[1] - spec.start[1]);
  const run = stripFootingRun(spec);
  const { thickness } = stemSection(spec.layers);
  const core = spec.layers[coreIndex(spec.layers)];
  return {
    length: axis,
    footingVolume: run.length * spec.footingWidth * spec.footingHeight,
    footingArea: run.length * spec.footingWidth,
    stemVolume: axis * thickness * spec.stemHeight,
    coreVolume: axis * core.thickness * spec.stemHeight,
    stemSideArea: axis * spec.stemHeight,
  };
}

/** A stepped pad footing's quantities: height, footprint (the bottom step), volume and outer surface. */
export function padFootingQuantities(t: Pick<PadFootingType, 'steps'>): { height: number; length: number; width: number; footprint: number; volume: number; outerSurface: number } {
  const steps = t.steps;
  const height = steps.reduce((sum, s) => sum + s.height, 0);
  const volume = steps.reduce((sum, s) => sum + s.length * s.width * s.height, 0);
  // Sides of every step, the top of every step not covered by the next, and the top step's top.
  const sides = steps.reduce((sum, s) => sum + 2 * (s.length + s.width) * s.height, 0);
  const tops = steps.reduce((sum, s, i) => sum + s.length * s.width - (steps[i + 1] ? Math.min(steps[i + 1].length, s.length) * Math.min(steps[i + 1].width, s.width) : 0), 0);
  const base = steps[0];
  return { height, length: base?.length ?? 0, width: base?.width ?? 0, footprint: base ? base.length * base.width : 0, volume, outerSurface: sides + tops };
}
