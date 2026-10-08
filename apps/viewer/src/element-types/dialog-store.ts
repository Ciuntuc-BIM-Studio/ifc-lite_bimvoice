/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Whether the element types dialog is open, on which kind and entry. */

import { create } from 'zustand';
import type { ElementTypeKind } from './spec';

export const useTypesDialog = create<{ open: boolean; kind: ElementTypeKind; selectedId: string | null }>()(() => ({ open: false, kind: 'wall', selectedId: null }));

export function openElementTypes(kind?: ElementTypeKind, selectedId: string | null = null): void {
  useTypesDialog.setState((s) => ({ open: true, kind: kind ?? s.kind, selectedId: selectedId ?? s.selectedId }));
}

export function closeElementTypes(): void {
  useTypesDialog.setState({ open: false });
}
