/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · Studio tab — free modelling: solids from 2D contours (Extrude,
 * Sweep along a path, Revolve about an axis) and boolean operations between
 * elements (Subtract, live; Union and Intersect, baked into the element
 * selected first; Remove subtraction).
 */

import { BooleanIntersect, BooleanRemove, BooleanSubtract, BooleanUnion, DraftExtrude, DraftFace, DraftRevolve, DraftSweep } from '@/icons';
import { useTranslation } from '@/i18n';
import { useDraftingSession } from '@/drafting/session';
import { RibbonGroup, RibbonGroupDivider, RibbonSmallStack } from '../primitives';
import { RibbonCommandLargeButton, RibbonCommandSmallButton } from '../command-button';

export function StudioTab() {
  const { t } = useTranslation();
  const commandId = useDraftingSession((s) => s.commandId);
  const on = (id: string) => commandId === id;
  return (
    <>
      <RibbonGroup label={t('studio.group.solids')}>
        <RibbonCommandLargeButton commandId="design:face" icon={DraftFace} active={on('face')} />
        <RibbonCommandLargeButton commandId="design:extrude" icon={DraftExtrude} active={on('extrude')} />
        <RibbonCommandLargeButton commandId="design:sweep" icon={DraftSweep} active={on('sweep')} />
        <RibbonCommandLargeButton commandId="design:revolve" icon={DraftRevolve} active={on('revolve')} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('studio.group.boolean')}>
        <RibbonCommandLargeButton commandId="studio:subtract" icon={BooleanSubtract} />
        <RibbonCommandLargeButton commandId="studio:union" icon={BooleanUnion} />
        <RibbonCommandLargeButton commandId="studio:intersect" icon={BooleanIntersect} />
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="studio:remove-subtraction" icon={BooleanRemove} />
        </RibbonSmallStack>
      </RibbonGroup>
    </>
  );
}
