/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The drafting session's switches: Snap (F3), Ortho (F8, or Ctrl held while drawing), the selection. */

import { useDraftingSession } from './session';

const get = () => useDraftingSession.getState();

export function toggleOrtho(): void {
  useDraftingSession.setState({ ortho: !get().ortho });
}

export function toggleSnap(): void {
  useDraftingSession.setState({ snap: !get().snap });
}

/** Ctrl held down (true) or released: ortho for as long as it is held. */
export function setOrthoHeld(held: boolean): void {
  if (get().orthoHeld !== held) useDraftingSession.setState({ orthoHeld: held });
}

export function setDraftSelection(ids: ReadonlySet<string>): void {
  useDraftingSession.setState({ selection: ids });
}
