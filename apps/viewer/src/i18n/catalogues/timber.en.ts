/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { TranslationValue } from '../types';

/** Timber components on the Wood tab: members (beams, posts, braces). */
export const timberEn = {
  'drafting.cmd.tbeam': 'TBEAM',
  'drafting.cmd.tpost': 'TPOST',
  'drafting.cmd.tbrace': 'TBRACE',
  'timber.group.members': 'Members',
  'timber.tool.beam': 'Timber beam',
  'timber.tool.post': 'Timber post',
  'timber.tool.brace': 'Brace',
  'timber.prompt.first': 'First point [{section} {grade}] — W / D section (mm), a class (C24, GL24h…), Z / H / B heights (m):',
  'timber.prompt.second': 'Second point [{section} {grade}] — Enter starts again:',
  'timber.prompt.post': 'Post position [{section} {grade} · {base} → {top} m] — W / D section (mm), a class, B foot, H head (m):',
  'timber.prompt.postSection': 'Foot or head of the post, then the other [{section} {grade}]:',
  'timber.field.width': 'Enter the section width (mm):',
  'timber.field.depth': 'Enter the section depth (mm):',
  'timber.field.beamTop': 'Enter the beam top above the level (m):',
  'timber.field.postBase': 'Enter the post foot above the level (m):',
  'timber.field.postTop': 'Enter the post head above the level (m):',
  'timber.field.braceFrom': 'Enter the brace start height above the level (m):',
  'timber.field.braceTo': 'Enter the brace end height above the level (m):',
  'timber.msg.made': '{ifcClass} {name} drawn.',
  'timber.msg.failed': 'The timber member could not be drawn: {detail}',
} as const satisfies Record<string, TranslationValue>;
