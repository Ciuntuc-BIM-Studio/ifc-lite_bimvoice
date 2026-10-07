/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keeps contour-based elements in step with their base contours: when a
 * linked contour (`params.ifcGlobalId`) changes shape or depth, its element
 * is rebuilt in place — same element, same GlobalId — and a changed
 * `ifcClass` retypes it, and the contour's other custom parameters are
 * written to the element's `IfcLite_Parameters` property set. Mapping is
 * by GlobalId only, so it survives reloads and project files.
 */

import { useEffect } from 'react';
import { PropertyValueType } from '@ifc-lite/data';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import { mergedSectionBounds } from '@/lib/section/section-distance';
import { contourLoops } from '@/drafting/commands/model';
import type { DraftEntity } from '@/drafting/types';
import { useProjectStore } from './project-store';
import { useViewDrawings } from './view-drawings';
import { viewPlaneConfig, viewWorkPlane } from './view-plane-config';
import { findElementByGlobalId, updateContourElement } from './contour-element';
import { roofSpecOf, updateRoofElement } from './roof-element';

/** Contour parameters that drive the link itself; every other parameter is a property of the element. */
const RESERVED = new Set(['ifcGlobalId', 'ifcModelId', 'ifcClass', 'depth', 'roofKind', 'slope', 'thickness', 'offset', 'eaveEdge']);
const ROOF_KEYS = ['roofKind', 'slope', 'thickness', 'offset', 'eaveEdge'] as const;
const PARAMETER_PSET = 'IfcLite_Parameters';

function syncParameters(modelId: string, globalId: string, before: DraftEntity['params'], after: DraftEntity['params']): void {
  const changed = Object.entries(after).filter(([key, value]) => !RESERVED.has(key) && before[key] !== value);
  if (changed.length === 0) return;
  const id = findElementByGlobalId(modelId, globalId);
  if (id === null) return;
  const viewer = useViewerStore.getState();
  for (const [key, value] of changed) {
    const type = typeof value === 'number' ? PropertyValueType.Real : typeof value === 'boolean' ? PropertyValueType.Boolean : PropertyValueType.Label;
    viewer.setProperty(modelId, id, PARAMETER_PSET, key, value, type);
  }
}

const linked = (d: DraftEntity) => typeof d.params.ifcGlobalId === 'string' && typeof d.params.ifcModelId === 'string';

function retype(modelId: string, globalId: string, ifcClass: string): void {
  const id = findElementByGlobalId(modelId, globalId);
  if (id === null) return;
  try {
    recordModellingCommit(useViewerStore, modelId, (editor) => editor.setEntityType(id, ifcClass));
  } catch (err) {
    toast.error(resolve('drafting.msg.extrudeFailed', { detail: err instanceof Error ? err.message : String(err) }));
  }
}

export function useLinkedElementSync(): void {
  useEffect(() => useProjectStore.subscribe((state, prev) => {
    if (state.drafts === prev.drafts) return;
    const before = new Map(prev.drafts.map((d) => [d.id, d]));
    for (const draft of state.drafts) {
      if (!linked(draft)) continue;
      const old = before.get(draft.id);
      if (!old || !linked(old)) continue; // just linked: the element was built from this very shape
      const modelId = String(draft.params.ifcModelId);
      const globalId = String(draft.params.ifcGlobalId);
      const ifcClass = String(draft.params.ifcClass ?? 'IfcBuildingElementProxy');
      const roof = roofSpecOf(draft.params);
      if (!roof && old.params.ifcClass !== draft.params.ifcClass) retype(modelId, globalId, ifcClass);
      if (old.params !== draft.params) syncParameters(modelId, globalId, old.params, draft.params);
      const roofChanged = roof !== null && ROOF_KEYS.some((k) => old.params[k] !== draft.params[k]);
      if (old.shape === draft.shape && old.params.depth === draft.params.depth && !roofChanged) continue;
      const view = state.views.find((v) => v.id === draft.viewId);
      if (!view) continue;
      const viewer = useViewerStore.getState();
      const drawn = useViewDrawings.getState().byView[view.id]?.drawing?.config.plane
        ?? viewPlaneConfig(view, state.levels, mergedSectionBounds(viewer.models, viewer.geometryResult));
      const plane = viewWorkPlane(view, drawn, state.levels);
      if (roof) {
        const outline = plane ? contourLoops(draft, state.drafts)?.[0] : null;
        const result = plane && outline ? updateRoofElement(view, plane, outline, roof, modelId, globalId) : null;
        if (result && !result.ok) toast.error(resolve('drafting.msg.extrudeFailed', { detail: result.error }));
        continue;
      }
      const loops = contourLoops(draft, state.drafts);
      const depth = Number(draft.params.depth);
      if (!plane || !loops || !Number.isFinite(depth) || depth === 0) continue;
      const result = updateContourElement(view, plane, loops, { ifcClass, depth }, modelId, globalId);
      if (!result.ok) toast.error(resolve('drafting.msg.extrudeFailed', { detail: result.error }));
    }
  }), []);
}
