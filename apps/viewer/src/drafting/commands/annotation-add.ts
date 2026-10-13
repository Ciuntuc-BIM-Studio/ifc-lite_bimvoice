/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Writing an annotation with its style, and its outline for the preview: shared by the annotation commands. */

import { styledParams } from '@/project/drafting-standards';
import { editDrafts, newDraft } from '../draft-store';
import { entitySkeleton } from '../annotation';
import type { AnnotationShape, DraftShape } from '../types';
import type { DraftContext } from './types';

export function add(ctx: DraftContext, shape: AnnotationShape): void {
  // The current style, and an override when the height was typed differently.
  const params = styledParams(ctx.viewId, shape, { textStyle: ctx.settings.currentTextStyle, dimStyle: ctx.settings.currentDimStyle, axisStyle: ctx.settings.currentAxisStyle });
  editDrafts({ add: [newDraft(ctx.viewId, ctx.layerId, shape, params)] });
}

export const skeleton = (shape: AnnotationShape): DraftShape[] => entitySkeleton(shape);
