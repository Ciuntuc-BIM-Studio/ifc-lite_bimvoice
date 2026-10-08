/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TAG: label a model element on a view — click the element (the arrow
 * goes there), then where the label sits. The label is a leader whose text
 * is the element's mark (its Tag, else its Name), Name or class — MARK /
 * NAME / CLASS switch — kept by the element's GlobalId (`tagOf`) and
 * refreshed when the element changes (`useElementTagSync`).
 */

import { renderIdGlobalId } from '@/project/element-guid';
import { elementLabel, type TagField } from '@/project/element-label';
import { editDrafts, newDraft } from '../draft-store';
import { styledParams } from '@/project/drafting-standards';
import { entitySkeleton } from '../annotation';
import type { Pt } from '../types';
import type { DraftCommandDef } from './types';

const FIELDS: Record<string, TagField> = { MARK: 'mark', NAME: 'name', CLASS: 'class', TYPE: 'class' };

export const tagCommand: DraftCommandDef = {
  id: 'tag',
  aliases: ['TAG', 'TG'],
  labelKey: 'drafting.cmd.tag',
  create(ctx) {
    let field: TagField = 'mark';
    let anchor: { p: Pt; guid: string; text: string } | null = null;
    return {
      prompt: () => ({ key: anchor ? 'drafting.prompt.tagLabel' : 'drafting.prompt.tagElement', params: { field: field.toUpperCase() } }),
      input: () => 'point',
      basePoint: () => anchor?.p ?? null,
      onKeyword(word) {
        const next = FIELDS[word];
        if (!next) return undefined;
        field = next;
        if (anchor) anchor = { ...anchor, text: elementLabel(anchor.guid, field) ?? anchor.text };
        return 'continue';
      },
      onPoint(p) {
        if (!anchor) {
          const id = ctx.elementAt(p);
          const guid = id === null ? null : renderIdGlobalId(id);
          const text = guid ? elementLabel(guid, field) : null;
          if (!guid || text === null) {
            ctx.say('drafting.msg.notAnElement');
            return 'continue';
          }
          anchor = { p, guid, text };
          return 'continue';
        }
        const shape = { type: 'leader' as const, pts: [anchor.p, p], text: anchor.text, height: ctx.settings.textHeight };
        const styled = styledParams(ctx.viewId, shape, { textStyle: ctx.settings.currentTextStyle, dimStyle: ctx.settings.currentDimStyle });
        editDrafts({ add: [newDraft(ctx.viewId, ctx.layerId, shape, { ...styled, tagOf: anchor.guid, tagField: field })] });
        anchor = null;
        return 'continue';
      },
      onEnter: () => 'done',
      preview: (cursor) => (anchor ? entitySkeleton({ type: 'leader', pts: [anchor.p, cursor], text: anchor.text, height: ctx.settings.textHeight }) : []),
    };
  },
};
