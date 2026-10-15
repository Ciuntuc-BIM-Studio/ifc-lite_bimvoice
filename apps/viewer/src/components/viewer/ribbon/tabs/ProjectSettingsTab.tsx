/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · Project settings tab — the project's configurators: element types,
 * building materials, door and window types, cut priorities, the drafting
 * standards (layers, text, dimension, axis and tag styles) and where the
 * project is on the map. Each opens its
 * dialog; what is set there is saved with the project.
 */

import { BuildingMaterials, CutPriority, DraftingStandards, ElementTypes, JoineryTypes, ProjectLocation } from '@/icons';
import { useTranslation } from '@/i18n';
import { RibbonGroup, RibbonGroupDivider } from '../primitives';
import { RibbonCommandLargeButton } from '../command-button';

export function ProjectSettingsTab() {
  const { t } = useTranslation();
  return (
    <>
      <RibbonGroup label={t('ribbon.projectSettings.group.catalogues')}>
        <RibbonCommandLargeButton commandId="design:element-types" icon={ElementTypes} />
        <RibbonCommandLargeButton commandId="design:materials" icon={BuildingMaterials} />
        <RibbonCommandLargeButton commandId="design:joinery" icon={JoineryTypes} />
        <RibbonCommandLargeButton commandId="design:cut-priorities" icon={CutPriority} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('standards.title')}>
        <RibbonCommandLargeButton commandId="annotate:standards" icon={DraftingStandards} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('location.command')}>
        <RibbonCommandLargeButton commandId="design:project-location" icon={ProjectLocation} />
      </RibbonGroup>
    </>
  );
}
