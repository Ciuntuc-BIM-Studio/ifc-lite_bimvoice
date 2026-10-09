/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ROAD: a polyline (or line) on a floor plan becomes a road corridor
 * (`civil/corridor-element.ts`): its vertices are the PIs, each rounded
 * with the current radius (R50 sets 50 m), the profile follows the model's
 * terrain when it has one, the default assembly is swept along — to refine
 * in the corridor configurator. The polyline stays linked: editing it moves
 * the PIs.
 */

import { createCorridorFromPolyline } from '@/civil/corridor-element';
import type { DraftCommandDef } from './types';

let radius = 50;
let count = 0;

export const roadCommand: DraftCommandDef = {
  id: 'road',
  aliases: ['ROAD', 'CORRIDOR'],
  labelKey: 'drafting.cmd.road',
  create(ctx) {
    return {
      prompt: () => ({ key: 'drafting.prompt.road', params: { radius } }),
      input: () => 'pick',
      basePoint: () => null,
      wantsValue: () => true,
      onValue(v) {
        if (v > 0) radius = v;
        return 'continue';
      },
      onKeyword(word) {
        const r = /^R(\d+(?:\.\d+)?)$/i.exec(word);
        if (r && Number(r[1]) > 0) {
          radius = Number(r[1]);
          return 'continue';
        }
        return undefined;
      },
      onPick(entity) {
        const view = ctx.view();
        const plane = ctx.plane();
        if (!view || !plane) {
          ctx.say('drafting.msg.noWorkPlane');
          return 'continue';
        }
        const pts = entity.shape.type === 'polyline' ? entity.shape.pts : entity.shape.type === 'line' ? [entity.shape.a, entity.shape.b] : null;
        if (!pts || pts.length < 2) {
          ctx.say('drafting.msg.roadNeedsPolyline');
          return 'continue';
        }
        if (entity.params.ifcGlobalId) {
          ctx.say('drafting.msg.alreadyLinked');
          return 'continue';
        }
        const made = createCorridorFromPolyline(view, plane, pts, { name: `Road ${++count}`, radius }, entity.id);
        if (!made.ok) {
          count--;
          ctx.say('drafting.msg.extrudeFailed', { detail: made.error });
          return 'continue';
        }
        ctx.say('drafting.msg.roadCreated', { guid: made.globalId });
        return 'continue';
      },
      onEnter: () => 'done',
    };
  },
};
