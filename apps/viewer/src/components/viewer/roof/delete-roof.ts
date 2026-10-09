/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Delete a whole roof system after asking — from the configurator or from
 * the 3D context menu on any of its parts (a single plane or rafter would
 * come back on the next regeneration, so a part never goes alone).
 */

import { resolve } from '@/i18n/registry';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { deleteRoofSystem, roofSystemOfRenderId, type RoofSystemRef } from '@/project/roof-system-element';
import { roofPartOfRenderId, setPartOverride } from '@/project/roof-block';
import { closeRoofDialog, stopRoofEdit, useRoofDialog } from '@/project/roof-dialog-store';

export async function deleteRoofWithConfirm(ref: RoofSystemRef): Promise<boolean> {
  const ok = await confirmDialog({
    title: resolve('roof.delete'), description: resolve('roof.deleteConfirm', { name: ref.spec.name }),
    confirmLabel: resolve('roof.delete'), destructive: true,
  });
  if (!ok) return false;
  const { open, editing } = useRoofDialog.getState();
  if (editing?.modelId === ref.modelId && editing.roofId === ref.roofId) stopRoofEdit();
  if (open?.modelId === ref.modelId && open.roofId === ref.roofId) closeRoofDialog();
  const result = deleteRoofSystem(ref);
  if (result.ok) toast.success(resolve('roof.deleted'));
  else toast.error(resolve('roof.problem', { reason: result.error }));
  return result.ok;
}

/**
 * Delete what a renderer id stands for in a roof system: inside the roof
 * being edited the part alone (an override), elsewhere the whole roof (asked
 * first). False when the id is not part of a roof system.
 */
export function deleteRoofOrPart(renderId: number): boolean {
  const part = roofPartOfRenderId(renderId);
  if (part) {
    const result = setPartOverride(part, { deleted: true });
    if (result.ok) toast.info(resolve('roofBlock.partDeleted'));
    else toast.error(result.error);
    return true;
  }
  const roof = roofSystemOfRenderId(renderId);
  if (!roof) return false;
  void deleteRoofWithConfirm(roof);
  return true;
}
