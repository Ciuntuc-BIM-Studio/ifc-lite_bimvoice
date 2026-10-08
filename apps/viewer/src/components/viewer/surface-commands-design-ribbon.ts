/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Design tab drafting commands (phase 4), on the ribbon (the command line
 * is their keyboard surface). Each runs the same drafting command the command line does, on
 * the drawing tab in front.
 */

import {
  DraftArc, DraftCircle, DraftCopy, DraftErase, DraftExtend, DraftFillet, DraftLine, DraftMirror, DraftMove,
  DraftOffset, DraftOrtho, DraftPolyline, DraftRectangle, DraftRotate, DraftSectionLine, DraftSnap, DraftTrim, DraftWorkplane, DraftExtrude,
  JoinAuto, JoinButt, JoinMitre, JoinSwap, DoorFlipHand, DoorFlipSide, JoineryTypes,
  DraftSweep, DraftRevolve, BimRoof, BimBeam, BimColumn, BimCurtainWall, BimDoor, BimGrid, BimOpening, BimRailing, BimRoom, BimSlab, BimStair, BimWall, BimWindow,
} from '@/icons';
import { startBimTool } from '@/project/model-command-bridge';
import { openJoinery } from '@/joinery/dialog-store';
import { useViewerStore } from '@/store';
import { renderIdGlobalId, selectedGlobalIds } from '@/project/element-guid';
import { flipSelectedJoinery } from '@/joinery/catalog';
import { toggleSymbolFlips } from '@/project/project-store';
import { changeSelectedWallJoins, defaultWallJoinStyle, setDefaultWallJoinStyle, type WallJoinChange } from '@/lib/wall-join-style';
import { startWorkPlaneFromFace } from '@/project/workplane-from-face';
import { resolve } from '@/i18n/registry';
import { toast } from '@/components/ui/toast';
import { isDrawingTabActive } from '@/project/document-tabs';
import { startDraftCommand, toggleOrtho, toggleSnap } from '@/drafting/session';
import type { SurfaceCommandDefinition } from './surface-command-types';

const ribbonOnly = ['ribbon'] as const;
const always = (): boolean => true;

/** Start a drafting command on the drawing tab in front, or say why not. */
function draft(id: string): () => void {
  return () => {
    if (!isDrawingTabActive()) {
      toast.info(resolve('drafting.needsView'));
      return;
    }
    startDraftCommand(id);
  };
}

const bim = (id: string) => () => startBimTool(id);

/** Slab: the slab command draws a slab (it also draws flat roofs and plates). */
function slab(): void {
  useViewerStore.getState().setAuthoringDefaults({ slabClass: 'slab' });
  startBimTool('slab.place');
}

/** Restyle the selected walls' corners, and say what happened. */
function joins(change: WallJoinChange): () => void {
  return () => {
    const outcome = changeSelectedWallJoins(change);
    if (!outcome.ok) toast.error(resolve('drafting.msg.joinFailed', { detail: outcome.reason }));
    else if (outcome.corners === 0) toast.info(resolve('drafting.msg.noJoins'));
    else toast.success(resolve('drafting.msg.joinsChanged', { count: outcome.corners }));
  };
}

/** Flip the plan symbol of the selected doors (hinge jamb: bit 1, swing side: bit 2). */
function flipDoors(bit: 1 | 2): () => void {
  return () => {
    if (selectedGlobalIds().length === 0) { toast.info(resolve('drafting.msg.selectDoors')); return; }
    // Configured doors / windows turn in the model; the others flip their plan symbol only.
    const rest = flipSelectedJoinery(bit).map(renderIdGlobalId).filter((g): g is string => !!g);
    toggleSymbolFlips(rest, bit);
  };
}

function toggleAutoMitre(): void {
  const style = defaultWallJoinStyle() === 'mitre' ? 'butt' : 'mitre';
  setDefaultWallJoinStyle(style);
  toast.info(resolve('drafting.msg.autoJoin', { style: resolve(style === 'mitre' ? 'drafting.join.mitre' : 'drafting.join.butt') }));
}

