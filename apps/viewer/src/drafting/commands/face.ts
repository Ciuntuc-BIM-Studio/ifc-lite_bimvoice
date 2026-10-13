/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * FACE: promote a closed contour to a face — click inside it. The smallest
 * closed contour around the click (or, with none drawn, the region the click
 * is in, whose outline and holes are drafted first) becomes a face with its
 * holes, and every island nested in those holes becomes a face too
 * (`drafting/faces.ts`). A contour that already has a face is left as it is.
 */

import { editDrafts, newDraft } from '../draft-store';
import { faceOutersUnder, faceOuterId, faceShape } from '../faces';
import { pickSource } from './model';
import type { DraftCommandDef } from './types';

export const faceCommand: DraftCommandDef = {
  id: 'face',
  aliases: ['FACE', 'REGION', 'REG'],
  labelKey: 'drafting.cmd.face',
  create(ctx) {
    return {
      prompt: () => ({ key: 'drafting.prompt.face' }),
      input: () => 'point',
      basePoint: () => null,
      onPoint(p) {
        const source = pickSource(ctx, p);
        if (!source) {
          ctx.say('drafting.msg.noRegion');
          return 'continue';
        }
        const drafts = ctx.entities();
        const faced = new Set(drafts.map(faceOuterId).filter((id): id is string => id !== null));
        const outers = faceOutersUnder(source, drafts).filter((o) => !faced.has(o.id));
        const add = outers.flatMap((outer) => {
          const shape = faceShape(outer, drafts);
          return shape ? [newDraft(ctx.viewId, ctx.layerId, shape, { face: outer.id })] : [];
        });
        if (add.length === 0) {
          ctx.say('drafting.msg.faceExists');
          return 'continue';
        }
        editDrafts({ add });
        ctx.say('drafting.msg.faceMade', { count: add.length });
        return 'continue';
      },
      onEnter: () => 'done',
    };
  },
};
