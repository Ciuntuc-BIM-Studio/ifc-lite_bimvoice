/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Studio tab's own commands: boolean operations between elements
 * (`project/element-boolean.ts`) and opening a solid's sketch
 * (`project/sketch-recovery.ts`). Extrude, Sweep and Revolve are the
 * `design:*` drafting commands, shown on Studio.
 */

import { BooleanIntersect, BooleanRemove, BooleanSubtract, BooleanUnion, EditElement } from '@/icons';
import { useViewerStore } from '@/store';
import { openSolidSketches } from '@/project/sketch-recovery';
import { operandsOf } from '@/project/combination-sync';
import { openProjectView } from '@/project/open-view';
import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import { bakeSelection, removeSubtractionsOfSelection, subtractSelection, toggleOperandsOfSelection, type BooleanSelection } from '@/project/element-boolean';
import type { SurfaceCommandDefinition } from './surface-command-types';

const ribbonOnly = ['ribbon'] as const;
const always = (): boolean => true;

function refused(picked: BooleanSelection): boolean {
  if (picked.ok) return false;
  toast.info(resolve(picked.error === 'models' ? 'studio.boolean.oneModel' : 'studio.boolean.select'));
  return true;
}

function subtract(): void {
  const picked = subtractSelection();
  if (!refused(picked) && picked.ok) toast.success(resolve('studio.boolean.subtracted', { count: picked.tools.length }));
}

function bake(op: 'UNION' | 'INTERSECTION'): () => void {
  return () => {
    const { picked, error } = bakeSelection(op);
    if (refused(picked)) return;
    if (error) toast.error(resolve('studio.boolean.failed', { reason: error }));
    else toast.success(resolve(op === 'UNION' ? 'studio.boolean.united' : 'studio.boolean.intersected'));
  };
}

function toggleOperands(): void {
  const count = toggleOperandsOfSelection();
  if (!count) toast.info(resolve('studio.boolean.noOperands'));
}

function removeSubtraction(): void {
  const count = removeSubtractionsOfSelection();
  toast.info(resolve(count ? 'studio.boolean.removed' : 'studio.boolean.noneToRemove'));
}

/** Open the selected solid's sketch on its view, drawn again from its history when the project has none. */
function editSketch(): void {
  const s = useViewerStore.getState();
  const ref = s.selectedEntityId === null || s.selectedEntityId === undefined ? null : s.resolveGlobalIdFromModels(s.selectedEntityId);
  if (!ref) {
    toast.info(resolve('studio.sketch.select'));
    return;
  }
  // A live Union's operands have sketches too: drawn beside the target's.
  const outcome = openSolidSketches(ref.modelId, ref.expressId, operandsOf(ref.modelId, [ref.expressId]));
  if (!outcome.viewId) {
    toast.error(resolve('studio.sketch.failed', { reason: outcome.errors[0] ?? '' }));
    return;
  }
  openProjectView(outcome.viewId);
  if (outcome.errors.length) toast.info(resolve('studio.sketch.partly', { reason: outcome.errors[0] }));
  else if (outcome.drawn) toast.success(resolve('studio.sketch.drawn'));
}

export const RIBBON_STUDIO_SURFACE_COMMANDS = [
  { id: 'studio:edit-sketch', labelKey: 'studio.sketch.edit', keywords: 'sketch edit profile contour history solid extrude sweep revolve', category: 'Tools', icon: EditElement, surfaces: ribbonOnly, enabled: always, run: editSketch },
  { id: 'studio:subtract', labelKey: 'studio.boolean.subtract', keywords: 'boolean subtract difference cut solid element operation SEO', category: 'Tools', icon: BooleanSubtract, surfaces: ribbonOnly, enabled: always, run: subtract },
  { id: 'studio:union', labelKey: 'studio.boolean.union', keywords: 'boolean union add merge join solid', category: 'Tools', icon: BooleanUnion, surfaces: ribbonOnly, enabled: always, run: bake('UNION') },
  { id: 'studio:intersect', labelKey: 'studio.boolean.intersect', keywords: 'boolean intersect intersection common solid', category: 'Tools', icon: BooleanIntersect, surfaces: ribbonOnly, enabled: always, run: bake('INTERSECTION') },
  { id: 'studio:operands', labelKey: 'studio.boolean.operands', keywords: 'boolean union intersect operands tools show hide edit', category: 'Tools', icon: BooleanUnion, surfaces: ribbonOnly, enabled: always, run: toggleOperands },
  { id: 'studio:remove-subtraction', labelKey: 'studio.boolean.removeSubtraction', keywords: 'boolean subtract remove undo cut', category: 'Tools', icon: BooleanRemove, surfaces: ribbonOnly, enabled: always, run: removeSubtraction },
] as const satisfies readonly SurfaceCommandDefinition[];
