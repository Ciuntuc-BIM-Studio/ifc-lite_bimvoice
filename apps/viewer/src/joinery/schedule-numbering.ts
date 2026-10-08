/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Write the schedule's numbers into the model: each door's and window's
 * Tag becomes its mark within its type (`W1.3`), level by level — what the
 * schedule and the Elements sheet print, so a plan tag, a site list and the
 * IFC say the same. One undo step per model; elements already tagged so are
 * left alone.
 */

import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { occurrenceMark, type ScheduleData } from './schedule-data';

/** IfcElement.Tag: GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation, Tag. */
const TAG = 7;

export function writeOccurrenceNumbers(data: ScheduleData): { written: number; errors: string[] } {
  const byModel = new Map<string, { id: number; tag: string }[]>();
  for (const e of data.entries) {
    for (const o of e.occurrences) {
      const tag = occurrenceMark(e, o);
      if (o.tag === tag) continue;
      byModel.set(o.modelId, [...(byModel.get(o.modelId) ?? []), { id: o.expressId, tag }]);
    }
  }
  let written = 0;
  const errors: string[] = [];
  for (const [modelId, items] of byModel) {
    try {
      recordModellingCommit(useViewerStore, modelId, (editor) => {
        for (const { id, tag } of items) editor.setPositionalAttribute(id, TAG, tag);
      });
      written += items.length;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { written, errors };
}
