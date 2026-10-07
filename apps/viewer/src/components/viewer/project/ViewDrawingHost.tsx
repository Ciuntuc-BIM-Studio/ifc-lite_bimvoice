/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * One open drawing tab's own generator (phase 3b). It runs the viewer's
 * drawing pipeline (`useDrawingGeneration`, `primary: false`) on the
 * view's own plane and display overrides, and keeps the result in
 * `view-drawings.ts`, so every open view holds its drawing while other tabs
 * are in front.
 *
 * A view is independent of the 3D view's hide / isolate state, like a Revit
 * view: only the class-level visibility toggles (spaces, openings…) apply.
 * Geometry is the federated set `DrawingRuntimeHost` publishes.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { useDrawingGeneration } from '@/hooks/useDrawingGeneration';
import { useDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import { mergedSectionBounds } from '@/lib/section/section-distance';
import { useProjectStore } from '@/project/project-store';
import { sectionPlaneForView } from '@/project/view-plane';
import { dropViewDrawing, patchViewDrawing, planeKey, useViewDrawings, viewDisplayOverrides } from '@/project/view-drawings';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import type { ProjectView } from '@/project/types';

const NO_HIDDEN = new Set<number>();
const FALLBACK_PLANE = { axis: 'down' as const, position: 50, flipped: false };

export function ViewDrawingHost({ view }: { view: Exclude<ProjectView, { kind: '3d' }> }): null {
  const viewId = view.id;
  const { geometryResult } = useDrawingRuntime();
  const { ifcDataStore } = useIfc();
  const models = useViewerStore((s) => s.models);
  const legacyGeometry = useViewerStore((s) => s.geometryResult);
  const typeVisibility = useViewerStore((s) => s.typeVisibility);
  const sharedOptions = useViewerStore((s) => s.drawing2DDisplayOptions);
  const levels = useProjectStore((s) => s.levels);
  const drawing = useViewDrawings((s) => s.byView[viewId]?.drawing ?? null);

  // Resolve the view's plane against the live bounds; keyed so an identical
  // plane keeps its object identity and the generator sees no change.
  const resolved = sectionPlaneForView(view, mergedSectionBounds(models, legacyGeometry), levels);
  const key = planeKey(resolved);
  const planeRef = useRef<{ key: string; plane: typeof FALLBACK_PLANE | NonNullable<typeof resolved> }>({ key: '', plane: FALLBACK_PLANE });
  if (planeRef.current.key !== key) planeRef.current = { key, plane: resolved ?? FALLBACK_PLANE };
  const sectionPlane = planeRef.current.plane;

  const { showConstructionProjection, constructionProjectionDepth } = viewDisplayOverrides(view);
  const displayOptions = useMemo(
    () => ({ ...sharedOptions, showConstructionProjection, constructionProjectionDepth }),
    [sharedOptions, showConstructionProjection, constructionProjectionDepth],
  );

  const setDrawing = useCallback((d: Drawing2D | null) => patchViewDrawing(viewId, { drawing: d }), [viewId]);
  const setDrawingStatus = useCallback((status: 'idle' | 'generating' | 'ready' | 'error') => patchViewDrawing(viewId, { status }), [viewId]);
  const setDrawingProgress = useCallback((progress: number, phase: string) => patchViewDrawing(viewId, { progress, phase }), [viewId]);
  const setDrawingError = useCallback((error: string | null) => patchViewDrawing(viewId, { error, ...(error ? { status: 'error' as const } : {}) }), [viewId]);

  useDrawingGeneration({
    geometryResult,
    ifcDataStore,
    sectionPlane,
    displayOptions,
    typeVisibility,
    combinedHiddenIds: NO_HIDDEN,
    combinedIsolatedIds: null,
    computedIsolatedIds: null,
    models,
    // An open tab keeps its drawing current; an unresolved view (level not loaded) does not generate.
    panelVisible: resolved !== null,
    activeTool: 'select',
    drawing,
    setDrawing,
    setDrawingStatus,
    setDrawingProgress,
    setDrawingError,
    primary: false,
  });

  useEffect(() => {
    if (!key) patchViewDrawing(viewId, { status: 'error', error: 'This view cannot resolve: its level is not in the loaded models.' });
  }, [key, viewId]);
  useEffect(() => () => dropViewDrawing(viewId), [viewId]);
  return null;
}
