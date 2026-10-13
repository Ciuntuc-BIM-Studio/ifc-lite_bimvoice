/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · Wood tab — roofs and their timber: place a roof, configure roof
 * systems (rafters, purlins, ridge, trusses, end cuts), and attach walls to
 * the roof above them or detach them. The buttons are the registered
 * `design:*` commands (`surface-commands-design-ribbon.ts`).
 */

import { BimRoof, RoofSystem, TimberBeam, TimberBrace, TimberClt, TimberFrame, TimberPost, TimberTruss, TimberTrussSettings, WallAttachRoof, WallDetachRoof } from '@/icons';
import { useTranslation } from '@/i18n';
import { useDraftingSession } from '@/drafting/session';
import { RibbonGroup, RibbonGroupDivider, RibbonSmallStack } from '../primitives';
import { RibbonCommandLargeButton, RibbonCommandSmallButton } from '../command-button';

export function WoodTab() {
  const { t } = useTranslation();
  const commandId = useDraftingSession((s) => s.commandId);
  return (
    <>
      <RibbonGroup label={t('ribbon.wood.group.roof')}>
        <RibbonCommandLargeButton commandId="design:bim-roof" icon={BimRoof} active={commandId === 'roof'} />
        <RibbonCommandLargeButton commandId="design:roof-system" icon={RoofSystem} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('ribbon.wood.group.walls')}>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:attach-roof" icon={WallAttachRoof} />
          <RibbonCommandSmallButton commandId="design:detach-roof" icon={WallDetachRoof} />
        </RibbonSmallStack>
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('timber.group.members')}>
        <RibbonCommandLargeButton commandId="wood:tbeam" icon={TimberBeam} active={commandId === 'tbeam'} />
        <RibbonCommandLargeButton commandId="wood:tpost" icon={TimberPost} active={commandId === 'tpost'} />
        <RibbonCommandLargeButton commandId="wood:tbrace" icon={TimberBrace} active={commandId === 'tbrace'} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('timber.group.trusses')}>
        <RibbonCommandLargeButton commandId="wood:truss" icon={TimberTruss} active={commandId === 'truss'} />
        <RibbonCommandLargeButton commandId="wood:truss-settings" icon={TimberTrussSettings} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('timber.group.frames')}>
        <RibbonCommandLargeButton commandId="wood:timber-frame" icon={TimberFrame} />
        <RibbonCommandLargeButton commandId="wood:clt" icon={TimberClt} />
      </RibbonGroup>
    </>
  );
}
