/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Sheets: paper, title block and the views placed on them as viewports.
 * All sheet geometry is paper millimetres from the top-left corner; a
 * viewport maps drawing metres to paper by its scale (1:N means 1 m is
 * 1000 / N mm).
 */

import { useProjectStore } from './project-store';
import { freshProjectId } from './view-defaults';
import type { PaperSize, ProjectSheet, SheetViewport } from './types';

export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841, h: 594 },
  A2: { w: 594, h: 420 },
  A3: { w: 420, h: 297 },
  A4: { w: 297, h: 210 },
};

export const SHEET_SCALES = [1, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000] as const;

/** Frame margin and title block size on the paper, mm. */
export const FRAME_MARGIN_MM = 10;
export const TITLE_BLOCK_MM = { w: 180, h: 50 };

export function paperOf(sheet: ProjectSheet): { w: number; h: number } {
  const base = PAPER_MM[sheet.paper ?? 'A1'];
  return (sheet.orientation ?? 'landscape') === 'landscape' ? { w: base.w, h: base.h } : { w: base.h, h: base.w };
}

/** Paper millimetres per drawing metre for a viewport. */
export function mmPerMetre(viewport: Pick<SheetViewport, 'scale'>): number {
  return 1000 / viewport.scale;
}

function patchSheet(id: string, patch: (sheet: ProjectSheet) => ProjectSheet): void {
  const state = useProjectStore.getState();
  if (!state.sheets.some((s) => s.id === id)) return;
  useProjectStore.setState({ sheets: state.sheets.map((s) => (s.id === id ? patch(s) : s)), dirty: true });
}

export function updateSheet(id: string, patch: Partial<Omit<ProjectSheet, 'id' | 'viewports'>>): void {
  patchSheet(id, (s) => ({ ...s, ...patch }));
}

export function setTitleBlockField(id: string, key: string, value: string): void {
  patchSheet(id, (s) => ({ ...s, titleBlock: { ...(s.titleBlock ?? {}), [key]: value } }));
}

/** Place a view on a sheet, centred at a paper point. Returns the viewport id. */
export function addViewport(sheetId: string, viewId: string, at: { x: number; y: number }, scale = 100): string {
  const id = freshProjectId('viewport');
  // 0 × 0: the box fits the drawing once it is generated (see `viewportBox`).
  const viewport: SheetViewport = { id, viewId, x: at.x, y: at.y, scale, width: 0, height: 0, center: null };
  patchSheet(sheetId, (s) => ({ ...s, viewports: [...(s.viewports ?? []), viewport] }));
  return id;
}

export function updateViewport(sheetId: string, viewportId: string, patch: Partial<Omit<SheetViewport, 'id' | 'viewId'>>): void {
  patchSheet(sheetId, (s) => ({ ...s, viewports: (s.viewports ?? []).map((v) => (v.id === viewportId ? { ...v, ...patch } : v)) }));
}

export function removeViewport(sheetId: string, viewportId: string): void {
  patchSheet(sheetId, (s) => ({ ...s, viewports: (s.viewports ?? []).filter((v) => v.id !== viewportId) }));
}

/** The sheets a view is placed on (a view usually sits on one sheet, as in Revit). */
export function sheetsShowing(viewId: string, sheets: readonly ProjectSheet[] = useProjectStore.getState().sheets): ProjectSheet[] {
  return sheets.filter((s) => (s.viewports ?? []).some((v) => v.viewId === viewId));
}

/** The viewport's box on the paper: its own size, or the drawing's extent when it fits automatically. */
export function viewportBox(vp: SheetViewport, bounds: { min: { x: number; y: number }; max: { x: number; y: number } } | null): { width: number; height: number } {
  if (vp.width > 0 && vp.height > 0) return { width: vp.width, height: vp.height };
  return bounds ? fitViewportBox(bounds, vp.scale) : { width: 120, height: 80 };
}

/** A viewport box that fits a drawing's extent at its scale (plus a margin), in paper mm. */
export function fitViewportBox(bounds: { min: { x: number; y: number }; max: { x: number; y: number } }, scale: number): { width: number; height: number } {
  const k = 1000 / scale;
  const margin = 10;
  return {
    width: Math.max(40, (bounds.max.x - bounds.min.x) * k + margin * 2),
    height: Math.max(30, (bounds.max.y - bounds.min.y) * k + margin * 2),
  };
}
