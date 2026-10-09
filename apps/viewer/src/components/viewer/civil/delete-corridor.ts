/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Deleting a whole corridor after a confirmation — from the ribbon, the configurator or the 3D context menu. */

import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { resolve } from '@/i18n/registry';
import { deleteCorridor, type CorridorRef } from '@/civil/corridor-element';
import { closeCorridorDialog, useCorridorDialog } from '@/civil/corridor-dialog-store';

export async function deleteCorridorWithConfirm(ref: CorridorRef): Promise<boolean> {
  const ok = await confirmDialog({
    title: resolve('civil.delete'), description: resolve('civil.deleteConfirm', { name: ref.spec.name }),
    confirmLabel: resolve('civil.delete'), destructive: true,
  });
  if (!ok) return false;
  const { open } = useCorridorDialog.getState();
  if (open?.modelId === ref.modelId && open.corridorId === ref.corridorId) closeCorridorDialog();
  const result = deleteCorridor(ref);
  if (result.ok) toast.success(resolve('civil.deleted'));
  else toast.error(resolve('civil.problem', { reason: result.error }));
  return result.ok;
}
