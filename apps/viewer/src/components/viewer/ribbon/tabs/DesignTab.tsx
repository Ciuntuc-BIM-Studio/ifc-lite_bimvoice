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
  DraftOffset, DraftOrtho, DraftPolyline, DraftRectangle, DraftRotate, DraftSectionLine, DraftSnap, DraftTrim, DraftWorkplane, DraftExtrude,
  BuildingMaterials, JoinAuto, JoinButt, JoinMitre, JoinSwap, GroupMake, GroupUngroup, GroupEdit, GroupSelect, MoveToStorey, DoorFlipHand, JoineryTypes, ElementTypes, RoofSystem, DoorFlipSide, CutPriority,
  DraftSweep, DraftRevolve, BimRoof, BimBeam, BimColumn, BimCurtainWall, BimDoor, BimGrid, BimOpening, BimRailing, BimRoom, BimSlab, BimStair, BimWall, BimWindow,
} from '@/icons';
import { useViewerStore } from '@/store';
import { useWallJoinPrefs } from '@/lib/wall-join-prefs';
import { useTranslation } from '@/i18n';
import { useDraftingSession } from '@/drafting/session';
import { useDrafting3dPref } from '@/lib/drafting-3d-prefs';
import { useGroupEdit, useGroupPrefs } from '@/project/element-groups';
import { RibbonGroup, RibbonGroupDivider, RibbonSmallStack } from '../primitives';
import { RibbonCommandLargeButton, RibbonCommandSmallButton } from '../command-button';

export function DesignTab() {
  const { t } = useTranslation();
  const commandId = useDraftingSession((s) => s.commandId);
  const snap = useDraftingSession((s) => s.snap);
  const ortho = useDraftingSession((s) => s.ortho);
  const on = (id: string) => commandId === id;
  const modelCommand = useViewerStore((s) => s.session?.activeCommandId ?? null);
  const bim = (id: string) => modelCommand === id;
  const autoMitre = useWallJoinPrefs((s) => s.style === 'mitre');
  const drafting3d = useDrafting3dPref((s) => s.show);
  const selectGroups = useGroupPrefs((s) => s.selectGroups);
  const groupEditing = useGroupEdit((s) => s.editing !== null);

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
      <RibbonGroup label={t('drafting.group.bim')}>
        <RibbonCommandLargeButton commandId="design:bim-wall" icon={BimWall} active={bim('wall.place')} />
        <RibbonCommandLargeButton commandId="design:bim-slab" icon={BimSlab} active={bim('slab.place')} />
        <RibbonCommandLargeButton commandId="design:bim-roof" icon={BimRoof} active={on('roof')} />
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
          <RibbonCommandSmallButton commandId="design:flip-x" icon={DoorFlipHand} />
          <RibbonCommandSmallButton commandId="design:flip-y" icon={DoorFlipSide} />
        </RibbonSmallStack>
        <RibbonCommandLargeButton commandId="design:element-types" icon={ElementTypes} />
        <RibbonCommandLargeButton commandId="design:materials" icon={BuildingMaterials} />
        <RibbonCommandLargeButton commandId="design:joinery" icon={JoineryTypes} />
        <RibbonCommandLargeButton commandId="design:roof-system" icon={RoofSystem} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.joins')}>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:join-mitre" icon={JoinMitre} />
          <RibbonCommandSmallButton commandId="design:join-butt" icon={JoinButt} />
          <RibbonCommandSmallButton commandId="design:join-swap" icon={JoinSwap} />
        </RibbonSmallStack>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:join-auto-mitre" icon={JoinAuto} active={autoMitre} />
          <RibbonCommandSmallButton commandId="design:cut-priorities" icon={CutPriority} />
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
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:move-to-storey" icon={MoveToStorey} />
        </RibbonSmallStack>
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.model')}>
        <RibbonCommandLargeButton commandId="design:extrude" icon={DraftExtrude} active={on('extrude')} />
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:sweep" icon={DraftSweep} active={on('sweep')} />
          <RibbonCommandSmallButton commandId="design:revolve" icon={DraftRevolve} active={on('revolve')} />
        </RibbonSmallStack>
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.workplane')}>
        <RibbonCommandLargeButton commandId="design:section-line" icon={DraftSectionLine} active={on('sectionline')} />
        <RibbonCommandLargeButton commandId="design:workplane-face" icon={DraftWorkplane} />
      </RibbonGroup>
      <RibbonGroupDivider />
      <RibbonGroup label={t('drafting.group.aids')}>
        <RibbonSmallStack>
          <RibbonCommandSmallButton commandId="design:snap" icon={DraftSnap} active={snap} />
          <RibbonCommandSmallButton commandId="design:ortho" icon={DraftOrtho} active={ortho} />
          <RibbonCommandSmallButton commandId="design:drafting-3d" icon={DraftLine} active={drafting3d} />
        </RibbonSmallStack>
      </RibbonGroup>
    </>
  );
}
