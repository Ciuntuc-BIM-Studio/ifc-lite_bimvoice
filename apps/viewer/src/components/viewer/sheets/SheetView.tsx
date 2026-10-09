/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A sheet tab: the paper (pan with the middle button or a drag on empty
 * paper, zoom with the wheel), views dropped from the Project Navigator
 * become viewports, a click selects a viewport and a drag moves it, Delete
 * removes it. The side panel edits paper, title block and viewport.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/project/project-store';
import { useViewerStore } from '@/store';
import { addViewport, paperOf, removeViewport, updateViewport, viewportBox } from '@/project/sheets';
import { EMPTY_VIEW_DRAWING, useViewDrawings } from '@/project/view-drawings';
import { draftsOfView } from '@/drafting/draft-store';
import { parsePat } from '@/drafting/hatch/pattern';
import { capturePointer } from '@/lib/pointer-capture';
import type { ProjectSheet, SheetViewport } from '@/project/types';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import type { DraftShape } from '@/drafting/types';
import { hiddenClasses, styledDrawing } from '@/project/view-graphics';
import { partHostType } from '@/project/part-host';
import { drawnBySymbol } from '@/project/view-symbols';
import { viewMaterials } from '@/project/material-resolver';
import { membraneOverlays } from '@/project/membrane-overlays';
import { planOverlays, type PlanOverlay } from '@/project/plan-overlays';
import { useDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import { VIEW_DRAG_TYPE } from '../project/ProjectTreeRow';
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

export function SheetView({ sheet }: { sheet: ProjectSheet }) {
  const views = useProjectStore((s) => s.views);
  const drafts = useProjectStore((s) => s.drafts);
  const layers = useProjectStore((s) => s.draftLayers);
  const projectName = useProjectStore((s) => s.name);
  const patternText = useProjectStore((s) => s.hatchPatterns ?? '');
  const byView = useViewDrawings((s) => s.byView);
  const extraPatterns = useMemo(() => parsePat(patternText).patterns, [patternText]);
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan] = useState<Pan>({ x: 20, y: 20, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<{ kind: 'pan' | 'move'; sx: number; sy: number; start: Pan; vp?: SheetViewport } | null>(null);
  const paper = paperOf(sheet);

  // Fit the paper into the view on open and when the paper changes.
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const k = Math.min((width - 40) / paper.w, (height - 40) / paper.h);
    setPan({ k: Math.max(k, 0.05), x: (width - paper.w * k) / 2, y: (height - paper.h * k) / 2 });
  }, [paper.w, paper.h]);

  // Each placed view as its own graphics style it: styled drawing and (plans) door / window symbols and roofs.
  const flips = useProjectStore((s) => s.symbolFlips);
  const materialsTable = useProjectStore((s) => s.materials);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const { geometryResult } = useDrawingRuntime();
  const styled = useMemo(() => {
    const out = new Map<string, { drawing: Drawing2D | null; overlays: PlanOverlay[] }>();
    for (const vp of sheet.viewports ?? []) {
      if (out.has(vp.viewId)) continue;
      const view = views.find((v) => v.id === vp.viewId);
      const raw = (byView[vp.viewId] ?? EMPTY_VIEW_DRAWING).drawing;
      const drawing = raw ? styledDrawing(raw, view?.graphics, partHostType, view?.kind === 'plan' ? drawnBySymbol : undefined, viewMaterials(raw)) : null;
      const overlays = [...(view && raw ? planOverlays(view, raw.config.plane, geometryResult?.meshes, flips, hiddenClasses(view.graphics)) : []), ...membraneOverlays(drawing)];
      out.set(vp.viewId, { drawing, overlays });
    }
    return out;
  }, [sheet.viewports, views, byView, geometryResult, flips, mutationVersion, materialsTable]);
  const placedSchedules = useSheetSchedules(sheet);
  const placedCivil = useSheetCivilDrawings(sheet);
  const content = useCallback((vp: SheetViewport): ViewportContent => ({
    schedule: placedSchedules.get(vp.viewId),
    civil: placedCivil.get(vp.viewId),
    view: views.find((v) => v.id === vp.viewId),
    drawing: styled.get(vp.viewId)?.drawing ?? null,
    drafts: draftsOfView(vp.viewId, drafts),
    overlays: styled.get(vp.viewId)?.overlays,
  }), [views, styled, drafts, placedSchedules, placedCivil]);

  const toPaper = (clientX: number, clientY: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    return { x: (clientX - (rect?.left ?? 0) - pan.x) / pan.k, y: (clientY - (rect?.top ?? 0) - pan.y) / pan.k };
  };
  const boxOf = (v: SheetViewport) => {
    const placed = placedSchedules.get(v.viewId) ?? placedCivil.get(v.viewId);
    return placed ? { width: placed.width, height: placed.height } : viewportBox(v, byView[v.viewId]?.drawing?.bounds ?? null);
  };
  const viewportAt = (p: { x: number; y: number }) => [...(sheet.viewports ?? [])].reverse()
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
        const k = Math.min(Math.max(p.k * f, 0.05), 40);
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
      setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, sheet.id]);

  // Drafting on the paper itself (annotations, lines), in millimetres.
  const sheetDrafting = useSheetDrafting(sheet.id, pan, extraPatterns);
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
            if (e.dataTransfer.types.includes(VIEW_DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            const viewId = e.dataTransfer.getData(VIEW_DRAG_TYPE);
            if (!viewId) return;
            e.preventDefault();
            const at = toPaper(e.clientX, e.clientY);
            setSelected(addViewport(sheet.id, viewId, at, views.find((v) => v.id === viewId)?.scale ?? 100));
          }}
          onPointerDown={(e) => {
            capturePointer(e.currentTarget, e.pointerId);
            const p = toPaper(e.clientX, e.clientY);
            if (e.button === 0 && sheetDrafting.down(p, e.shiftKey)) {
              setSelected(null);
              return;
            }
            const vp = e.button === 0 ? viewportAt(p) : null;
            setSelected(vp?.id ?? null);
            drag.current = { kind: vp ? 'move' : 'pan', sx: e.clientX, sy: e.clientY, start: pan, vp: vp ?? undefined };
          }}
          onPointerMove={(e) => {
            lastPaper.current = toPaper(e.clientX, e.clientY);
            sheetDrafting.move(lastPaper.current);
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.sx;
            const dy = e.clientY - d.sy;
            if (d.kind === 'pan') setPan({ ...d.start, x: d.start.x + dx, y: d.start.y + dy });
            else if (d.vp) updateViewport(sheet.id, d.vp.id, { x: d.vp.x + dx / pan.k, y: d.vp.y + dy / pan.k });
          }}
          onPointerUp={() => { drag.current = null; }}
        >
          <div className="absolute left-0 top-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
            <SheetPaper
              ref={svgRef}
              sheet={sheet}
              projectName={projectName}
              content={content}
              layers={layers}
              extraPatterns={extraPatterns}
              selectedViewportId={selected}
              pxPerMm={pan.k}
              sheetDrafts={sheetDrafting.entities}
            />
          </div>
          {sheetDrafting.overlay}
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
