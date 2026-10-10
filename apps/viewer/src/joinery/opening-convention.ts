/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The project's door / window opening-symbol convention (`symbols.ts`), saved in the project file. */

import { useProjectStore } from '@/project/project-store';
import type { OpeningConvention } from './symbols';

export const openingConvention = (): OpeningConvention => useProjectStore.getState().openingLines ?? 'handle';

export const useOpeningConvention = (): OpeningConvention => useProjectStore((s) => s.openingLines ?? 'handle');

export function setOpeningConvention(convention: OpeningConvention): void {
  useProjectStore.setState({ openingLines: convention, dirty: true });
}
