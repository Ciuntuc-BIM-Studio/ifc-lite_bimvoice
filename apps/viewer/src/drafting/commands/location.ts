/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LOCATION: pick, in a floor plan, the point of the model whose surveyed
 * coordinates are known (a building corner, an axis intersection — snaps
 * find them), and go back to the Project location dialog with it filled in.
 * Enter goes back with the form as it was; after Escape, Project location
 * opens on it again.
 */

import { finishLocationPick, planPointToProject } from '@/project/project-location-store';
import type { DraftCommandDef } from './types';

export const locationCommand: DraftCommandDef = {
  id: 'location',
  aliases: ['LOCATION', 'SURVEYPOINT'],
  labelKey: 'drafting.cmd.location',
  create(ctx) {
    return {
      prompt: () => ({ key: 'drafting.prompt.location' }),
      input: () => 'point',
      basePoint: () => null,
      onPoint(p) {
        const view = ctx.view(), plane = ctx.plane();
        const point = view && plane ? planPointToProject(view, plane, p) : null;
        if (!point) {
          ctx.say('drafting.msg.locationNoPlan');
          return 'continue';
        }
        finishLocationPick(point);
        return 'done';
      },
      onEnter() {
        finishLocationPick(null);
        return 'done';
      },
    };
  },
};
