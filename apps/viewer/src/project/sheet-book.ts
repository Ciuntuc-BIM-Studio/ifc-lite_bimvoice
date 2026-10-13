/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The sheets canvas: every sheet of the project on one surface, one under
 * the other, left-aligned, in sheet-number order — a document whose pages
 * have different sizes. Each keeps its own paper, title block and
 * viewports; one is active (the one being edited, the sheet tab's).
 *
 * Generating a view's drawing is the expensive part, so only the sheets on
 * screen ask for theirs, and the last few seen keep theirs so scrolling back
 * costs nothing (`useSheetBook.live`, read by the document workspace); the
 * rest show as blank paper until scrolled to. A hidden sheet
 * (`ProjectSheet.hidden`) is left off the canvas altogether.
 */

import { create } from 'zustand';
import { useProjectStore } from './project-store';
import { paperOf } from './sheets';
import type { ProjectSheet } from './types';

/** Space between two sheets on the canvas, paper millimetres. */
export const SHEET_GAP_MM = 60;

export interface PlacedSheet {
  sheet: ProjectSheet;
  /** Top-left corner on the canvas, mm. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const byNumber = (a: ProjectSheet, b: ProjectSheet) => a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: 'base' });

/** The sheets on the canvas and where: hidden ones left out (except `keep`, the active one). */
export function bookLayout(sheets: readonly ProjectSheet[], keep: string | null = null): PlacedSheet[] {
  let y = 0;
  return [...sheets].filter((s) => !s.hidden || s.id === keep).sort(byNumber).map((sheet) => {
    const { w, h } = paperOf(sheet);
    const placed = { sheet, x: 0, y, w, h };
    y += h + SHEET_GAP_MM;
    return placed;
  });
}

/** The placed sheet under a canvas point. */
export function sheetAt(layout: readonly PlacedSheet[], p: { x: number; y: number }): PlacedSheet | null {
  return layout.find((s) => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) ?? null;
}

/** The sheets a canvas rectangle (mm) reaches. */
export function sheetsIn(layout: readonly PlacedSheet[], rect: { x0: number; y0: number; x1: number; y1: number }): PlacedSheet[] {
  return layout.filter((s) => s.x < rect.x1 && s.x + s.w > rect.x0 && s.y < rect.y1 && s.y + s.h > rect.y0);
}

/** How many sheets keep their views' drawings once scrolled away. */
export const KEPT_SHEETS = 8;

interface SheetBookState {
  /** Sheets whose views' drawings are generated and kept: those on screen, then the most recently seen. */
  live: string[];
  /** Bumped to bring the active sheet into view (opened from the navigator). */
  focus: number;
}

export const useSheetBook = create<SheetBookState>()(() => ({ live: [], focus: 0 }));

/** The sheets on screen now: they go first, the rest of the kept ones after, up to `KEPT_SHEETS` (or all on screen). */
export function setLiveSheets(onScreen: readonly string[]): void {
  const current = useSheetBook.getState().live;
  const next = [...new Set([...onScreen, ...current])].slice(0, Math.max(KEPT_SHEETS, onScreen.length));
  // Order does not matter to the workspace; only a change of membership is worth a render.
  if (next.length === current.length && next.every((id) => current.includes(id))) return;
  useSheetBook.setState({ live: next });
}

/** The sheets canvas closed: nothing is kept. */
export function clearLiveSheets(): void {
  if (useSheetBook.getState().live.length) useSheetBook.setState({ live: [] });
}

export function requestSheetFocus(): void {
  useSheetBook.setState((s) => ({ focus: s.focus + 1 }));
}

export function setSheetHidden(id: string, hidden: boolean): void {
  const s = useProjectStore.getState();
  useProjectStore.setState({
    sheets: s.sheets.map((sheet) => {
      if (sheet.id !== id) return sheet;
      const { hidden: _was, ...rest } = sheet;
      return hidden ? { ...rest, hidden: true } : rest;
    }),
    dirty: true,
  });
}
