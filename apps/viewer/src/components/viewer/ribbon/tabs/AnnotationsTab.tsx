/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · Annotations tab — notation on the view in front: text and
 * leaders, dimensions, level marks, grid axes and CAD hatches (built-in patterns plus
 * the project's own `.pat` files). The buttons are the registered
 * `annotate:*` commands (`surface-commands-annotate-ribbon.ts`).
 */

import { AnnoAxis, AnnoDimAligned, AnnoDimAngular, AnnoDimLinear, AnnoDimRadius, AnnoHatch, AnnoLeader, AnnoLevel, AnnoLoadPattern, AnnoTag, AnnoText, DraftingStandards } from '@/icons';
import { useTranslation } from '@/i18n';
import { useDraftingSession } from '@/drafting/session';
import { RibbonGroup, RibbonGroupDivider, RibbonSmallStack } from '../primitives';
import { RibbonCommandLargeButton, RibbonCommandSmallButton } from '../command-button';

export function AnnotationsTab() {
  const { t } = useTranslation();
  const commandId = useDraftingSession((s) => s.commandId);
  const on = (id: string) => commandId === id;
  return (
    <>
      <RibbonGroup label={t('drafting.group.text')}>
        <RibbonCommandLargeButton commandId="annotate:text" icon={AnnoText} active={on('text')} />
        <RibbonCommandLargeButton commandId="annotate:leader" icon={AnnoLeader} active={on('leader')} />
        <RibbonCommandLargeButton commandId="annotate:tag" icon={AnnoTag} active={on('tag')} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.dimensions')}>
        <RibbonCommandLargeButton commandId="annotate:dim-aligned" icon={AnnoDimAligned} active={on('dimaligned')} />
        <RibbonCommandLargeButton commandId="annotate:dim-linear" icon={AnnoDimLinear} active={on('dimlinear')} />
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="annotate:dim-radius" icon={AnnoDimRadius} active={on('dimradius')} />
          <RibbonCommandSmallButton commandId="annotate:dim-diameter" icon={AnnoDimRadius} active={on('dimdiameter')} />
          <RibbonCommandSmallButton commandId="annotate:dim-angular" icon={AnnoDimAngular} active={on('dimangular')} />
        </RibbonSmallStack>
        <RibbonCommandLargeButton commandId="annotate:level" icon={AnnoLevel} active={on('level')} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.axes')}>
        <RibbonCommandLargeButton commandId="annotate:axis" icon={AnnoAxis} active={on('axis')} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.fill')}>
        <RibbonCommandLargeButton commandId="annotate:hatch" icon={AnnoHatch} active={on('hatch')} />
        <RibbonCommandLargeButton commandId="annotate:load-pattern" icon={AnnoLoadPattern} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('standards.title')}>
        <RibbonCommandLargeButton commandId="annotate:standards" icon={DraftingStandards} />
      </RibbonGroup>
    </>
  );
}
