/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · BIM tab — modelling with the predefined BIM elements and
 * transforming them: place walls, slabs, columns, beams, curtain walls,
 * doors, windows, openings, stairs, railings, rooms and grids, and foundations; move, copy,
 * rotate, array and erase them (the same commands as on Draft, which act on
 * selected elements); flip, joins, groups and storey; work planes and aids.
 * Roofs are on the Wood tab.
 */

import {
  BimBeam, BimColumn, BimCurtainWall, BimDoor, BimPadFooting, BimStripFoundation, BimGrid, BimOpening, BimRailing, BimRoom, BimSlab, BimStair, BimWall, BimWindow,
  DoorFlipHand, DoorFlipSide, DraftWorkplane, GroupEdit, GroupMake, GroupSelect, GroupUngroup, JoinAuto, JoinButt, JoinMitre, JoinSwap, MoveToStorey,
} from '@/icons';
import { useViewerStore } from '@/store';
import { useWallJoinPrefs } from '@/lib/wall-join-prefs';
import { useTranslation } from '@/i18n';
import { useGroupEdit, useGroupPrefs } from '@/project/element-groups';
import { RibbonGroup, RibbonGroupDivider, RibbonSmallStack } from '../primitives';
import { RibbonCommandLargeButton, RibbonCommandSmallButton } from '../command-button';
import { AidsGroup, ModifyGroup } from './shared-groups';

export function BimTab() {
  const { t } = useTranslation();
  const modelCommand = useViewerStore((s) => s.session?.activeCommandId ?? null);
  const bim = (id: string) => modelCommand === id;
  const autoMitre = useWallJoinPrefs((s) => s.style === 'mitre');
  const selectGroups = useGroupPrefs((s) => s.selectGroups);
  const groupEditing = useGroupEdit((s) => s.editing !== null);

  return (
    <>
      <RibbonGroup label={t('drafting.group.bim')}>
        <RibbonCommandLargeButton commandId="design:bim-wall" icon={BimWall} active={bim('wall.place')} />
        <RibbonCommandLargeButton commandId="design:bim-slab" icon={BimSlab} active={bim('slab.place')} />
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:bim-column" icon={BimColumn} active={bim('column.place')} />
          <RibbonCommandSmallButton commandId="design:bim-beam" icon={BimBeam} active={bim('beam.place')} />
          <RibbonCommandSmallButton commandId="design:bim-curtain-wall" icon={BimCurtainWall} active={bim('curtainwall.place')} />
        </RibbonSmallStack>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:bim-door" icon={BimDoor} active={bim('door.place')} />
          <RibbonCommandSmallButton commandId="design:bim-window" icon={BimWindow} active={bim('window.place')} />
          <RibbonCommandSmallButton commandId="design:bim-opening" icon={BimOpening} active={bim('opening.place')} />
        </RibbonSmallStack>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:bim-stair" icon={BimStair} active={bim('stair.place')} />
          <RibbonCommandSmallButton commandId="design:bim-railing" icon={BimRailing} active={bim('railing.place')} />
          <RibbonCommandSmallButton commandId="design:bim-room" icon={BimRoom} active={bim('room.place')} />
        </RibbonSmallStack>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:bim-grid" icon={BimGrid} active={bim('grid.place')} />
        </RibbonSmallStack>
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('foundation.group')}>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:bim-strip-foundation" icon={BimStripFoundation} active={bim('foundation.strip.place')} />
          <RibbonCommandSmallButton commandId="design:bim-pad-footing" icon={BimPadFooting} active={bim('foundation.pad.place')} />
        </RibbonSmallStack>
      </RibbonGroup>
      <RibbonGroupDivider />
      <ModifyGroup>
        <RibbonCommandSmallButton commandId="design:flip-x" icon={DoorFlipHand} />
        <RibbonCommandSmallButton commandId="design:flip-y" icon={DoorFlipSide} />
        <RibbonCommandSmallButton commandId="design:move-to-storey" icon={MoveToStorey} />
      </ModifyGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.joins')}>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:join-mitre" icon={JoinMitre} />
          <RibbonCommandSmallButton commandId="design:join-butt" icon={JoinButt} />
          <RibbonCommandSmallButton commandId="design:join-swap" icon={JoinSwap} />
        </RibbonSmallStack>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:join-auto-mitre" icon={JoinAuto} active={autoMitre} />
        </RibbonSmallStack>
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('groups.group')}>
        <RibbonCommandLargeButton commandId="design:group" icon={GroupMake} />
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:group-edit" icon={GroupEdit} active={groupEditing} />
          <RibbonCommandSmallButton commandId="design:ungroup" icon={GroupUngroup} />
          <RibbonCommandSmallButton commandId="design:group-select" icon={GroupSelect} active={selectGroups} />
        </RibbonSmallStack>
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.workplane')}>
        <RibbonCommandLargeButton commandId="design:workplane-face" icon={DraftWorkplane} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <AidsGroup />
    </>
  );
}