export const RIBBON_DESIGN_SURFACE_COMMANDS = [
  { id: 'design:bim-wall', labelKey: 'drafting.bim.wall', keywords: 'wall bim parametric place joins', category: 'Tools', icon: BimWall, surfaces: ribbonOnly, enabled: always, run: bim('wall.place') },
  { id: 'design:bim-slab', labelKey: 'drafting.bim.slab', keywords: 'slab floor bim parametric place', category: 'Tools', icon: BimSlab, surfaces: ribbonOnly, enabled: always, run: slab },
  { id: 'design:bim-roof', labelKey: 'drafting.bim.roof', keywords: 'roof flat mono shed gable hip pitch bim', category: 'Tools', icon: BimRoof, surfaces: ribbonOnly, enabled: always, run: draft('roof') },
  { id: 'design:bim-column', labelKey: 'drafting.bim.column', keywords: 'column pillar bim parametric place', category: 'Tools', icon: BimColumn, surfaces: ribbonOnly, enabled: always, run: bim('column.place') },
  { id: 'design:bim-beam', labelKey: 'drafting.bim.beam', keywords: 'beam bim parametric place', category: 'Tools', icon: BimBeam, surfaces: ribbonOnly, enabled: always, run: bim('beam.place') },
  { id: 'design:bim-door', labelKey: 'drafting.bim.door', keywords: 'door hosted void bim place', category: 'Tools', icon: BimDoor, surfaces: ribbonOnly, enabled: always, run: bim('door.place') },
  { id: 'design:bim-window', labelKey: 'drafting.bim.window', keywords: 'window hosted void bim place', category: 'Tools', icon: BimWindow, surfaces: ribbonOnly, enabled: always, run: bim('window.place') },
  { id: 'design:bim-opening', labelKey: 'drafting.bim.opening', keywords: 'opening void hole bim place', category: 'Tools', icon: BimOpening, surfaces: ribbonOnly, enabled: always, run: bim('opening.place') },
  { id: 'design:bim-stair', labelKey: 'drafting.bim.stair', keywords: 'stair steps bim place', category: 'Tools', icon: BimStair, surfaces: ribbonOnly, enabled: always, run: bim('stair.place') },
  { id: 'design:bim-railing', labelKey: 'drafting.bim.railing', keywords: 'railing guard bim place', category: 'Tools', icon: BimRailing, surfaces: ribbonOnly, enabled: always, run: bim('railing.place') },
  { id: 'design:bim-curtain-wall', labelKey: 'drafting.bim.curtainWall', keywords: 'curtain wall facade glazing bim place', category: 'Tools', icon: BimCurtainWall, surfaces: ribbonOnly, enabled: always, run: bim('curtainwall.place') },
  { id: 'design:bim-grid', labelKey: 'drafting.bim.grid', keywords: 'grid axis bim place', category: 'Tools', icon: BimGrid, surfaces: ribbonOnly, enabled: always, run: bim('grid.place') },
  { id: 'design:join-mitre', labelKey: 'drafting.join.mitre', keywords: 'wall join corner mitre miter diagonal', category: 'Tools', icon: JoinMitre, surfaces: ribbonOnly, enabled: always, run: joins({ style: 'mitre' }) },
  { id: 'design:join-butt', labelKey: 'drafting.join.butt', keywords: 'wall join corner butt square', category: 'Tools', icon: JoinButt, surfaces: ribbonOnly, enabled: always, run: joins({ style: 'butt' }) },
  { id: 'design:join-swap', labelKey: 'drafting.join.swap', keywords: 'wall join corner swap priority through', category: 'Tools', icon: JoinSwap, surfaces: ribbonOnly, enabled: always, run: joins({ swap: true }) },
  { id: 'design:join-auto-mitre', labelKey: 'drafting.join.autoMitre', keywords: 'wall join automatic default mitre corners', category: 'Tools', icon: JoinAuto, surfaces: ribbonOnly, enabled: always, run: toggleAutoMitre },
  { id: 'design:joinery', labelKey: 'joinery.open', keywords: 'door window type configurator catalogue joinery frame sash tilt turn schedule', category: 'Tools', icon: JoineryTypes, surfaces: ribbonOnly, enabled: always, run: () => openJoinery() },
  { id: 'design:door-flip-hand', labelKey: 'drafting.door.flipHand', keywords: 'door swing hinge hand flip plan symbol', category: 'Tools', icon: DoorFlipHand, surfaces: ribbonOnly, enabled: always, run: flipDoors(1) },
  { id: 'design:door-flip-side', labelKey: 'drafting.door.flipSide', keywords: 'door swing side flip plan symbol', category: 'Tools', icon: DoorFlipSide, surfaces: ribbonOnly, enabled: always, run: flipDoors(2) },
  { id: 'design:bim-room', labelKey: 'drafting.bim.room', keywords: 'room space bim place', category: 'Tools', icon: BimRoom, surfaces: ribbonOnly, enabled: always, run: bim('room.place') },
  { id: 'design:line', labelKey: 'drafting.tool.line', keywords: 'draw line segment cad L', category: 'Tools', icon: DraftLine, surfaces: ribbonOnly, enabled: always, run: draft('line') },
  { id: 'design:polyline', labelKey: 'drafting.tool.polyline', keywords: 'draw polyline pline cad PL', category: 'Tools', icon: DraftPolyline, surfaces: ribbonOnly, enabled: always, run: draft('polyline') },
  { id: 'design:rectangle', labelKey: 'drafting.tool.rectangle', keywords: 'draw rectangle rect cad REC', category: 'Tools', icon: DraftRectangle, surfaces: ribbonOnly, enabled: always, run: draft('rectangle') },
  { id: 'design:circle', labelKey: 'drafting.tool.circle', keywords: 'draw circle radius cad C', category: 'Tools', icon: DraftCircle, surfaces: ribbonOnly, enabled: always, run: draft('circle') },
  { id: 'design:arc', labelKey: 'drafting.tool.arc', keywords: 'draw arc three points cad A', category: 'Tools', icon: DraftArc, surfaces: ribbonOnly, enabled: always, run: draft('arc') },
  { id: 'design:move', labelKey: 'drafting.tool.move', keywords: 'move displace drafting M', category: 'Tools', icon: DraftMove, surfaces: ribbonOnly, enabled: always, run: draft('move') },
  { id: 'design:copy', labelKey: 'drafting.tool.copy', keywords: 'copy duplicate drafting CO', category: 'Tools', icon: DraftCopy, surfaces: ribbonOnly, enabled: always, run: draft('copy') },
  { id: 'design:rotate', labelKey: 'drafting.tool.rotate', keywords: 'rotate angle drafting RO', category: 'Tools', icon: DraftRotate, surfaces: ribbonOnly, enabled: always, run: draft('rotate') },
  { id: 'design:mirror', labelKey: 'drafting.tool.mirror', keywords: 'mirror reflect drafting MI', category: 'Tools', icon: DraftMirror, surfaces: ribbonOnly, enabled: always, run: draft('mirror') },
  { id: 'design:erase', labelKey: 'drafting.tool.erase', keywords: 'erase delete drafting E', category: 'Tools', icon: DraftErase, surfaces: ribbonOnly, enabled: always, run: draft('erase') },
  { id: 'design:offset', labelKey: 'drafting.tool.offset', keywords: 'offset parallel drafting O', category: 'Tools', icon: DraftOffset, surfaces: ribbonOnly, enabled: always, run: draft('offset') },
  { id: 'design:trim', labelKey: 'drafting.tool.trim', keywords: 'trim cut drafting TR', category: 'Tools', icon: DraftTrim, surfaces: ribbonOnly, enabled: always, run: draft('trim') },
  { id: 'design:extend', labelKey: 'drafting.tool.extend', keywords: 'extend lengthen boundary drafting EX', category: 'Tools', icon: DraftExtend, surfaces: ribbonOnly, enabled: always, run: draft('extend') },
  { id: 'design:fillet', labelKey: 'drafting.tool.fillet', keywords: 'fillet round corner radius drafting F', category: 'Tools', icon: DraftFillet, surfaces: ribbonOnly, enabled: always, run: draft('fillet') },
  { id: 'design:section-line', labelKey: 'drafting.tool.sectionLine', keywords: 'section line cut work plane vertical', category: 'Tools', icon: DraftSectionLine, surfaces: ribbonOnly, enabled: always, run: draft('sectionline') },
  { id: 'design:workplane-face', labelKey: 'drafting.tool.workplaneFace', keywords: 'work plane face pick any orientation', category: 'Tools', icon: DraftWorkplane, surfaces: ribbonOnly, enabled: always, run: () => startWorkPlaneFromFace() },
  { id: 'design:extrude', labelKey: 'drafting.tool.extrude', keywords: 'extrude contour profile ifc element solid', category: 'Tools', icon: DraftExtrude, surfaces: ribbonOnly, enabled: always, run: draft('extrude') },
  { id: 'design:sweep', labelKey: 'drafting.tool.sweep', keywords: 'sweep profile path rail cornice solid', category: 'Tools', icon: DraftSweep, surfaces: ribbonOnly, enabled: always, run: draft('sweep') },
  { id: 'design:revolve', labelKey: 'drafting.tool.revolve', keywords: 'revolve rotate lathe profile axis solid', category: 'Tools', icon: DraftRevolve, surfaces: ribbonOnly, enabled: always, run: draft('revolve') },
  { id: 'design:snap', labelKey: 'drafting.snap', keywords: 'object snap osnap toggle F3', category: 'Tools', icon: DraftSnap, surfaces: ribbonOnly, enabled: always, run: () => toggleSnap() },
  { id: 'design:ortho', labelKey: 'drafting.ortho', keywords: 'ortho orthogonal toggle F8', category: 'Tools', icon: DraftOrtho, surfaces: ribbonOnly, enabled: always, run: () => toggleOrtho() },
] as const satisfies readonly SurfaceCommandDefinition[];
