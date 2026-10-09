/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A drawing tab's drafting view (phase 4): the view's own generated
 * drawing (`Drawing2DCanvas`, as the Drawing panel renders it), the
 * drafted entities and command previews over it, and the command line.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphicOverrideEngine, type Drawing2D } from '@ifc-lite/drawing-2d';
import { isGeometry, type DraftEntity, type DraftShape, type Pt } from '@/drafting/types';
import { drawingToWorld, type SectionAxisName } from '@/drafting/frame';
import { parsePat } from '@/drafting/hatch/pattern';
import { resolvePlanLevel } from '@/project/view-defaults';
import { viewPlaneConfig, viewWorkPlane } from '@/project/view-plane-config';
import { mergedSectionBounds } from '@/lib/section/section-distance';
import { FileDown, Layers, Maximize2, Redo2, Undo2 } from 'lucide-react';
import { openStandards } from '@/project/standards-dialog-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { IconButton } from '@/components/ui/icon-button';
import { Drawing2DCanvas } from '@/components/viewer/Drawing2DCanvas';
import { useDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import { useViewControls } from '@/hooks/useViewControls';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { EMPTY_VIEW_DRAWING, useViewDrawings } from '@/project/view-drawings';
import type { ProjectView } from '@/project/types';
import { pickModelElement, referenceSet, referencesIn } from '@/drafting/references';
import { selectFromPlan } from '@/components/viewer/plan/PlanPointer';
import { draftsOfView, redoDrafts, undoDrafts } from '@/drafting/draft-store';
import {
  attachDraftingView, currentLayerId, setElementPicker, pressEscape, runningCommand, setAnnotationProviders, setCurrentLayer, setModelPicker, setWorkPlaneProvider, submitCommandLine,
  toggleOrtho, toggleSnap, useDraftingSession, pickEntity, setDraftSelection,
} from '@/drafting/session';
import { DraftOverlay } from './DraftOverlay';
import { CommandLine } from './CommandLine';
import { useDraftingPointer } from './useDraftingPointer';
import { useDraftingKeys } from './useDraftingKeys';
import { DraftPropertiesPanel } from './DraftPropertiesPanel';
import { SelectionBar } from './SelectionBar';
import { gripsOf } from '@/drafting/grips';
import { arrangementLoops, type Segment } from '@/drafting/arrangement';
import { shapeSegments } from '@/hooks/useDraftingLines3D';
import { screenToDrawing } from '@/drafting/frame';
import { ModelCommandLayer, useModelCommandBridge } from './ModelCommandLayer';
import { OpeningSymbolsLayer } from './OpeningSymbolsLayer';
import { CutHatchLayer } from './CutHatchLayer';
import { MembraneLayer } from './MembraneLayer';
import { RoofPlanLayer } from '../roof/RoofPlanLayer';
import { exportViewDxf } from './view-dxf';
import { drawnBySymbol } from '@/project/view-symbols';
import { planOverlays } from '@/project/plan-overlays';
import { viewMaterials } from '@/project/material-resolver';
import { membraneOverlays } from '@/project/membrane-overlays';
import { partHostType } from '@/project/part-host';
import { cutHatches, hiddenClasses, DEFAULT_VIEW_PRESET, styledDrawing, viewOverrideRules } from '@/project/view-graphics';
import { capturePointer } from '@/lib/pointer-capture';
import { useCommandRuntime } from '@/lib/commands/modeling/runtime';

const AXIS_NAME = { y: 'down', z: 'front', x: 'side' } as const;
const NO_SHEET_TRANSFORM = { current: null };

export function DraftingView({ view }: { view: Exclude<ProjectView, { kind: '3d' }> }) {
  const { t } = useTranslation();
  const entry = useViewDrawings((s) => s.byView[view.id]) ?? EMPTY_VIEW_DRAWING;
  const { drawing, status } = entry;
  const showHiddenLines = useViewerStore((s) => s.drawing2DDisplayOptions.showHiddenLines);
  const allDrafts = useProjectStore((s) => s.drafts);
  const layers = useProjectStore((s) => s.draftLayers);
  const selection = useDraftingSession((s) => s.selection);
  const ortho = useDraftingSession((s) => s.ortho);
  const snap = useDraftingSession((s) => s.snap);
  useDraftingSession((s) => s.revision);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');

  const levels = useProjectStore((s) => s.levels);
  const models = useViewerStore((s) => s.models);
  const legacyGeometry = useViewerStore((s) => s.geometryResult);
  // The drawing's own plane; without a drawing (an empty project) the view's work plane.
  const fallbackPlane = useMemo(() => viewPlaneConfig(view, levels, mergedSectionBounds(models, legacyGeometry)), [view, levels, models, legacyGeometry]);
  const plane = drawing?.config.plane ?? fallbackPlane ?? undefined;
  const axis: SectionAxisName = plane ? AXIS_NAME[plane.axis] : 'down';
  const sectionPlane = useMemo(() => ({ axis, position: plane?.position ?? 0, flipped: plane?.flipped ?? false }), [axis, plane]);
  // Pinned: a regenerated drawing (an element added, edited) keeps the user's framing. No
  // automatic fit while a BIM tool is drawing — the clicks would land somewhere else.
  const bimRunning = useCommandRuntime().command !== null;
  const openedEmpty = useRef(mergedSectionBounds(models, legacyGeometry) === null).current;
  const { viewTransform, setViewTransform, fitToView } = useViewControls({
    drawing, sectionPlane, containerRef, panelVisible: !bimRunning, status, sheetEnabled: false, activeSheet: null,
    isPinned: true, cachedSheetTransformRef: NO_SHEET_TRANSFORM,
    // Opened on a model with no geometry yet: the first element drawn must not move the view under the cursor.
    initialFit: !openedEmpty,
  });

  // No drawing to fit to: start at 1 m ≈ 40 px around the origin of the work plane.
  useEffect(() => {
    if (drawing || !containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    setViewTransform((t) => (t.scale === 1 && t.x === 0 && t.y === 0 ? { scale: 40, x: width / 2, y: height / 2 } : t));
  }, [drawing, setViewTransform]);

  const references = useMemo(() => (drawing ? referenceSet(drawing, false) : null), [drawing]);
  const entities = useMemo(() => draftsOfView(view.id, allDrafts), [allDrafts, view.id]);
  const entityShapes = useMemo(() => entities.flatMap((e) => (isGeometry(e.shape) ? [e.shape] : [])), [entities]);
  // The view's own graphics (preset + category overrides), applied to its drawing.
  const graphics = view.graphics;
  const materialsTable = useProjectStore((st) => st.materials);
  const mutationVersionForMaterials = useViewerStore((st) => st.mutationVersion);
  const shown = useMemo(() => {
    void materialsTable; void mutationVersionForMaterials;
    return drawing ? styledDrawing(drawing, graphics, partHostType, view.kind === 'plan' ? drawnBySymbol : undefined, viewMaterials(drawing)) : null;
  }, [drawing, graphics, view.kind, materialsTable, mutationVersionForMaterials]);
  const overrideRules = useMemo(() => viewOverrideRules(graphics), [graphics]);
  const overrideEngine = useMemo(() => new GraphicOverrideEngine(overrideRules), [overrideRules]);
  const useIfcMaterials = (graphics?.presetId === undefined ? DEFAULT_VIEW_PRESET : graphics.presetId) === DEFAULT_VIEW_PRESET;
  const hidden = useMemo(() => hiddenClasses(graphics), [graphics]);
  const hatches = useMemo(() => (shown ? cutHatches(shown, graphics) : []), [shown, graphics]);
  const runtimeGeometry = useDrawingRuntime().geometryResult;
  const materialColors = useMemo(() => {
    const map = new Map<number, [number, number, number, number]>();
    for (const mesh of runtimeGeometry?.meshes ?? []) if (mesh.expressId && mesh.color) map.set(mesh.expressId, mesh.color);
    return map;
  }, [runtimeGeometry]);

  useEffect(() => {
    // Annotation sizes are paper sizes at the view's scale (the settings read as at 1:100).
    attachDraftingView(view.id, axis, (min, max) => (references ? referencesIn(references, min, max) : []), (view.scale ?? 100) / 100);
  }, [view.id, axis, references, view.scale]);
  // An idle click on the drawing selects the model element under it (both selection channels, as the plan view does).
  useEffect(() => {
    setModelPicker((p, tolerance, additive) => {
      const id = drawing && references ? pickModelElement(drawing, references, p, tolerance) : null;
      if (id !== null || !additive) selectFromPlan(id, additive);
    });
    return () => setModelPicker(null);
  }, [drawing, references]);
  // Commands that work on a model element (a door into a wall in elevation) ask what is under a point.
  useEffect(() => {
    setElementPicker((p) => (drawing && references ? pickModelElement(drawing, references, p, 6 / viewTransform.scale) : null));
    return () => setElementPicker(null);
  }, [drawing, references, viewTransform.scale]);
  // Hatch boundaries: drafted closed shapes and the drawing's cut outlines. Level marks: the
  // plan's level, or the point's height on a section / elevation.
  useEffect(() => {
    setAnnotationProviders(
      () => closedLoopsOf(entities, drawing),
      (p) => {
        if (view.kind === 'plan') return (resolvePlanLevel(view, levels) ?? view.level).elevation;
        return plane ? drawingToWorld(plane, p).y : 0;
      },
    );
  }, [entities, drawing, view, levels, plane]);
  useEffect(() => {
    setWorkPlaneProvider(() => viewWorkPlane(view, plane ?? null, levels), () => view);
  }, [plane, view, levels]);
  const patternText = useProjectStore((s) => s.hatchPatterns ?? '');
  const extraPatterns = useMemo(() => parsePat(patternText).patterns, [patternText]);
  const selectedModelIds = useViewerStore((s) => s.selectedEntityIds);
  const selectedModelId = useViewerStore((s) => s.selectedEntityId);
  const highlight = useMemo(() => {
    const ids = new Set(selectedModelIds);
    if (selectedModelId !== null && selectedModelId !== undefined) ids.add(selectedModelId);
    return modelHighlight(drawing, ids);
  }, [drawing, selectedModelIds, selectedModelId]);

  // The selection's grips (a handful of entities at most) and the on-canvas editing bar.
  const selected = useMemo(() => entities.filter((e) => selection.has(e.id)), [entities, selection]);
  const grips = useMemo(() => (selected.length <= 20 ? selected.flatMap((e) => gripsOf(e.id, e.shape)) : []), [selected]);
  const [editingText, setEditingText] = useState(false);
  useEffect(() => setEditingText(false), [selection]);
  const { state, handlers } = useDraftingPointer({ containerRef, transform: viewTransform, setTransform: setViewTransform, axis, entityShapes, references, grips });
  const workPlane = useMemo(() => viewWorkPlane(view, plane ?? null, levels), [view, plane, levels]);
  const bim = useModelCommandBridge({ view, plane: workPlane, transform: viewTransform, axis, containerRef });
  // A running BIM tool takes the left button; panning, zoom and the cursor stay the drafting view's.
  const pointer = {
    ...handlers,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button === 0 && bim.feed('down', e)) capturePointer(e.currentTarget as HTMLElement, e.pointerId);
      else handlers.onPointerDown(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      bim.feed('move', e);
      handlers.onPointerMove(e);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.button === 0) bim.feed('up', e);
      handlers.onPointerUp(e);
    },
  };
  const submit = () => {
    submitCommandLine(text, state.cursor);
    setText('');
  };
  useDraftingKeys({ inputRef, setText, submit: () => submitCommandLine('', state.cursor) });

  const exportDxf = () => exportViewDxf({
    view, drawing: shown, axis, drafts: entities, layers, extraPatterns,
    overlays: [...(plane ? planOverlays(view, plane, runtimeGeometry?.meshes, useProjectStore.getState().symbolFlips, hidden) : []), ...membraneOverlays(shown)],
  });

  const command = runningCommand();
  const preview = command && state.cursor && command.preview ? command.preview(state.cursor) : [];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center gap-1 h-9 px-2 border-b border-zinc-200 dark:border-zinc-800 text-xs">
        <span className="font-semibold truncate">{view.name}</span>
        <span className="flex-1" />
        <Toggle active={snap} label={t('drafting.snap')} onClick={toggleSnap} />
        <Toggle active={ortho} label={t('drafting.ortho')} onClick={toggleOrtho} />
        <select
          aria-label={t('drafting.layer')}
          className="h-6 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1"
          value={currentLayerId()}
          onChange={(e) => setCurrentLayer(e.target.value)}
        >
          {layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <IconButton label={t('standards.open')} className="size-7" onClick={() => openStandards('layers')}><Layers className="size-4" /></IconButton>
        <IconButton label={t('drafting.undo')} className="size-7" onClick={() => undoDrafts()}><Undo2 className="size-4" /></IconButton>
        <IconButton label={t('drafting.redo')} className="size-7" onClick={() => redoDrafts()}><Redo2 className="size-4" /></IconButton>
        <IconButton label={t('drafting.fit')} className="size-7" onClick={fitToView}><Maximize2 className="size-4" /></IconButton>
        <IconButton label={t('drafting.exportDxf')} className="size-7" onClick={exportDxf}><FileDown className="size-4" /></IconButton>
      </div>
      <div
        ref={containerRef}
        data-drafting-canvas
        // Always white paper, as the drawing canvas paints it: drafted ink stays visible in dark mode.
        className="relative min-h-0 flex-1 overflow-hidden bg-white cursor-none touch-none"
        {...pointer}
        onDoubleClick={(e) => {
          // Double-click an annotation: select it and edit its text in place.
          const rect = containerRef.current?.getBoundingClientRect();
          const p = screenToDrawing({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }, viewTransform, axis);
          const hit = runningCommand() ? null : pickEntity(p, 6 / viewTransform.scale);
          if (hit && !isGeometry(hit.shape)) {
            setDraftSelection(new Set([hit.id]));
            setTimeout(() => setEditingText(true), 0);
          }
        }}
      >
        {shown ? (
          <Drawing2DCanvas
            drawing={shown}
            transform={viewTransform}
            showHiddenLines={showHiddenLines}
            overrideEngine={overrideEngine}
            overridesEnabled={overrideRules.length > 0}
            entityColorMap={materialColors}
            useIfcMaterials={useIfcMaterials}
            sectionAxis={axis}
          />
        ) : null}
        <CutHatchLayer hatches={hatches} extraPatterns={extraPatterns} transform={viewTransform} axis={axis} />
        <MembraneLayer shapes={shown?.membranes} transform={viewTransform} axis={axis} />
        {status === 'generating' ? (
          <div className="absolute inset-x-0 top-2 flex justify-center pointer-events-none">
            <div className="flex items-center gap-2 rounded-md bg-background/90 px-3 py-1 text-xs shadow">
              <Spinner className="size-3.5" /> {entry.phase} {Math.round(entry.progress)}%
            </div>
          </div>
        ) : null}
        {status === 'error' && entry.error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-destructive pointer-events-none">{entry.error}</div>
        ) : null}
        <OpeningSymbolsLayer plane={view.kind === 'plan' ? plane ?? null : null} hidden={hidden} transform={viewTransform} axis={axis} />
        <RoofPlanLayer view={view} plane={view.kind === 'plan' ? plane ?? null : null} transform={viewTransform} axis={axis} />
        <DraftOverlay
          entities={entities}
          layers={layers}
          selection={selection}
          hoverId={state.hoverId}
          preview={preview}
          snap={state.snap}
          cursor={state.cursor}
          window={state.window}
          highlight={highlight}
          extraPatterns={extraPatterns}
          transform={viewTransform}
          axis={axis}
          paperUnit={(view.scale ?? 100) / 1000}
          hiddenLayers={view.hiddenLayers}
          grips={grips}
          gripDrag={state.gripDrag}
        />
        {selected.length === 1 && !state.gripDrag ? (
          <SelectionBar entity={selected[0]} transform={viewTransform} axis={axis} editing={editingText} onEditingChange={setEditingText} areaWidth={containerRef.current?.clientWidth ?? 800} />
        ) : null}
        <ModelCommandLayer map={bim.map} />
        <DraftPropertiesPanel entities={entities.filter((e) => selection.has(e.id))} layers={layers} extraPatterns={extraPatterns} />
      </div>
      <CommandLine ref={inputRef} value={text} onChange={setText} onSubmit={submit} onEscape={() => { setText(''); pressEscape(); }} />
    </div>
  );
}

