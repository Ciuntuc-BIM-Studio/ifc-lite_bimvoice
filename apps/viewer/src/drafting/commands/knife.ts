/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * KNIFE: cut a polygon's side where it is clicked, adding a vertex there,
 * for as many cuts as wanted (Enter ends). A cut side's pieces are then
 * pushed apart by their own middle grips (`edge-offset.ts`): only the piece
 * dragged moves out, with a step at the cut. On a floor plan, a selected
 * slab's outline is cut the same way (`SlabOutlineGrips`).
 */

import { editDrafts } from '../draft-store';
import { knifeAt } from '../edge-offset';
import type { DraftCommandDef } from './types';

export const knifeCommand: DraftCommandDef = {
  id: 'knife',
  aliases: ['KNIFE', 'KN'],
  labelKey: 'drafting.cmd.knife',
  create(ctx) {
    return {
      prompt: () => ({ key: 'drafting.prompt.knife' }),
      input: () => 'pick',
      basePoint: () => null,
      onPick(entity, at) {
        const cut = entity.shape.type === 'polyline' ? knifeAt(entity.shape.pts, at, entity.shape.closed) : null;
        if (!cut || entity.shape.type !== 'polyline') {
          ctx.say('drafting.msg.knifeNothing');
          return 'continue';
        }
        editDrafts({ update: new Map([[entity.id, { ...entity.shape, pts: cut }]]) });
        return 'continue';
      },
      onEnter: () => 'done',
    };
  },
};
