/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Every drafting command, looked up by id or by a typed command-line name. */

import { DRAW_COMMANDS } from './draw';
import { MODIFY_COMMANDS } from './modify';
import { EDIT_COMMANDS } from './edit';
import { ANNOTATE_COMMANDS } from './annotate';
import { sectionLineCommand } from './workplane';
import { extrudeCommand } from './model';
import { roofCommand } from './roof';
import { revolveCommand, sweepCommand } from './solids';
import { HOSTED_COMMANDS } from './hosted';
import type { DraftCommandDef } from './types';

export const DRAFT_COMMANDS: readonly DraftCommandDef[] = [...DRAW_COMMANDS, ...MODIFY_COMMANDS, ...EDIT_COMMANDS, ...ANNOTATE_COMMANDS, sectionLineCommand, extrudeCommand, roofCommand, sweepCommand, revolveCommand, ...HOSTED_COMMANDS];

const BY_ID = new Map(DRAFT_COMMANDS.map((c) => [c.id, c]));
const BY_ALIAS = new Map(DRAFT_COMMANDS.flatMap((c) => c.aliases.map((a) => [a, c] as const)));

export function draftCommandById(id: string): DraftCommandDef | undefined {
  return BY_ID.get(id);
}

/** The command a typed name means (case-insensitive), if any. */
export function draftCommandByName(name: string): DraftCommandDef | undefined {
  return BY_ALIAS.get(name.trim().toUpperCase());
}
