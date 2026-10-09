/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Road drawings as project documents: a corridor's longitudinal profile or
 * its cross-section set, generated live from the corridor in the model
 * (`@ifc-lite/create`'s profile-drawing / section-drawing). Each is shown
 * two ways, as the user chooses:
 *
 * - as a document placed on sheets like a view (a viewport that follows
 *   the corridor): `layoutCivilDrawing` gives it in paper millimetres, with
 *   pens and DXF layers;
 * - drawn on a plan's canvas as ordinary drafted lines,
 *   polylines, hatches and text at a picked point (`drawingEntities`):
 *   static, editable like any drawing.
 */

import {
  buildCorridor, profileDrawing, sectionsDrawing, Terrain, type CivilDrawing, type CorridorSpec, type DrawPen, type DrawPrim,
} from '@ifc-lite/create';
import { resolve } from '@/i18n/registry';
import { useProjectStore } from '@/project/project-store';
import { freshProjectId } from '@/project/view-defaults';
import type { ProjectCivilDrawing } from '@/project/types';
import type { DraftEntity, DraftLayer, EntityShape, Pt } from '@/drafting/types';
import { newDraft } from '@/drafting/draft-store';
import { useViewerStore } from '@/store';
import { allCorridors, terrainTin, type CorridorRef } from './corridor-element';

export const civilDrawings = (): ProjectCivilDrawing[] => useProjectStore.getState().civilDrawings ?? [];

export function civilDrawing(id: string | null | undefined): ProjectCivilDrawing | null {
  return id ? civilDrawings().find((d) => d.id === id) ?? null : null;
}

function corridorGuid(ref: CorridorRef): string {
  const s = useViewerStore.getState();
  const fresh = s.mutationViews.get(ref.modelId)?.getNewEntity(ref.corridorId)?.attributes[0];
  return typeof fresh === 'string' ? fresh : s.models.get(ref.modelId)?.ifcDataStore?.entities.getGlobalId(ref.corridorId) ?? '';
}

/** A new road drawing of a corridor. */
export function addCivilDrawing(ref: CorridorRef, kind: ProjectCivilDrawing['kind']): string {
  const id = freshProjectId('civil');
  const d: ProjectCivilDrawing = kind === 'profile'
    ? { id, kind, name: resolve('civilDwg.newProfile', { name: ref.spec.name }), createdAt: Date.now(), corridorGlobalId: corridorGuid(ref), scale: 1000, vExaggeration: 10, stationStep: 20, elevationStep: 1 }
    : { id, kind, name: resolve('civilDwg.newSections', { name: ref.spec.name }), createdAt: Date.now(), corridorGlobalId: corridorGuid(ref), scale: 200, every: 20, columns: 3, halfWidth: 0 };
  useProjectStore.setState({ civilDrawings: [...civilDrawings(), d], dirty: true });
  return id;
}

export function duplicateCivilDrawing(id: string): string | null {
  const from = civilDrawing(id);
  if (!from) return null;
  const copy = { ...structuredClone(from), id: freshProjectId('civil'), name: `${from.name} (2)`, createdAt: Date.now() };
  useProjectStore.setState({ civilDrawings: [...civilDrawings(), copy], dirty: true });
  return copy.id;
}

export function updateCivilDrawing(id: string, patch: Partial<Omit<ProjectCivilDrawing, 'id' | 'kind' | 'createdAt'>>): void {
  useProjectStore.setState({ civilDrawings: civilDrawings().map((d) => (d.id === id ? { ...d, ...patch } : d)), dirty: true });
}

/** The corridor a drawing draws, in whichever loaded model has it. */
export function drawingCorridor(d: ProjectCivilDrawing): CorridorRef | null {
  return allCorridors().find((c) => corridorGuid(c) === d.corridorGlobalId) ?? null;
}

/** Build a drawing's geometry (drawing metres) at its own scale, or at `scale`. */
export function buildCivilDrawing(d: ProjectCivilDrawing, scale = d.scale): CivilDrawing | { error: string } {
  const ref = drawingCorridor(d);
  if (!ref) return { error: resolve('civilDwg.noCorridor') };
  const storeyId = useViewerStore.getState().models.get(ref.modelId)?.ifcDataStore?.spatialHierarchy?.elementToStorey.get(ref.corridorId) ?? null;
  const tin = storeyId === null ? null : terrainTin(ref.modelId, storeyId, ref.spec.terrainGlobalId);
  const terrain = tin ? new Terrain(tin) : null;
  try {
    const model = buildCorridor(ref.spec as CorridorSpec, terrain);
    if (d.kind === 'profile') {
      return profileDrawing(model, terrain, { scale, vExaggeration: d.vExaggeration, stationStep: d.stationStep, elevationStep: d.elevationStep }, {
        title: d.name, station: resolve('civilDwg.band.station'), ground: resolve('civilDwg.band.ground'), grade: resolve('civilDwg.band.grade'),
        cutFill: resolve('civilDwg.band.cutFill'), geometry: resolve('civilDwg.band.geometry'),
        curve: (length) => resolve('civilDwg.curve', { length }), radius: (radius) => resolve('civilDwg.radius', { radius }),
      });
    }
    return sectionsDrawing(model, terrain, { scale, every: d.every, stations: d.stations ?? [], columns: d.columns, halfWidth: d.halfWidth }, {
      areas: (cut, fill) => resolve('civilDwg.areas', { cut, fill }),
    }, ref.spec.assembly.layers);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// --- pens ----------------------------------------------------------------------

export interface PenStyle { layer: string; width: number; color: string; dashed?: boolean }

export const CIVIL_PENS: Readonly<Record<DrawPen, PenStyle>> = {
  frame: { layer: 'C-ROAD-FRAME', width: 0.35, color: '#000000' },
  grid: { layer: 'C-ROAD-GRID', width: 0.09, color: '#a1a1aa' },
  ground: { layer: 'C-ROAD-GROUND', width: 0.35, color: '#15803d' },
  grade: { layer: 'C-ROAD-DESIGN', width: 0.5, color: '#dc2626' },
  course: { layer: 'C-ROAD-COURSE', width: 0.13, color: '#000000' },
  component: { layer: 'C-ROAD-STRUCT', width: 0.25, color: '#000000' },
  daylight: { layer: 'C-ROAD-SLOPE', width: 0.25, color: '#a16207' },
  axis: { layer: 'C-ROAD-AXIS', width: 0.13, color: '#2563eb', dashed: true },
  label: { layer: 'C-ROAD-TEXT', width: 0.18, color: '#000000' },
  band: { layer: 'C-ROAD-BAND', width: 0.18, color: '#000000' },
  geometry: { layer: 'C-ROAD-GEOM', width: 0.25, color: '#000000' },
};

// --- on sheets: paper millimetres --------------------------------------------------

export type PaperPrim =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; pen: PenStyle }
  | { kind: 'path'; pts: { x: number; y: number }[]; closed: boolean; pen: PenStyle; fill?: string }
  | { kind: 'text'; x: number; y: number; text: string; size: number; anchor: 'start' | 'middle' | 'end'; rotate?: number };

export interface CivilLayout {
  width: number;
  height: number;
  prims: PaperPrim[];
}

/** A drawing in paper millimetres, its top-left at (0, 0), y down. */
export function layoutCivilDrawing(drawing: CivilDrawing, scale: number): CivilLayout {
  const k = 1000 / scale;
  const { minX, maxY, maxX, minY } = drawing.bounds;
  const X = (x: number) => (x - minX) * k, Y = (y: number) => (maxY - y) * k;
  const prims = drawing.prims.map((p): PaperPrim => {
    if (p.kind === 'line') return { kind: 'line', x1: X(p.a[0]), y1: Y(p.a[1]), x2: X(p.b[0]), y2: Y(p.b[1]), pen: CIVIL_PENS[p.pen] };
    if (p.kind === 'poly') return { kind: 'path', pts: p.pts.map((q) => ({ x: X(q[0]), y: Y(q[1]) })), closed: p.closed, pen: CIVIL_PENS[p.pen], fill: p.fill };
    return { kind: 'text', x: X(p.at[0]), y: Y(p.at[1]), text: p.text, size: p.size, anchor: p.anchor, rotate: p.rotate ? -p.rotate : undefined };
  });
  return { width: (maxX - minX) * k, height: (maxY - minY) * k, prims };
}

// --- on a plan's canvas -------------------------------------------------------

const LAYERS: readonly DraftLayer[] = [
  { id: 'civil-grid', name: 'C-ROAD-GRID', color: '#a1a1aa', visible: true, locked: false, lineWeight: 0.09 },
  { id: 'civil-ground', name: 'C-ROAD-GROUND', color: '#15803d', visible: true, locked: false, lineWeight: 0.35 },
  { id: 'civil-design', name: 'C-ROAD-DESIGN', color: '#dc2626', visible: true, locked: false, lineWeight: 0.35 },
  { id: 'civil-text', name: 'C-ROAD-TEXT', color: '#18181b', visible: true, locked: false, lineWeight: 0.18 },
];

const LAYER_OF: Readonly<Record<DrawPen, string>> = {
  frame: 'civil-text', grid: 'civil-grid', ground: 'civil-ground', grade: 'civil-design', course: 'civil-design', component: 'civil-design',
  daylight: 'civil-design', axis: 'civil-grid', label: 'civil-text', band: 'civil-text', geometry: 'civil-design',
};

/** The road layers in the project, added when missing. */
export function ensureCivilLayers(): DraftLayer[] {
  const { draftLayers } = useProjectStore.getState();
  const missing = LAYERS.filter((l) => !draftLayers.some((x) => x.id === l.id));
  if (missing.length) useProjectStore.setState({ draftLayers: [...draftLayers, ...missing], dirty: true });
  return LAYERS as DraftLayer[];
}

/**
 * The drafted entities of a drawing placed with its bottom-left at `at` on
 * view `viewId` (drawing coordinates). `orientation` −1 when the view's
 * drawing runs y-down on screen (a plan), so the drawing still reads upright.
 * Text heights are the paper sizes at the view's scale.
 */
export function drawingEntities(d: ProjectCivilDrawing, drawing: CivilDrawing, viewId: string, at: Pt, viewScale: number, orientation: 1 | -1): DraftEntity[] {
  const { minX, minY } = drawing.bounds;
  const P = (q: readonly number[]): Pt => ({ x: at.x + (q[0] - minX), y: at.y + orientation * (q[1] - minY) });
  const params = { civilDrawing: d.id };
  const out: DraftEntity[] = [];
  const add = (pen: DrawPen, shape: EntityShape) => out.push(newDraft(viewId, LAYER_OF[pen], shape, params));
  for (const p of drawing.prims as DrawPrim[]) {
    if (p.kind === 'line') add(p.pen, { type: 'line', a: P(p.a), b: P(p.b) });
    else if (p.kind === 'poly') {
      if (p.fill && p.closed) add(p.pen, { type: 'hatch', loops: [p.pts.map(P)], pattern: 'SOLID', scale: 1, angle: 0, color: p.fill });
      add(p.pen, { type: 'polyline', pts: p.pts.map(P), closed: p.closed });
    } else {
      const height = (p.size * viewScale) / 1000;
      const width = p.text.length * height * 0.6;
      const angle = ((p.rotate ?? 0) * Math.PI) / 180;
      const back = p.anchor === 'middle' ? width / 2 : p.anchor === 'end' ? width : 0;
      const base = P(p.at);
      const dir = { x: Math.cos(angle), y: orientation * Math.sin(angle) };
      add(p.pen, { type: 'text', p: { x: base.x - dir.x * back, y: base.y - dir.y * back }, text: p.text, height, rotation: orientation * angle });
    }
  }
  return out;
}
