/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The style automatic wall joins get (`wall.place`'s corners): butt or
 * mitre, remembered on this device. Kept apart from `wall-join-style.ts`
 * (which edits the model) so the store's join glue can read it without
 * importing the store.
 */

import { create } from 'zustand';

export type WallJoinStyle = 'butt' | 'mitre';

const STORAGE_KEY = 'ifc-lite:wall-join-style';

function stored(): WallJoinStyle {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'mitre' ? 'mitre' : 'butt';
  } catch {
    return 'butt';
  }
}

export const useWallJoinPrefs = create<{ style: WallJoinStyle }>()(() => ({ style: stored() }));

/** The style new corners get. */
export function defaultWallJoinStyle(): WallJoinStyle {
  return useWallJoinPrefs.getState().style;
}

export function setDefaultWallJoinStyle(style: WallJoinStyle): void {
  useWallJoinPrefs.setState({ style });
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, style);
  } catch {
    // Storage unavailable: the choice holds for this session.
  }
}
