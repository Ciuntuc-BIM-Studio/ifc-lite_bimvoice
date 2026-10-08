/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * DOOR / WINDOW / OPENING on a section or elevation: click on a wall's
 * face to put one there (`project/hosted-in-view.ts`), as many as wanted;
 * the outline follows the cursor over walls.
 */

import { hostedPlacementAt, placeHosted } from '@/project/hosted-in-view';
import type { HostedFillKind } from '@/store/slices/mutation-hosted-fill';
import type { DraftShape } from '../types';
import type { DraftCommandDef } from './types';

function hostedCommand(kind: HostedFillKind, aliases: string[]): DraftCommandDef {
  return {
    id: `place${kind}`,
    aliases,
    labelKey: `drafting.cmd.place.${kind}`,
    create(ctx) {
      const placement = (p: { x: number; y: number }) => {
        const plane = ctx.plane();
        return plane ? hostedPlacementAt(kind, ctx.elementAt(p), p, plane) : null;
      };
      return {
        prompt: () => ({ key: `drafting.prompt.place.${kind}` }),
        input: () => 'point',
        basePoint: () => null,
        onPoint(p) {
          const at = placement(p);
          if (at === null) {
            ctx.say('drafting.msg.noWorkPlane');
            return 'continue';
          }
          if (typeof at === 'string') {
            ctx.say('drafting.msg.hostedFailed', { detail: at });
            return 'continue';
          }
          const error = placeHosted(kind, at);
          if (error) ctx.say('drafting.msg.hostedFailed', { detail: error });
          else ctx.say(`drafting.msg.placed.${kind}`);
          return 'continue';
        },
        onEnter: () => 'done',
        preview(cursor): DraftShape[] {
          const at = placement(cursor);
          return at && typeof at !== 'string' ? [{ type: 'polyline', pts: at.outline, closed: true }] : [];
        },
      };
    },
  };
}

export const HOSTED_COMMANDS = [
  hostedCommand('door', ['DOOR', 'DR']),
  hostedCommand('window', ['WINDOW', 'WIN']),
  hostedCommand('opening', ['OPENING', 'OPN']),
] as const;