const HIGHLIGHT_LIMIT = 5000;
const CIRCLE_STEPS = 64;
/** Ends closer than this (metres) count as meeting when lines enclose an area. */
const ARRANGEMENT_TOLERANCE_M = 0.001;

/** Every closed loop a hatch can fill in this view. */
function closedLoopsOf(entities: readonly DraftEntity[], drawing: Drawing2D | null): Pt[][] {
  const loops: Pt[][] = [];
  for (const e of entities) {
    const s = e.shape;
    if (s.type === 'polyline' && s.closed) loops.push(s.pts);
    else if (s.type === 'circle') loops.push(Array.from({ length: CIRCLE_STEPS }, (_, i) => ({ x: s.c.x + s.r * Math.cos((i / CIRCLE_STEPS) * Math.PI * 2), y: s.c.y + s.r * Math.sin((i / CIRCLE_STEPS) * Math.PI * 2) })));
  }
  // Whatever drafted lines, arcs and polylines enclose — end to end or crossing (BOUNDARY).
  const segments = entities.flatMap((e) => (isGeometry(e.shape) ? shapeSegments(e.shape).map(([a, b]) => [a, b] as Segment) : []));
  loops.push(...arrangementLoops(segments, ARRANGEMENT_TOLERANCE_M));
  for (const polygon of drawing?.cutPolygons ?? []) {
    loops.push(polygon.polygon.outer);
    for (const hole of polygon.polygon.holes) loops.push(hole);
  }
  return loops;
}

/** The selected model elements' cut outlines and drawn lines, for the overlay. */
function modelHighlight(drawing: Drawing2D | null, ids: ReadonlySet<number>): DraftShape[] {
  if (!drawing || ids.size === 0) return [];
  const shapes: DraftShape[] = [];
  for (const polygon of drawing.cutPolygons) {
    if (ids.has(polygon.entityId)) shapes.push({ type: 'polyline', pts: polygon.polygon.outer, closed: true });
  }
  for (const line of drawing.lines) {
    if (shapes.length >= HIGHLIGHT_LIMIT) break;
    if (ids.has(line.entityId) && line.visibility !== 'hidden') shapes.push({ type: 'line', a: line.line.start, b: line.line.end });
  }
  return shapes;
}

function Toggle({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn('h-6 rounded-sm px-2 font-medium', active ? 'bg-primary/15 text-primary' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900')}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
