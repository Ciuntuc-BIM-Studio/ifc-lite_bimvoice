/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Design and Infrastructure tools are editor tools: using one means the
 * user wants to change the model, so they switch ifc-lite's Edit mode on by
 * themselves (with a note saying so and where to switch it off) instead of
 * refusing. Only Edit mode is switched: a read-only collaboration role, a
 * running workflow or a model without IFC data still refuse, as before.
 */

import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';

/** Switch Edit mode on when it is the only thing in the way; true when editing is (now) allowed. */
export function ensureEditMode(): boolean {
  const s = useViewerStore.getState();
  if (s.editEnabled) return true;
  if (!s.canCollabEdit()) return false;
  s.setEditEnabled(true);
  toast.info(resolve('editMode.autoOn'));
  return true;
}

/** Wrap a tool's action so it switches Edit mode on first. */
export function editing<A extends unknown[], R>(run: (...args: A) => R): (...args: A) => R {
  return (...args: A) => {
    ensureEditMode();
    return run(...args);
  };
}
