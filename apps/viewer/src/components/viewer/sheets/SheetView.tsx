/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The sheets canvas (`project/sheet-book.ts`): every sheet of the project on
 * one surface, one under the other, each its own paper size — pan with the
 * middle button or a drag on empty paper, zoom with the wheel. One sheet is
 * active (the tab's): its side panel, viewport selection and drafting; a
 * click on another sheet makes that one active. Views dropped from the
 * Project Navigator become viewports of the sheet they land on, a click
 * selects a viewport and a drag moves it, Delete removes it.
 *
 * Only sheets on screen and large enough to read are drawn in full and have
 * their views generated; the others are blank paper until reached. A sheet
 * can be hidden from the canvas (its label's button, or the navigator).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EyeOff, Maximize, Rows3 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { useProjectStore } from '@/project/project-store';
import { useViewerStore } from '@/store';
import { addViewport, regionViewport, removeViewport, updateViewport, viewportBox } from '@/project/sheets';
import { findRegion, isViewportRegion } from '@/project/viewport-regions';
import { isFace } from '@/drafting/faces';
import { bookLayout, clearLiveSheets, setLiveSheets, setSheetHidden, sheetAt, sheetsIn, useSheetBook, type PlacedSheet } from '@/project/sheet-book';
import { openSheet } from '@/project/open-view';
import { EMPTY_VIEW_DRAWING, useViewDrawings } from '@/project/view-drawings';
import { draftsOfView } from '@/drafting/draft-store';
import { parsePat } from '@/drafting/hatch/pattern';
import { capturePointer } from '@/lib/pointer-capture';
import type { ProjectSheet, SheetViewport } from '@/project/types';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { hiddenClasses, styledDrawing } from '@/project/view-graphics';
import { partHostType } from '@/project/part-host';
import { layersOfRenderId } from '@/project/model-classes-layers';
import { drawnBySymbol } from '@/project/view-symbols';
import { viewMaterials } from '@/project/material-resolver';
import { membraneOverlays } from '@/project/membrane-overlays';
import { planOverlays, type PlanOverlay } from '@/project/plan-overlays';
import { useDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import { REGION_DRAG_TYPE, VIEW_DRAG_TYPE } from '../project/ProjectTreeRow';
import { SheetPaper, type ViewportContent } from './SheetPaper';
import { SheetPanel } from './SheetPanel';
import { exportSheetSvg, printSheet } from './sheet-export';
import { exportSheetDxf } from './sheet-dxf';
import { useSheetDrafting } from './useSheetDrafting';
import { useSheetSchedules } from '../joinery/ScheduleGraphic';
import { useSheetCivilDrawings } from '../civil/CivilDrawingGraphic';
import { CommandLine } from '../drafting/CommandLine';
import { useDraftingKeys } from '../drafting/useDraftingKeys';
import { pressEscape, submitCommandLine } from '@/drafting/session';

interface Pan { x: number; y: number; k: number }

/** Below this on-screen width (px) a sheet is too small to read: blank paper, nothing generated. */
const READABLE_PX = 160;
const FIT_MARGIN_PX = 40;
const NO_SHEETS: ProjectSheet[] = [];

/** A sheet not drawn in full: its paper and number, nothing generated. */
function BlankSheet({ placed, k }: { placed: PlacedSheet; k: number }) {
  const size = Math.max(10, Math.min(placed.h * k * 0.12, 48));
  return (
    <div className="flex items-center justify-center bg-white shadow-lg text-zinc-300 font-bold select-none" style={{ width: placed.w * k, height: placed.h * k, fontSize: size }}>
      {placed.sheet.number}
    </div>
  );
}

export function SheetView({ sheet }: { sheet: ProjectSheet }) {
  const { t } = useTranslation();
  const sheets = useProjectStore((s) => s.sheets) ?? NO_SHEETS;
  const views = useProjectStore((s) => s.views);
  const drafts = useProjectStore((s) => s.drafts);
  const layers = useProjectStore((s) => s.draftLayers);
  const projectName = useProjectStore((s) => s.name);
  const patternText = useProjectStore((s) => s.hatchPatterns ?? '');
  const byView = useViewDrawings((s) => s.byView);
  const focus = useSheetBook((s) => s.focus);
  const extraPatterns = useMemo(() => parsePat(patternText).patterns, [patternText]);
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan] = useState<Pan>({ x: 20, y: 20, k: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  // A viewport selection belongs to the sheet it was made on: it shows only while that sheet is active.
  const [selection, setSelection] = useState<{ sheetId: string; viewportId: string } | null>(null);
  const selected = selection?.sheetId === sheet.id ? selection.viewportId : null;
  const select = (sheetId: string, viewportId: string | null) => setSelection(viewportId ? { sheetId, viewportId } : null);
  const drag = useRef<{ kind: 'pan' | 'move'; sx: number; sy: number; start: Pan; vp?: SheetViewport; sheetId?: string } | null>(null);

  const layout = useMemo(() => bookLayout(sheets, sheet.id), [sheets, sheet.id]);
  const active = layout.find((p) => p.sheet.id === sheet.id) ?? null;

  // The canvas size, for what is on screen and for fitting.
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback((box: { x: number; y: number; w: number; h: number }) => {
    if (!size.w || !size.h) return;
    const k = Math.max(Math.min((size.w - FIT_MARGIN_PX) / box.w, (size.h - FIT_MARGIN_PX) / box.h), 0.02);
    setPan({ k, x: (size.w - box.w * k) / 2 - box.x * k, y: (size.h - box.h * k) / 2 - box.y * k });
  }, [size.w, size.h]);
  const fitActive = useCallback(() => { if (active) fit(active); }, [active, fit]);
  const fitAll = () => {
    if (!layout.length) return;
    const last = layout[layout.length - 1];
    fit({ x: 0, y: 0, w: Math.max(...layout.map((p) => p.w)), h: last.y + last.h });
  };

  // The active sheet in view: on opening the canvas, and whenever the navigator opens one.
  const fittedFor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!size.w || fittedFor.current === focus) return;
    fittedFor.current = focus;
    fitActive();
  }, [focus, size.w, fitActive]);

  // What is on screen, and of it what is large enough to draw in full (those, and the active sheet, generate).
  const onScreen = sheetsIn(layout, { x0: -pan.x / pan.k, y0: -pan.y / pan.k, x1: (size.w - pan.x) / pan.k, y1: (size.h - pan.y) / pan.k });
  const fullIds = new Set(onScreen.filter((p) => p.w * pan.k >= READABLE_PX).map((p) => p.sheet.id));
  if (active) fullIds.add(active.sheet.id);
  const fullKey = [...fullIds].sort().join('|');
  useEffect(() => { setLiveSheets(fullKey ? fullKey.split('|') : []); }, [fullKey]);
  useEffect(() => () => clearLiveSheets(), []);

  // Each placed view as its own graphics style it: styled drawing and (plans) door / window symbols and roofs.
  const flips = useProjectStore((s) => s.symbolFlips);
  // Door and window symbols follow the catalogue and the symbol mapping.
  const joineryTypes = useProjectStore((s) => s.joineryTypes);
  const joineryMapping = useProjectStore((s) => s.joineryMapping);
  const materialsTable = useProjectStore((s) => s.materials);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const { geometryResult } = useDrawingRuntime();
  const fullViewports = useMemo(
    () => layout.filter((p) => fullKey.split('|').includes(p.sheet.id)).flatMap((p) => p.sheet.viewports ?? []),
    [layout, fullKey],
  );
  const styled = useMemo(() => {
    const out = new Map<string, { drawing: Drawing2D | null; overlays: PlanOverlay[] }>();
    for (const vp of fullViewports) {
      if (out.has(vp.viewId)) continue;
      const view = views.find((v) => v.id === vp.viewId);
      const raw = (byView[vp.viewId] ?? EMPTY_VIEW_DRAWING).drawing;
      const drawing = raw ? styledDrawing(raw, view?.graphics, partHostType, view?.kind === 'plan' ? drawnBySymbol : undefined, viewMaterials(raw, view?.kind), layersOfRenderId) : null;
      const overlays = [...(view && raw ? planOverlays(view, raw.config.plane, geometryResult?.meshes, flips, hiddenClasses(view.graphics), raw) : []), ...membraneOverlays(drawing)];
      out.set(vp.viewId, { drawing, overlays });
    }
    return out;
  }, [fullViewports, views, byView, geometryResult, flips, mutationVersion, materialsTable, joineryTypes, joineryMapping]);
  // Schedules and road drawings placed on any sheet drawn in full.
  const fullSheet = useMemo(() => ({ ...sheet, viewports: fullViewports }), [sheet, fullViewports]);
  const placedSchedules = useSheetSchedules(fullSheet);
  const placedCivil = useSheetCivilDrawings(fullSheet);
  const regionFor = useCallback((vp: SheetViewport) => {
    const region = vp.regionId ? findRegion(vp.regionId, drafts) : null;
    return region && region.viewId === vp.viewId ? { name: region.name, pts: region.pts } : undefined;
  }, [drafts]);
  const content = useCallback((vp: SheetViewport): ViewportContent => ({
    schedule: placedSchedules.get(vp.viewId),
    civil: placedCivil.get(vp.viewId),
    view: views.find((v) => v.id === vp.viewId),
    drawing: styled.get(vp.viewId)?.drawing ?? null,
    // Viewport regions mark the sheet's crop; they are never drawn on it.
    drafts: draftsOfView(vp.viewId, drafts).filter((e) => !isViewportRegion(e) && !isFace(e)),
    overlays: styled.get(vp.viewId)?.overlays,
    region: regionFor(vp),
  }), [views, styled, drafts, placedSchedules, placedCivil, regionFor]);

  /** A screen point on the canvas, millimetres. */
  const toCanvas = (clientX: number, clientY: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    return { x: (clientX - (rect?.left ?? 0) - pan.x) / pan.k, y: (clientY - (rect?.top ?? 0) - pan.y) / pan.k };
  };
  const onPaper = (p: { x: number; y: number }, placed: PlacedSheet) => ({ x: p.x - placed.x, y: p.y - placed.y });
  const boxOf = (v: SheetViewport) => {
    const placed = placedSchedules.get(v.viewId) ?? placedCivil.get(v.viewId);
    return placed ? { width: placed.width, height: placed.height } : viewportBox(regionViewport(v, regionFor(v)?.pts), byView[v.viewId]?.drawing?.bounds ?? null);
  };
  const viewportAt = (s: ProjectSheet, p: { x: number; y: number }) => [...(s.viewports ?? [])].reverse()
    .find((v) => Math.abs(p.x - v.x) <= boxOf(v).width / 2 && Math.abs(p.y - v.y) <= boxOf(v).height / 2) ?? null;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      setPan((p) => {
        const k = Math.min(Math.max(p.k * f, 0.02), 40);
        return { k, x: sx - (sx - p.x) * (k / p.k), y: sy - (sy - p.y) * (k / p.k) };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
      if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      removeViewport(sheet.id, selected);
      setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, sheet.id]);

  // Drafting on the active sheet's paper (annotations, lines), in its millimetres.
  const activePan = { x: pan.x + (active?.x ?? 0) * pan.k, y: pan.y + (active?.y ?? 0) * pan.k, k: pan.k };
  const sheetDrafting = useSheetDrafting(sheet.id, activePan, extraPatterns);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const lastPaper = useRef<{ x: number; y: number } | null>(null);
  useDraftingKeys({ inputRef, setText, submit: () => submitCommandLine('', lastPaper.current) });

  const selectedVp = (sheet.viewports ?? []).find((v) => v.id === selected) ?? null;
  return (
    <div className="flex h-full w-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={hostRef}
          data-sheet-canvas
          className={`relative min-h-0 flex-1 overflow-hidden touch-none ${sheetDrafting.drafting ? 'cursor-none' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(VIEW_DRAG_TYPE) || e.dataTransfer.types.includes(REGION_DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            // A view, or one of its viewport regions (placed as often as wanted).
            const region = findRegion(e.dataTransfer.getData(REGION_DRAG_TYPE), drafts);
            const viewId = region?.viewId ?? e.dataTransfer.getData(VIEW_DRAG_TYPE);
            const p = toCanvas(e.clientX, e.clientY);
            const placed = sheetAt(layout, p);
            if (!viewId || !placed) return;
            e.preventDefault();
            const id = addViewport(placed.sheet.id, viewId, onPaper(p, placed), views.find((v) => v.id === viewId)?.scale ?? 100, region?.id);
            if (placed.sheet.id !== sheet.id) openSheet(placed.sheet.id, false);
            select(placed.sheet.id, id);
          }}
          onPointerDown={(e) => {
            capturePointer(e.currentTarget, e.pointerId);
            const p = toCanvas(e.clientX, e.clientY);
            const placed = sheetAt(layout, p);
            if (e.button === 0 && placed && placed.sheet.id === sheet.id && sheetDrafting.down(onPaper(p, placed), e.shiftKey)) {
              setSelection(null);
              return;
            }
            const vp = e.button === 0 && placed ? viewportAt(placed.sheet, onPaper(p, placed)) : null;
            if (e.button === 0 && placed && placed.sheet.id !== sheet.id) openSheet(placed.sheet.id, false);
            if (placed) select(placed.sheet.id, vp?.id ?? null);
            else setSelection(null);
            drag.current = { kind: vp ? 'move' : 'pan', sx: e.clientX, sy: e.clientY, start: pan, vp: vp ?? undefined, sheetId: placed?.sheet.id };
          }}
          onPointerMove={(e) => {
            const p = toCanvas(e.clientX, e.clientY);
            lastPaper.current = active ? onPaper(p, active) : p;
            sheetDrafting.move(lastPaper.current);
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.sx;
            const dy = e.clientY - d.sy;
            if (d.kind === 'pan') setPan({ ...d.start, x: d.start.x + dx, y: d.start.y + dy });
            else if (d.vp && d.sheetId) updateViewport(d.sheetId, d.vp.id, { x: d.vp.x + dx / pan.k, y: d.vp.y + dy / pan.k });
          }}
          onPointerUp={() => { drag.current = null; }}
        >
          <div className="absolute left-0 top-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
            {layout.map((placed) => {
              const isActive = placed.sheet.id === sheet.id;
              return (
                <div key={placed.sheet.id} data-sheet-id={placed.sheet.id} className="absolute" style={{ left: placed.x * pan.k, top: placed.y * pan.k }}>
                  <div className="absolute bottom-full left-0 mb-1 flex items-center gap-1 whitespace-nowrap text-xs" onPointerDown={(e) => e.stopPropagation()}>
                    <span className={isActive ? 'font-semibold text-primary' : 'text-zinc-600 dark:text-zinc-400'}>
                      {t('projectNavigator.sheetLabel', { number: placed.sheet.number, name: placed.sheet.name })}
                    </span>
                    {!isActive ? (
                      <IconButton label={t('sheets.hideOnCanvas')} className="size-5" onClick={() => setSheetHidden(placed.sheet.id, true)}>
                        <EyeOff className="size-3" />
                      </IconButton>
                    ) : null}
                  </div>
                  <div className={isActive ? 'outline outline-2 outline-primary/60' : ''}>
                    {fullIds.has(placed.sheet.id) ? (
                      <SheetPaper
                        ref={isActive ? svgRef : undefined}
                        sheet={placed.sheet}
                        projectName={projectName}
                        content={content}
                        layers={layers}
                        extraPatterns={extraPatterns}
                        selectedViewportId={isActive ? selected : null}
                        pxPerMm={pan.k}
                        sheetDrafts={isActive ? sheetDrafting.entities : draftsOfView(placed.sheet.id, drafts)}
                      />
                    ) : <BlankSheet placed={placed} k={pan.k} />}
                  </div>
                </div>
              );
            })}
          </div>
          {sheetDrafting.overlay}
          <div className="absolute right-2 top-2 flex gap-1 rounded-md border border-zinc-200 bg-white/90 p-0.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90" onPointerDown={(e) => e.stopPropagation()}>
            <IconButton label={t('sheets.fitSheet')} className="size-7" onClick={fitActive}><Maximize className="size-3.5" /></IconButton>
            <IconButton label={t('sheets.fitAll')} className="size-7" onClick={fitAll}><Rows3 className="size-3.5" /></IconButton>
          </div>
        </div>
        <CommandLine ref={inputRef} value={text} onChange={setText} onSubmit={() => { submitCommandLine(text, lastPaper.current); setText(''); }} onEscape={() => { setText(''); pressEscape(); }} />
      </div>
      <SheetPanel
        sheet={sheet}
        viewport={selectedVp}
        box={selectedVp ? boxOf(selectedVp) : null}
        viewportName={views.find((v) => v.id === selectedVp?.viewId)?.name ?? ''}
        onExportSvg={() => svgRef.current && exportSheetSvg(svgRef.current, sheet)}
        onPrint={() => svgRef.current && printSheet(svgRef.current, sheet)}
        onExportDxf={() => svgRef.current && exportSheetDxf(svgRef.current, sheet)}
      />
    </div>
  );
}
