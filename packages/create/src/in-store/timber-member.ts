/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Timber members (Lapin's Wood tab): a beam (IfcBeam), a post (IfcColumn) or
 * a brace (IfcMember BRACE) of a rectangular section, in a strength class.
 *
 * The class is the member's material: one IfcMaterial per class, named
 * "Timber C24", "Timber GL24h"… (category 'Wood'), shared by every member of
 * it and found again by name, so drawings hatch them as timber and schedules
 * group them. A new class material gets the colour of its timber (solid or
 * glued-laminated) and the WOOD hatch in section, so 3D and drawings show it
 * as timber at once. The section and the class are also on Pset_LapinTimber
 * for schedules and tags.
 */

import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { addBeamToStore } from './beam.js';
import { addColumnToStore } from './column.js';
import { addMaterialToStore, assignMaterialInStore } from './material.js';
import { emitMaterialAppearance } from './material-appearance.js';
import { addMemberToStore } from './member.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { readRelatedLists } from './resolve-relations.js';

type Vec3 = [number, number, number];

export type TimberMemberKind = 'beam' | 'post' | 'brace';

/** Solid and glued-laminated softwood classes (EN 338, EN 14080). */
export const TIMBER_GRADES = ['C16', 'C18', 'C24', 'C30', 'GL24h', 'GL28h', 'GL32h', 'GL24c', 'GL28c'] as const;

export const TIMBER_PSET = 'Pset_LapinTimber';

/** Solid softwood, and glued-laminated timber (a little warmer). */
const SOLID_COLOUR = '#d9b27c';
const GLULAM_COLOUR = '#cf9f62';

export interface TimberMemberParams {
  kind: TimberMemberKind;
  /** Storey-local metres: a beam's or brace's axis ends; a post's foot (centre) and head. */
  start: Vec3;
  end: Vec3;
  /** Section across the member, metres: width (horizontal) and depth (vertical for a beam). */
  width: number;
  depth: number;
  /** Strength class, e.g. 'C24' or 'GL24h'. */
  grade: string;
  name?: string;
  GlobalId?: string;
}

export interface TimberMemberResult {
  id: number;
  ifcClass: 'IfcBeam' | 'IfcColumn' | 'IfcMember';
}

/** The material name of a strength class. */
export const timberMaterialName = (grade: string) => `Timber ${grade}`;

/** The IfcMaterial of a strength class: the model's own if it has one by that name, else a new one. */
export function timberMaterialInStore(store: IfcDataStore, editor: StoreEditor, anchor: Pick<SpatialAnchor, 'ownerHistoryId' | 'schema' | 'guidRandom' | 'lengthUnitScale'>, grade: string, view?: MutablePropertyView | null): number {
  const name = timberMaterialName(grade);
  const reader = new AnchorEntityReader(store, view ?? editor.getMutationView());
  for (const id of reader.ids('IFCMATERIAL')) if (reader.entity(id)?.attributes[0] === name) return id;
  const materialId = addMaterialToStore(editor, anchor, { Name: name, Category: 'Wood' }).materialId;
  const bodyContextId = reader.contextId('body', reader.rootContextId());
  if (bodyContextId !== null) {
    emitMaterialAppearance(editor, String(anchor.schema ?? store.schemaVersion ?? 'IFC4'), bodyContextId, materialId, name, {
      color: /^GL/i.test(grade) ? GLULAM_COLOUR : SOLID_COLOUR, hatches: { section: { pattern: 'WOOD' } },
    });
  }
  return materialId;
}

const DEFAULT_NAMES: Record<TimberMemberKind, string> = { beam: 'Timber beam', post: 'Timber post', brace: 'Timber brace' };

/** Write one timber member with its class's material and Pset. */
export function addTimberMemberToStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, p: TimberMemberParams): TimberMemberResult {
  if (!(p.width > 0) || !(p.depth > 0)) throw new Error('addTimberMemberToStore: the section must be positive');
  const name = p.name ?? `${DEFAULT_NAMES[p.kind]} ${Math.round(p.width * 1000)}×${Math.round(p.depth * 1000)} ${p.grade}`;
  const common = { Name: name, ObjectType: p.grade, ...(p.GlobalId ? { GlobalId: p.GlobalId } : {}) };
  let made: TimberMemberResult;
  if (p.kind === 'post') {
    const height = p.end[2] - p.start[2];
    if (!(height > 0)) throw new Error('addTimberMemberToStore: a post\'s head must be above its foot');
    made = { id: addColumnToStore(editor, anchor, { Position: p.start, Width: p.width, Depth: p.depth, Height: height, ...common }).columnId, ifcClass: 'IfcColumn' };
  } else if (p.kind === 'beam') {
    made = { id: addBeamToStore(editor, anchor, { Start: p.start, End: p.end, Width: p.width, Height: p.depth, ...common }).beamId, ifcClass: 'IfcBeam' };
  } else {
    made = { id: addMemberToStore(editor, anchor, { Start: p.start, End: p.end, Width: p.width, Height: p.depth, PredefinedType: 'BRACE', ...common }).memberId, ifcClass: 'IfcMember' };
  }
  const view = editor.getMutationView();
  const material = timberMaterialInStore(store, editor, anchor, p.grade, view);
  assignMaterialInStore(editor, anchor, material, [made.id], readRelatedLists(store, 'IfcRelAssociatesMaterial', view));
  editor.addPropertySet(made.id, TIMBER_PSET, [
    { name: 'StrengthClass', value: p.grade, type: 'LABEL' },
    { name: 'Width', value: p.width, type: 'REAL' },
    { name: 'Depth', value: p.depth, type: 'REAL' },
  ]);
  return made;
}
