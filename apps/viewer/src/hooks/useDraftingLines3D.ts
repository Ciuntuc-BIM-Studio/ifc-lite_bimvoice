/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lines drafted on project views, shown in 3D on their view planes (the
 * `drafting` line-overlay channel): a line drawn on a floor plan lies on
 * that level's work plane, one drawn on a section stands in the section's
 * plane. The lifting is `drafting/frame.ts`'s `drawingToWorld`, the exact
 * inverse of the drawing's projection, so 2D and 3D always agree.
 */

import { useEffect, type RefObject } from 'react';
import type { Renderer } from '@ifc-lite/renderer';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { useViewDrawings } from '@/project/view-drawings';
import { viewPlaneConfig } from '@/project/view-plane-config';
import { mergedSectionBounds } from '@/lib/section/section-distance';
import { anchorWorldLineVertices } from '@/lib/renderer/line-overlay-rte';
import { drawingToWorld } from '@/drafting/frame';
import { entitySkeleton } from '@/drafting/annotation';
import type { DraftEntity, DraftShape, Pt } from '@/drafting/types';

const ARC_STEP = Math.PI / 32;

/** A shape as 2D segments (arcs and circles sampled). */
export function shapeSegments(shape: DraftShape): [Pt, Pt][] {
  const pairs: [Pt, Pt][] = [];
  const chain = (pts: Pt[], closed: boolean) => {
    for (let i = 1; i < pts.length; i++) pairs.push([pts[i - 1], pts[i]]);
    if (closed && pts.length > 2) pairs.push([pts[pts.length - 1], pts[0]]);
  };
  switch (shape.type) {
    case 'line':
      pairs.push([shape.a, shape.b]);
      break;
    case 'polyline':
      chain(shape.pts, shape.closed);
      break;
    default: {
      const full = shape.type === 'circle';
      let sweep = full ? Math.PI * 2 : shape.end - shape.start;
      while (sweep <= 0) sweep += Math.PI * 2;
      const start = full ? 0 : shape.start;
      const steps = Math.max(4, Math.ceil(sweep / ARC_STEP));
      const pts = Array.from({ length: steps + 1 }, (_, i) => ({
        x: shape.c.x + shape.r * Math.cos(start + (sweep * i) / steps),
        y: shape.c.y + shape.r * Math.sin(start + (sweep * i) / steps),
      }));
      chain(pts, false);
    }
  }
  return pairs;
}

/** World line-list vertices (x0,y0,z0,x1,y1,z1,…) of the drafted entities on one plane. */
export function liftedVertices(entities: readonly DraftEntity[], plane: SectionPlaneConfig, into: number[] = []): number[] {
  for (const entity of entities) {
    // Text boxes are a pick aid, not ink; everything else draws its skeleton.
    if (entity.shape.type === 'text') continue;
    for (const part of entitySkeleton(entity.shape)) {
      for (const [a, b] of shapeSegments(part)) {
        const p = drawingToWorld(plane, a);
        const q = drawingToWorld(plane, b);
        into.push(p.x, p.y, p.z, q.x, q.y, q.z);
      }
    }
  }
  return into;
}

export function useDraftingLines3D(rendererRef: RefObject<Renderer | null>, isInitialized: boolean, recoveryEpoch = 0): void {
  const drafts = useProjectStore((s) => s.drafts);
  const layers = useProjectStore((s) => s.draftLayers);
  const views = useProjectStore((s) => s.views);
  const levels = useProjectStore((s) => s.levels);
  const byView = useViewDrawings((s) => s.byView);
  const models = useViewerStore((s) => s.models);
  const legacyGeometry = useViewerStore((s) => s.geometryResult);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;
    const visible = new Set(layers.filter((l) => l.visible).map((l) => l.id));
    const bounds = mergedSectionBounds(models, legacyGeometry);
    const vertices: number[] = [];
    for (const view of views) {
      const entities = drafts.filter((d) => d.viewId === view.id && visible.has(d.layerId));
      if (entities.length === 0) continue;
      // The generated drawing's own plane when there is one (exactly what was drawn on), else the view's.
      const plane = byView[view.id]?.drawing?.config.plane ?? viewPlaneConfig(view, levels, bounds);
      if (plane) liftedVertices(entities, plane, vertices);
    }
    try {
      renderer.setLineOverlay('drafting', vertices.length ? anchorWorldLineVertices(vertices) : null);
    } catch (err) {
      console.warn('[drafting] could not show drafted lines in 3D', err);
    }
  }, [rendererRef, isInitialized, recoveryEpoch, drafts, layers, views, levels, byView, models, legacyGeometry]);
}
