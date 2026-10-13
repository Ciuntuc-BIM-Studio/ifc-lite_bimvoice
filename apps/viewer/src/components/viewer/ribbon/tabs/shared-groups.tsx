/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon groups shown on both the Draft and the BIM tab: the modify commands
 * that act on drafted entities and on selected BIM elements alike (move,
 * copy, rotate, array, erase — `project/model-edit-route.ts`), and the
 * drawing aids.
 */

import type { ReactNode } from 'react';
import { DraftArray, DraftCopy, DraftErase, DraftLine, DraftMove, DraftOrtho, DraftRotate, DraftSnap } from '@/icons';
import { useTranslation } from '@/i18n';
import { useDraftingSession } from '@/drafting/session';
import { useDrafting3dPref } from '@/lib/drafting-3d-prefs';
import { RibbonGroup, RibbonSmallStack } from '../primitives';
import { RibbonCommandLargeButton, RibbonCommandSmallButton } from '../command-button';

/** Move, copy, rotate, array, erase — plus a tab's own small buttons (`children`). */
export function ModifyGroup({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const commandId = useDraftingSession((s) => s.commandId);
  const on = (id: string) => commandId === id;
  return (
    <RibbonGroup label={t('drafting.group.modify')}>
      <RibbonCommandLargeButton commandId="design:move" icon={DraftMove} active={on('move')} />
      <RibbonCommandLargeButton commandId="design:copy" icon={DraftCopy} active={on('copy')} />
      <RibbonSmallStack>
        <RibbonCommandSmallButton commandId="design:rotate" icon={DraftRotate} active={on('rotate')} />
        <RibbonCommandSmallButton commandId="design:array" icon={DraftArray} active={on('array')} />
        <RibbonCommandSmallButton commandId="design:erase" icon={DraftErase} active={on('erase')} />
      </RibbonSmallStack>
      {children ? <RibbonSmallStack>{children}</RibbonSmallStack> : null}
    </RibbonGroup>
  );
}

/** Snap and ortho; on the Draft tab also the drafting lines shown in 3D. */
export function AidsGroup({ drafting3d = false }: { drafting3d?: boolean }) {
  const { t } = useTranslation();
  const snap = useDraftingSession((s) => s.snap);
  const ortho = useDraftingSession((s) => s.ortho);
  const shown3d = useDrafting3dPref((s) => s.show);
  return (
    <RibbonGroup label={t('drafting.group.aids')}>
      <RibbonSmallStack>
        <RibbonCommandSmallButton commandId="design:snap" icon={DraftSnap} active={snap} />
        <RibbonCommandSmallButton commandId="design:ortho" icon={DraftOrtho} active={ortho} />
        {drafting3d ? <RibbonCommandSmallButton commandId="design:drafting-3d" icon={DraftLine} active={shown3d} /> : null}
      </RibbonSmallStack>
    </RibbonGroup>
  );
}
