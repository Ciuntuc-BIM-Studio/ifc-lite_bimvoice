/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TAG: label a model element on a view — click the element (the arrow
 * goes there), then where the label sits. The label is a leader whose text
 * is either the current tag type's template filled from the element's
 * parameters (Drafting standards › Tags; a field it lacks reads a red NaN),
 * or, with no tag type current, the element's mark (its Tag, else its
 * Name), Name or class — MARK / NAME / CLASS switch, STYLE (or a tag type's
 * name) picks a tag type. Kept by the element's GlobalId (`tagOf`) and
 * refreshed when the element changes (`useElementTagSync`).
 */

import { renderIdGlobalId } from '@/project/element-guid';
import { elementLabel, type TagField } from '@/project/element-label';
import { elementClass, elementTagText, encodeMissing, tagsClass } from '@/project/tag-fields';
import { useProjectStore } from '@/project/project-store';
import type { TagType } from '../styles';
import { editDrafts, newDraft } from '../draft-store';
import { styledParams } from '@/project/drafting-standards';
import { entitySkeleton } from '../annotation';
import type { DraftParamValue, Pt } from '../types';
import type { DraftCommandDef } from './types';

const FIELDS: Record<string, TagField> = { MARK: 'mark', NAME: 'name', CLASS: 'class', TYPE: 'class' };

const tagTypes = (): readonly TagType[] => useProjectStore.getState().tagTypes ?? [];
const tagTypeNamed = (name: string) => tagTypes().find((t) => t.name.toLowerCase() === name.trim().toLowerCase());

export const tagCommand: DraftCommandDef = {
  id: 'tag',
  aliases: ['TAG', 'TG'],
  labelKey: 'drafting.cmd.tag',
  create(ctx) {
    const s = ctx.settings;
    let field: TagField = 'mark';
    let picking = false;
    let anchor: { p: Pt; guid: string; text: string; missing: Array<[number, number]> } | null = null;
    const tagType = () => tagTypes().find((t) => t.id === s.currentTagType);
    /** The tag text of an element under the current field / tag type; null: not one it tags. */
    const label = (guid: string): { text: string; missing: Array<[number, number]> } | null => {
      const type = tagType();
      if (!type) {
        const text = elementLabel(guid, field);
        return text === null ? null : { text, missing: [] };
      }
      const ifcClass = elementClass(guid);
      if (ifcClass === null) return null;
      if (!tagsClass(type.classes, ifcClass)) {
        ctx.say('drafting.msg.tagTypeNotFor', { type: type.name, cls: ifcClass });
        return null;
      }
      return elementTagText(guid, type.template);
    };
    const relabel = () => {
      if (!anchor) return;
      const next = label(anchor.guid);
      if (next) anchor = { ...anchor, ...next };
    };
    return {
      prompt: () => (picking ? { key: 'drafting.prompt.tagType' } : {
        key: anchor ? 'drafting.prompt.tagLabel' : 'drafting.prompt.tagElement',
        params: { field: tagType()?.name ?? field.toUpperCase() },
      }),
      input: () => 'point',
      basePoint: () => anchor?.p ?? null,
      onKeyword(word) {
        const next = FIELDS[word];
        if (next) {
          field = next;
          s.currentTagType = '';
          relabel();
          return 'continue';
        }
        if (word === 'STYLE' || word === 'S') {
          picking = true;
          return 'continue';
        }
        const type = tagTypeNamed(word);
        if (!type) return undefined;
        s.currentTagType = type.id;
        relabel();
        return 'continue';
      },
      wantsText: () => picking,
      onText(text) {
        picking = false;
        const type = tagTypeNamed(text);
        if (type) {
          s.currentTagType = type.id;
          relabel();
        } else if (text.trim()) ctx.say('drafting.msg.noTagType', { name: text.trim() });
        return 'continue';
      },
      onPoint(p) {
        if (!anchor) {
          const id = ctx.elementAt(p);
          const guid = id === null ? null : renderIdGlobalId(id);
          if (!guid) {
            ctx.say('drafting.msg.notAnElement');
            return 'continue';
          }
          const text = label(guid);
          if (text === null) {
            if (!tagType()) ctx.say('drafting.msg.notAnElement');
            return 'continue';
          }
          anchor = { p, guid, ...text };
          return 'continue';
        }
        const shape = { type: 'leader' as const, pts: [anchor.p, p], text: anchor.text, height: ctx.settings.textHeight };
        const styled = styledParams(ctx.viewId, shape, { textStyle: ctx.settings.currentTextStyle, dimStyle: ctx.settings.currentDimStyle });
        const type = tagType();
        const tag: Record<string, DraftParamValue> = type
          ? { tagOf: anchor.guid, tagType: type.id, ...(anchor.missing.length ? { tagMissing: encodeMissing(anchor.missing) } : {}) }
          : { tagOf: anchor.guid, tagField: field };
        editDrafts({ add: [newDraft(ctx.viewId, ctx.layerId, shape, { ...styled, ...tag })] });
        anchor = null;
        return 'continue';
      },
      onEnter: () => {
        if (picking) {
          picking = false;
          return 'continue';
        }
        return 'done';
      },
      preview: (cursor) => (anchor ? entitySkeleton({ type: 'leader', pts: [anchor.p, cursor], text: anchor.text, height: ctx.settings.textHeight }) : []),
    };
  },
};
