/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Whether drafted lines are shown in the 3D view, on their views' planes.
 * Off by default: drafting is not part of the model — only the elements
 * made from it are — so the 3D view shows the model alone unless asked.
 * Remembered on this device.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'ifc-lite:drafting-in-3d';

function stored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export const useDrafting3dPref = create<{ show: boolean }>()(() => ({ show: stored() }));

export function toggleDraftingIn3d(): void {
  const show = !useDrafting3dPref.getState().show;
  useDrafting3dPref.setState({ show });
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, show ? '1' : '0');
  } catch {
    // Storage unavailable: the choice holds for this session.
  }
}
