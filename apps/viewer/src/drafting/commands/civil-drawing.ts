/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CIVILDWG: draw a road drawing (profile / cross sections) on the view in
 * front, Civil 3D style — click its bottom-left corner. The drawing is
 * rebuilt at the view's scale (text sizes and band rows print right there)
 * and written as ordinary drafted lines, polylines, solid hatches and text
 * on the C-ROAD layers: static, editable like any drawing. Each click
 * places another copy; Enter ends.
 */

import { buildCivilDrawing, civilDrawing, drawingEntities, ensureCivilLayers } from '@/civil/civil-drawings';
import { clearPendingCivilDrawing, takePendingCivilDrawing } from '@/civil/civil-drawing-actions';
import { editDrafts } from '../draft-store';
import type { DraftCommandDef } from './types';

export const civilDrawingCommand: DraftCommandDef = {
  id: 'civildwg',
  aliases: ['CIVILDWG', 'ROADDWG'],
  labelKey: 'drafting.cmd.civilDrawing',
  create(ctx) {
    const id = takePendingCivilDrawing();
    return {
      prompt: () => ({ key: 'drafting.prompt.civilDrawing', params: { name: civilDrawing(id)?.name ?? '' } }),
      input: () => 'point',
      basePoint: () => null,
      onPoint(p) {
        const d = civilDrawing(id);
        const view = ctx.view();
        if (!d || !view) {
          ctx.say('drafting.msg.civilDrawingNone');
          return 'done';
        }
        const built = buildCivilDrawing(d, view.scale ?? 100);
        if (!('prims' in built)) {
          ctx.say('drafting.msg.extrudeFailed', { detail: built.error });
          return 'done';
        }
        ensureCivilLayers();
        const added = editDrafts({ add: drawingEntities(d, built, ctx.viewId, p, view.scale ?? 100, ctx.orientation) });
        ctx.say('drafting.msg.civilDrawingPlaced', { count: added.length, name: d.name });
        return 'continue';
      },
      onEnter: () => {
        clearPendingCivilDrawing();
        return 'done';
      },
    };
  },
};
