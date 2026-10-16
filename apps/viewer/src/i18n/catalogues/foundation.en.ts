/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { TranslationValue } from '../types';

/** Foundations: strip foundations (a layered foundation wall on a strip footing) and stepped pad footings. */
export const foundationEn = {
  'foundation.group': 'Foundations',
  'foundation.strip.command': 'Strip foundation',
  'foundation.strip.label': 'Strip foundation',
  'foundation.strip.hintStart': 'Click the start of the foundation wall\'s axis (its core\'s centre)',
  'foundation.strip.hintNext': 'Click the end; the next foundation continues from it',
  'foundation.pad.command': 'Pad footing',
  'foundation.pad.label': 'Pad footing',
  'foundation.pad.hint': 'Click the footing\'s centre; R turns it by 15°',
} as const satisfies Record<string, TranslationValue>;
