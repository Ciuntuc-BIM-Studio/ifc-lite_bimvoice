/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · Design tab — drafting and (later) modeling tools that work on
 * the view in front: draw, modify and edit commands, plus snap / ortho.
 * The buttons are the registered `design:*` commands
 * (`surface-commands-design-ribbon.ts`).
 */

import {
  DraftArc, DraftCircle, DraftCopy, DraftErase, DraftExtend, DraftFillet, DraftLine, DraftMirror, DraftMove,
  DraftOffset, DraftOrtho, DraftPolyline, DraftRectangle, DraftRotate, DraftSnap, DraftTrim,
} from '@/icons';
import { useTranslation } from '@/i18n';
import { useDraftingSession } from '@/drafting/session';
import { RibbonGroup, RibbonGroupDivider, RibbonSmallStack } from '../primitives';
import { RibbonCommandLargeButton, RibbonCommandSmallButton } from '../command-button';

export function DesignTab() {
  const { t } = useTranslation();
  const commandId = useDraftingSession((s) => s.commandId);
  const snap = useDraftingSession((s) => s.snap);
  const ortho = useDraftingSession((s) => s.ortho);
  const on = (id: string) => commandId === id;

  return (
    <>
      <RibbonGroup label={t('drafting.group.draw')}>
        <RibbonCommandLargeButton commandId="design:line" icon={DraftLine} active={on('line')} />
        <RibbonCommandLargeButton commandId="design:polyline" icon={DraftPolyline} active={on('polyline')} />
        <RibbonCommandLargeButton commandId="design:rectangle" icon={DraftRectangle} active={on('rectangle')} />
        <RibbonCommandLargeButton commandId="design:circle" icon={DraftCircle} active={on('circle')} />
        <RibbonCommandLargeButton commandId="design:arc" icon={DraftArc} active={on('arc')} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.modify')}>
        <RibbonCommandLargeButton commandId="design:move" icon={DraftMove} active={on('move')} />
        <RibbonCommandLargeButton commandId="design:copy" icon={DraftCopy} active={on('copy')} />
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:rotate" icon={DraftRotate} active={on('rotate')} />
          <RibbonCommandSmallButton commandId="design:mirror" icon={DraftMirror} active={on('mirror')} />
          <RibbonCommandSmallButton commandId="design:erase" icon={DraftErase} active={on('erase')} />
        </RibbonSmallStack>
      </RibbonGroup>
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
      <RibbonGroup label={t('drafting.group.aids')}>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:snap" icon={DraftSnap} active={snap} />
          <RibbonCommandSmallButton commandId="design:ortho" icon={DraftOrtho} active={ortho} />
        </RibbonSmallStack>
      </RibbonGroup>
    </>
  );
}
