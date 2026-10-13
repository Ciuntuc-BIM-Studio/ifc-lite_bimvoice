/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · Draft tab (id `design`) — 2D drafting on the view in front: draw,
 * modify and edit commands, grid axes, section lines and work planes, plus
 * snap / ortho. Modelling BIM elements is on the BIM tab, roofs on Wood,
 * the configurators on Project settings. The buttons are the registered
 * `design:*` commands (`surface-commands-design-ribbon.ts`).
 */

import {
  AnnoAxis, DraftArc, DraftCircle, DraftExtend, DraftFillet, DraftLine, DraftMirror,
  DraftOffset, DraftPolyline, DraftRectangle, DraftSectionLine, DraftTrim, DraftWorkplane,
} from '@/icons';
import { useTranslation } from '@/i18n';
import { useDraftingSession } from '@/drafting/session';
import { RibbonGroup, RibbonGroupDivider, RibbonSmallStack } from '../primitives';
import { RibbonCommandLargeButton, RibbonCommandSmallButton } from '../command-button';
import { AidsGroup, ModifyGroup } from './shared-groups';

export function DesignTab() {
  const { t } = useTranslation();
  const commandId = useDraftingSession((s) => s.commandId);
  const on = (id: string) => commandId === id;

  return (
    <>
      <RibbonGroup label={t('drafting.group.draw')}>
        <RibbonCommandLargeButton commandId="design:line" icon={DraftLine} active={on('line')} />
        <RibbonCommandLargeButton commandId="design:polyline" icon={DraftPolyline} active={on('polyline')} />
        <RibbonCommandLargeButton commandId="design:rectangle" icon={DraftRectangle} active={on('rectangle')} />
        <RibbonCommandLargeButton commandId="design:circle" icon={DraftCircle} active={on('circle')} />
        <RibbonCommandLargeButton commandId="design:arc" icon={DraftArc} active={on('arc')} />
        <RibbonCommandLargeButton commandId="annotate:axis" icon={AnnoAxis} active={on('axis')} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <ModifyGroup>
        <RibbonCommandSmallButton commandId="design:mirror" icon={DraftMirror} active={on('mirror')} />
      </ModifyGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.edit')}>
        <RibbonCommandLargeButton commandId="design:offset" icon={DraftOffset} active={on('offset')} />
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:trim" icon={DraftTrim} active={on('trim')} />
          <RibbonCommandSmallButton commandId="design:extend" icon={DraftExtend} active={on('extend')} />
          <RibbonCommandSmallButton commandId="design:fillet" icon={DraftFillet} active={on('fillet')} />
        </RibbonSmallStack>
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.workplane')}>
        <RibbonCommandLargeButton commandId="design:section-line" icon={DraftSectionLine} active={on('sectionline')} />
        <RibbonCommandLargeButton commandId="design:workplane-face" icon={DraftWorkplane} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <AidsGroup drafting3d />
    </>
  );
}
