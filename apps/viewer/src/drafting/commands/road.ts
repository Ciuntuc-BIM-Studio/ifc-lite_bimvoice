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
 *
 * BRIDGE: the same along a bridge's axis — one bridge the whole length of
 * it, its grade straight from bank to bank, on the library's deck and wall
 * abutments — and the configurator opens on it.
 */

import { createCorridorFromPolyline } from '@/civil/corridor-element';
import { openCorridorDialog } from '@/civil/corridor-dialog-store';
import type { Pt } from '@/drafting/types';
import type { DraftCommandDef } from './types';

let radius = 50;
const counts = { road: 0, bridge: 0 };

/** The polyline's (or line's) points, or null for any other shape. */
export function axisPoints(shape: { type: string; pts?: Pt[]; a?: Pt; b?: Pt }): Pt[] | null {
  return shape.type === 'polyline' && shape.pts ? shape.pts : shape.type === 'line' && shape.a && shape.b ? [shape.a, shape.b] : null;
}

function axisCommand(kind: 'road' | 'bridge'): DraftCommandDef {
  const bridge = kind === 'bridge';
  return {
    id: kind,
    aliases: bridge ? ['BRIDGE', 'POD'] : ['ROAD', 'CORRIDOR'],
    labelKey: bridge ? 'drafting.cmd.bridge' : 'drafting.cmd.road',
    create(ctx) {
      return {
        prompt: () => ({ key: bridge ? 'drafting.prompt.bridge' : 'drafting.prompt.road', params: { radius } }),
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
          const pts = axisPoints(entity.shape);
          if (!pts || pts.length < 2) {
            ctx.say('drafting.msg.roadNeedsPolyline');
            return 'continue';
          }
          if (entity.params.ifcGlobalId) {
            ctx.say('drafting.msg.alreadyLinked');
            return 'continue';
          }
          const made = createCorridorFromPolyline(view, plane, pts, { name: `${bridge ? 'Bridge' : 'Road'} ${++counts[kind]}`, radius, bridge }, entity.id);
          if (!made.ok) {
            counts[kind]--;
            ctx.say('drafting.msg.extrudeFailed', { detail: made.error });
            return 'continue';
          }
          ctx.say(bridge ? 'drafting.msg.bridgeCreated' : 'drafting.msg.roadCreated', { guid: made.globalId });
          if (!bridge) return 'continue';
          openCorridorDialog({ modelId: made.modelId, corridorId: made.elementId });
          return 'done';
        },
        onEnter: () => 'done',
      };
    },
  };
}

export const roadCommand = axisCommand('road');
export const bridgeCommand = axisCommand('bridge');
