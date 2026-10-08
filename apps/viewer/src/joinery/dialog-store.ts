/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Whether the door / window configurator is open, and on which catalogue entry. */

import { create } from 'zustand';

export const useJoineryDialog = create<{ open: boolean; selectedId: string | null }>()(() => ({ open: false, selectedId: null }));

export function openJoinery(selectedId: string | null = null): void {
  useJoineryDialog.setState((s) => ({ open: true, selectedId: selectedId ?? s.selectedId }));
}

export function closeJoinery(): void {
  useJoineryDialog.setState({ open: false });
}
