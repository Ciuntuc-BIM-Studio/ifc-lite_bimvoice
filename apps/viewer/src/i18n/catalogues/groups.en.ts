/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { TranslationValue } from '../types';
export const groupsEn = {
  'editMode.autoOn': 'Edit mode is on: Design tools change the model. Switch it off with Author › Model.',
  'groups.group': 'Groups',
  'groups.cmd.group': 'Group',
  'groups.cmd.ungroup': 'Ungroup',
  'groups.cmd.edit': 'Edit group',
  'groups.cmd.selectGroups': 'Select groups',
  'groups.created': '{name} grouped ({count} elements) — click any member to select the whole group',
  'groups.ungrouped': 'Ungrouped ({count})',
  'groups.error.nothingSelected': 'Select the elements to group first',
  'groups.error.twoModels': 'A group lives in one model: select elements of one model only',
  'groups.error.notElements': 'Only building elements can be grouped (walls, slabs, columns, doors…)',
  'groups.error.noGroup': 'Nothing selected is in a group',
  'groups.error.failed': 'The group could not be changed',
  'groups.editing': 'Editing group',
  'groups.editHint': 'The rest of the model is locked. What you build now joins the group.',
  'groups.add': 'Add',
  'groups.addHint': 'Click elements to add them to the group',
  'groups.remove': 'Remove',
  'groups.removeHint': 'Click members to take them out of the group',
  'groups.finish': 'Finish',
  'groups.members': '{count} elements',
  'groups.section': 'Group',
  'groups.name': 'Name',
  'groups.selectAll': 'Select group',
} as const satisfies Record<string, TranslationValue>;
