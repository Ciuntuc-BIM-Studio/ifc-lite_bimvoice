/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The modify commands of a drawing tab on BIM elements: with model elements
 * selected and nothing drafted, MOVE, COPY, ROTATE and ARRAY run the
 * modeling commands on them (`element.move`, `element.copy`,
 * `element.rotate`, `element.array`), on the floor plan in front, and ERASE
 * deletes them (the one Delete path, with their dependants, one undo step).
 * The drafting session asks here before it waits for a drafted selection
 * (`setModelEditRoute`), so the ribbon and the command line route alike.
 */

import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import { deleteElements, selectedRenderIds } from './element-delete';
import { reportDelete } from './element-delete-report';
import { startBimTool } from './model-command-bridge';
import { isDrawingTabActive, useDocumentTabs } from './document-tabs';
import { useProjectStore } from './project-store';

const ON_ELEMENTS: Record<string, string> = {
  move: 'element.move',
  copy: 'element.copy',
  rotate: 'element.rotate',
  array: 'element.array',
};

/** The kind of the drawing tab in front, when it is a project view. */
function frontKind(): string | null {
  const tabs = useDocumentTabs.getState();
  if (!isDrawingTabActive(tabs)) return null;
  return useProjectStore.getState().views.find((v) => v.id === tabs.activeId)?.kind ?? null;
}

/** Run drafting command `id` on the selected model elements instead; false when it does not apply. */
export function routeModifyToModel(id: string): boolean {
  const ids = selectedRenderIds();
  if (ids.length === 0) return false;
  if (id === 'erase') {
    reportDelete(deleteElements(ids));
    return true;
  }
  const command = ON_ELEMENTS[id];
  if (!command) return false;
  if (frontKind() !== 'plan') {
    toast.info(resolve('drafting.msg.editNeedsPlan'));
    return true;
  }
  startBimTool(command);
  return true;
}
