/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The BIM grids (IfcGrid, from the file or authored) on a floor plan, as
 * axis annotations drawn in the project's default axis type (Drafting
 * standards › Axis types): bubble, ends, size, line type, colour and label
 * text style. Each storey the plan's level names is read in its model
 * (`extractGridAxesForStorey`, overlay-aware), its axes mapped from storey
 * metres through the storey workplane to the view's drawing coordinates.
 * Derived, never stored: the grid is the model's, the look the standards'.
 */

import { useMemo } from 'react';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { extractGridAxesForStorey } from '@ifc-lite/create';
import { useViewerStore, type ViewerState } from '@/store';
import { buildStoreyWorkplane } from '@/lib/commands/modeling/workplane';
import { worldToDrawing } from '@/drafting/frame';
import { DEFAULT_DIM_STYLE, resolveAxis, resolveText, STANDARD, type StyleBook } from '@/drafting/styles';
import type { AnnotationLook } from '@/components/viewer/drafting/AnnotationGraphics';
import type { AxisShape } from '@/drafting/types';
import { useProjectStore } from './project-store';
import { styleBook } from './drafting-standards';
import { findElementByGlobalId } from './contour-element';
import type { ProjectView } from './types';

export interface ViewGrids {
  axes: AxisShape[];
  look: AnnotationLook;
}

const NONE: ViewGrids = { axes: [], look: { text: resolveText({ textStyles: [], dimStyles: [] }, {}), dim: DEFAULT_DIM_STYLE } };

/** The grid axes of a plan, drawn as `axisStyle` at the view's scale. */
export function viewGridAxes(s: ViewerState, view: ProjectView, plane: SectionPlaneConfig, book: StyleBook, axisStyle: string): ViewGrids {
  if (view.kind !== 'plan') return NONE;
  const params = { axisStyle };
  const type = resolveAxis(book, params);
  const text = resolveText(book, params);
  const unit = (view.scale ?? 100) / 1000;
  const axes: AxisShape[] = [];
  const seen = new Set<string>();
  for (const modelId of s.models.keys()) {
    const store = s.models.get(modelId)?.ifcDataStore;
    if (!store || s.models.get(modelId)?.visible === false) continue;
    for (const guid of view.level.storeyGlobalIds) {
      const storeyId = findElementByGlobalId(modelId, guid);
      if (storeyId === null) continue;
      const workplane = buildStoreyWorkplane(s, modelId, storeyId, 0);
      if ('refused' in workplane) continue;
      for (const axis of extractGridAxesForStorey(store, storeyId, s.mutationViews.get(modelId)).axes) {
        // A grid placed on a building reaches every storey under it: draw each axis once.
        const key = `${modelId}:${axis.axisId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [ax, ay, az] = workplane.localToRender([axis.a[0], axis.a[1], 0]);
        const [bx, by, bz] = workplane.localToRender([axis.b[0], axis.b[1], 0]);
        axes.push({
          type: 'axis',
          a: worldToDrawing(plane, { x: ax, y: ay, z: az }),
          b: worldToDrawing(plane, { x: bx, y: by, z: bz }),
          label: axis.AxisTag || '?',
          bubble: type.bubble, ends: type.ends, lineType: type.lineType,
          size: type.size * unit, height: text.height * unit,
        });
      }
    }
  }
  return { axes, look: { text, dim: DEFAULT_DIM_STYLE, axis: type } };
}

/** `viewGridAxes`, kept current through model edits and standards changes. */
export function useViewGridAxes(view: ProjectView | undefined, plane: SectionPlaneConfig | null | undefined): ViewGrids {
  const models = useViewerStore((s) => s.models);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const modelPlacement = useViewerStore((s) => s.modelPlacement);
  const axisStyles = useProjectStore((s) => s.axisStyles);
  const textStyles = useProjectStore((s) => s.textStyles);
  const axisStyle = useProjectStore((s) => s.defaultAxisStyle) ?? STANDARD;
  return useMemo(() => {
    void mutationVersion; void modelPlacement; void axisStyles; void textStyles;
    if (!view || !plane) return NONE;
    try {
      return viewGridAxes(useViewerStore.getState(), view, plane, styleBook(), axisStyle);
    } catch (err) {
      console.warn('[view-grids] grid axes could not be drawn', err);
      return NONE;
    }
  }, [view, plane, models, mutationVersion, modelPlacement, axisStyles, textStyles, axisStyle]);
}
