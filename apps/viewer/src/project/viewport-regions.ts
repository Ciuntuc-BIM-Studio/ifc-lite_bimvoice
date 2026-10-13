/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Viewport regions: named closed polylines drawn on a plan, section or
 * elevation (the VIEWPORT command) marking the part of the drawing a sheet
 * shows. A region is a drafted entity (`params.viewportRegion`), so it moves,
 * stretches and undoes like any other; it lives on the Viewports layer and
 * shows in its view, never on a sheet. Dragged from the Project Navigator
 * onto a sheet — as often as needed — it becomes a viewport clipped to the
 * polygon, centred on it at the view's scale, and follows later edits.
 */

import { useProjectStore } from './project-store';
import { freshProjectId } from './view-defaults';
import type { DraftEntity, DraftLayer, Pt } from '@/drafting/types';

export const VIEWPORT_LAYER_NAME = 'Viewports';
const VIEWPORT_LAYER: Omit<DraftLayer, 'id'> = { name: VIEWPORT_LAYER_NAME, color: '#7c3aed', visible: true, locked: false, lineType: 'dashed', lineWeight: 0.35 };

export interface ViewportRegion {
  id: string;
  viewId: string;
  name: string;
  pts: Pt[];
}

/** A drafted entity that is a viewport region. */
export function isViewportRegion(e: Pick<DraftEntity, 'params' | 'shape'>): boolean {
  return e.params.viewportRegion === true && e.shape.type === 'polyline' && e.shape.closed && e.shape.pts.length >= 3;
}

export function regionOf(e: DraftEntity): ViewportRegion | null {
  if (!isViewportRegion(e) || e.shape.type !== 'polyline') return null;
  return { id: e.id, viewId: e.viewId, name: String(e.params.viewportName ?? ''), pts: e.shape.pts };
}

/** A view's regions, in drawing order. */
export function viewportRegions(viewId: string, drafts: readonly DraftEntity[]): ViewportRegion[] {
  return drafts.filter((d) => d.viewId === viewId).flatMap((d) => regionOf(d) ?? []);
}

export function findRegion(regionId: string, drafts: readonly DraftEntity[] = useProjectStore.getState().drafts): ViewportRegion | null {
  const e = drafts.find((d) => d.id === regionId);
  return e ? regionOf(e) : null;
}

/** The project's Viewports layer, made on first use. */
export function viewportLayerId(): string {
  const s = useProjectStore.getState();
  const found = s.draftLayers.find((l) => l.name === VIEWPORT_LAYER_NAME);
  if (found) return found.id;
  const id = freshProjectId('layer');
  useProjectStore.setState({ draftLayers: [...s.draftLayers, { id, ...VIEWPORT_LAYER }], dirty: true });
  return id;
}

/** The next free default name on a view: "Viewport 1", "Viewport 2"… */
export function nextRegionName(viewId: string, base = 'Viewport'): string {
  const taken = new Set(viewportRegions(viewId, useProjectStore.getState().drafts).map((r) => r.name.toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

export function renameRegion(regionId: string, name: string): void {
  const s = useProjectStore.getState();
  useProjectStore.setState({
    drafts: s.drafts.map((d) => (d.id === regionId ? { ...d, params: { ...d.params, viewportName: name } } : d)),
    dirty: true,
  });
}

/** The polygon's bounding box, drawing metres. */
export function regionBounds(pts: readonly Pt[]): { min: Pt; max: Pt } {
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
  };
}
