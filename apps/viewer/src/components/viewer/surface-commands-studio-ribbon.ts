/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Studio tab's own commands: boolean operations between elements
 * (`project/element-boolean.ts`). Extrude, Sweep and Revolve are the
 * `design:*` drafting commands, shown on Studio.
 */

import { BooleanIntersect, BooleanRemove, BooleanSubtract, BooleanUnion } from '@/icons';
import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import { bakeSelection, removeSubtractionsOfSelection, subtractSelection, type BooleanSelection } from '@/project/element-boolean';
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

function removeSubtraction(): void {
  const count = removeSubtractionsOfSelection();
  toast.info(resolve(count ? 'studio.boolean.removed' : 'studio.boolean.noneToRemove'));
}

export const RIBBON_STUDIO_SURFACE_COMMANDS = [
  { id: 'studio:subtract', labelKey: 'studio.boolean.subtract', keywords: 'boolean subtract difference cut solid element operation SEO', category: 'Tools', icon: BooleanSubtract, surfaces: ribbonOnly, enabled: always, run: subtract },
  { id: 'studio:union', labelKey: 'studio.boolean.union', keywords: 'boolean union add merge join solid', category: 'Tools', icon: BooleanUnion, surfaces: ribbonOnly, enabled: always, run: bake('UNION') },
  { id: 'studio:intersect', labelKey: 'studio.boolean.intersect', keywords: 'boolean intersect intersection common solid', category: 'Tools', icon: BooleanIntersect, surfaces: ribbonOnly, enabled: always, run: bake('INTERSECTION') },
  { id: 'studio:remove-subtraction', labelKey: 'studio.boolean.removeSubtraction', keywords: 'boolean subtract remove undo cut', category: 'Tools', icon: BooleanRemove, surfaces: ribbonOnly, enabled: always, run: removeSubtraction },
] as const satisfies readonly SurfaceCommandDefinition[];
