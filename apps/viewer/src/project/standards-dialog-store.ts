/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Which drafting-standards tab is open (none when closed): opened from the ribbon, a drawing tab or a selection. */

import { create } from 'zustand';

export type StandardsTab = 'layers' | 'text' | 'dim';

export const useStandardsDialog = create<{ tab: StandardsTab | null; styleId: string | null }>()(() => ({ tab: null, styleId: null }));

export function openStandards(tab: StandardsTab = 'layers', styleId: string | null = null): void {
  useStandardsDialog.setState({ tab, styleId });
}

export function closeStandards(): void {
  useStandardsDialog.setState({ tab: null, styleId: null });
}
