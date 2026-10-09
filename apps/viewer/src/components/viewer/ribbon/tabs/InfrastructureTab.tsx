/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · Infrastructure tab — Civil-style road modelling on the floor
 * plan in front: terrains, road corridors along drawn polylines, the
 * corridor configurator, and LandXML in and out. The buttons are the
 * registered `infra:*` commands (`surface-commands-infra-ribbon.ts`).
 */

import { CivilProfileView, CivilSectionViews, CivilProfiles, CivilProfileDraft, CivilCorridor, CivilDelete, CivilLandXmlIn, CivilLandXmlOut, CivilPoints, CivilRoad, CivilTerrain } from '@/icons';
import { useTranslation } from '@/i18n';
import { useDraftingSession } from '@/drafting/session';
import { RibbonGroup, RibbonGroupDivider, RibbonSmallStack } from '../primitives';
import { RibbonCommandLargeButton, RibbonCommandSmallButton } from '../command-button';

export function InfrastructureTab() {
  const { t } = useTranslation();
  const commandId = useDraftingSession((s) => s.commandId);
  return (
    <>
      <RibbonGroup label={t('civil.group.terrain')}>
        <RibbonCommandLargeButton commandId="infra:terrain-points" icon={CivilPoints} />
        <RibbonCommandLargeButton commandId="infra:terrain-selection" icon={CivilTerrain} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('civil.group.road')}>
        <RibbonCommandLargeButton commandId="infra:road" icon={CivilRoad} active={commandId === 'road'} />
        <RibbonCommandLargeButton commandId="infra:corridor" icon={CivilCorridor} />
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="infra:delete-corridor" icon={CivilDelete} />
        </RibbonSmallStack>
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('civil.group.drawings')}>
        <RibbonCommandLargeButton commandId="infra:profile-view" icon={CivilProfileView} />
        <RibbonCommandLargeButton commandId="infra:section-views" icon={CivilSectionViews} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('civil.group.profiles')}>
        <RibbonCommandLargeButton commandId="infra:profiles" icon={CivilProfiles} />
        <RibbonCommandLargeButton commandId="infra:profile-from-draft" icon={CivilProfileDraft} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('civil.group.exchange')}>
        <RibbonCommandLargeButton commandId="infra:import-landxml" icon={CivilLandXmlIn} />
        <RibbonCommandLargeButton commandId="infra:export-landxml" icon={CivilLandXmlOut} />
      </RibbonGroup>
    </>
  );
}
