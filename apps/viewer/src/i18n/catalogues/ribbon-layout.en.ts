/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { TranslationValue } from '../types';
export const ribbonLayoutEn = {
  'ribbonLayout.title': 'Customize ribbon',
  'ribbonLayout.hint': 'Tick the tabs to show and move them into the order you want. Home always shows. Saved in this browser.',
  'ribbonLayout.up': 'Move {tab} left',
  'ribbonLayout.down': 'Move {tab} right',
  'ribbonLayout.reset': 'Reset',
  'ribbonLayout.done': 'Done',
  'ribbonLayout.menu.customize': 'Customize ribbon…',
  'ribbonLayout.menu.hide': 'Hide {tab}',
  'ribbonLayout.menu.showAll': 'Show all tabs',
} as const satisfies Record<string, TranslationValue>;
