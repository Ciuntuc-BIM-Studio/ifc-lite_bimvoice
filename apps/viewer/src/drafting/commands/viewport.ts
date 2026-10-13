/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * VIEWPORT: mark the part of a plan, section or elevation a sheet will show —
 * a closed polyline (points, C or Enter closes; R for a rectangle from two
 * corners), then its name. The region is kept on the view
 * (`project/viewport-regions.ts`) and placed on sheets from the Project
 * Navigator. Sheets themselves are not drawn on.
 */

import { useProjectStore } from '@/project/project-store';
import { nextRegionName, viewportLayerId } from '@/project/viewport-regions';
import { editDrafts, newDraft } from '../draft-store';
import { dist } from '../vec';
import type { Pt } from '../types';
import type { DraftCommandDef } from './types';

export const viewportCommand: DraftCommandDef = {
  id: 'viewport',
  aliases: ['VIEWPORT', 'VP'],
  labelKey: 'drafting.cmd.viewport',
  create(ctx) {
    const onSheet = useProjectStore.getState().sheets.some((s) => s.id === ctx.viewId);
    const pts: Pt[] = [];
    let rectangle = false;
    let naming = false;
    const close = () => {
      if (pts.length < 3) return 'continue' as const;
      naming = true;
      return 'continue' as const;
    };
    return {
      prompt: () => {
        if (onSheet) return { key: 'drafting.msg.viewportOnView' };
        if (naming) return { key: 'drafting.prompt.viewportName', params: { name: nextRegionName(ctx.viewId) } };
        if (rectangle) return { key: pts.length ? 'drafting.prompt.viewportCorner' : 'drafting.prompt.viewportFirstCorner' };
        return { key: pts.length === 0 ? 'drafting.prompt.viewportFirst' : 'drafting.prompt.viewportNext' };
      },
      input: () => 'point',
      basePoint: () => pts.at(-1) ?? null,
      onPoint(p) {
        if (onSheet) {
          ctx.say('drafting.msg.viewportOnView');
          return 'done';
        }
        if (naming) return 'continue';
        if (rectangle && pts.length === 1) {
          const a = pts[0];
          pts.splice(0, 1, a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y });
          return close();
        }
        const last = pts.at(-1);
        if (!last || dist(last, p) > 1e-9) pts.push(p);
        return 'continue';
      },
      onKeyword(word) {
        if (naming) return undefined;
        if (word === 'C' || word === 'CLOSE') return close();
        if ((word === 'R' || word === 'RECTANGLE') && pts.length === 0) {
          rectangle = true;
          return 'continue';
        }
        if (word === 'U' || word === 'UNDO') {
          pts.pop();
          return 'continue';
        }
        return undefined;
      },
      wantsText: () => naming,
      onText(text) {
        const name = text.trim() || nextRegionName(ctx.viewId);
        const layerId = viewportLayerId();
        editDrafts({ add: [newDraft(ctx.viewId, layerId, { type: 'polyline', pts: [...pts], closed: true }, { viewportRegion: true, viewportName: name })] });
        ctx.say('drafting.msg.viewportMade', { name });
        return 'done';
      },
      onEnter: () => {
        if (naming) {
          const name = nextRegionName(ctx.viewId);
          editDrafts({ add: [newDraft(ctx.viewId, viewportLayerId(), { type: 'polyline', pts: [...pts], closed: true }, { viewportRegion: true, viewportName: name })] });
          ctx.say('drafting.msg.viewportMade', { name });
          return 'done';
        }
        return pts.length >= 3 ? close() : 'done';
      },
      preview: (cursor) => {
        if (naming) return [{ type: 'polyline', pts: [...pts], closed: true }];
        if (rectangle && pts.length === 1) {
          const a = pts[0];
          return [{ type: 'polyline', pts: [a, { x: cursor.x, y: a.y }, cursor, { x: a.x, y: cursor.y }], closed: true }];
        }
        return pts.length ? [{ type: 'polyline', pts: [...pts, cursor], closed: pts.length >= 2 }] : [];
      },
    };
  },
};
