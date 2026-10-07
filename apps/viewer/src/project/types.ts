/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project document: the views and sheets a user organises over the
 * loaded models, Revit/ArchiCAD style. A view is a persistent project
 * object; opening one only points the live section / camera at it. The
 * whole document round-trips through the `.ifclite-project.json` sidecar
 * file kept next to the IFC files (`project-file.ts`).
 */

import type { CameraViewpoint, SectionPlaneAxis } from '@/store/types';
import type { CustomSectionPlane } from '@/store/section-types';
import type { DraftEntity, DraftLayer } from '@/drafting/types';

export type ProjectViewKind = 'plan' | 'section' | 'elevation' | '3d';

/** The facade an elevation looks at (project north = IFC +Y). */
export type ElevationDirection = 'north' | 'south' | 'east' | 'west';

/** A building level, merged across federated models at the same elevation. */
export interface ProjectLevel {
  name: string;
  /** Floor elevation, metres, in the same frame the section bar uses. */
  elevation: number;
  /** IfcBuildingStorey GlobalIds (one per model that has this level). */
  storeyGlobalIds: string[];
}

interface ProjectViewBase {
  id: string;
  name: string;
  /** Created by the default-view generator rather than the user. */
  auto?: boolean;
  createdAt: number;
  /**
   * View depth: how far beyond the cut plane the view sees, metres. `null`
   * or absent is the view kind's default — a plan shows the cut only, a
   * section / elevation projects with the automatic depth bands.
   */
  viewDepth?: number | null;
}

export interface PlanProjectView extends ProjectViewBase {
  kind: 'plan';
  level: ProjectLevel;
  /** Cut height above the level's floor, metres. */
  cutHeight: number;
}

/** A section cut stored in world metres, independent of the model bounds. */
export interface SectionProjectPlane {
  axis: SectionPlaneAxis;
  /** World coordinate along the axis, metres (viewer frame). */
  offset: number;
  flipped: boolean;
  custom?: CustomSectionPlane;
}

export interface SectionProjectView extends ProjectViewBase {
  kind: 'section';
  plane: SectionProjectPlane;
}

export interface ElevationProjectView extends ProjectViewBase {
  kind: 'elevation';
  direction: ElevationDirection;
}

export interface ThreeDProjectView extends ProjectViewBase {
  kind: '3d';
  /** `null` means "the default 3D view": fit the whole model. */
  viewpoint: CameraViewpoint | null;
}

export type ProjectView = PlanProjectView | SectionProjectView | ElevationProjectView | ThreeDProjectView;

/** A view as handed to `addProjectView`: the store assigns `createdAt` (and `id` unless given). */
export type NewProjectView = ProjectView extends infer V
  ? V extends ProjectView ? Omit<V, 'id' | 'createdAt'> & { id?: string } : never
  : never;

/** A settings change for one view kind (`updateProjectView`); id and kind never change. */
export type ProjectViewPatch = ProjectView extends infer V
  ? V extends ProjectView ? Partial<Omit<V, 'id' | 'kind'>> : never
  : never;

export interface ProjectSheet {
  id: string;
  /** Sheet number as printed in the title block, e.g. "A-101". */
  number: string;
  name: string;
  createdAt: number;
}

/** The identity of a model a project refers to (content hash, else its name). */
export interface ProjectModelRef {
  key: string;
  name: string;
}

export interface ProjectDocument {
  name: string;
  models: ProjectModelRef[];
  views: ProjectView[];
  sheets: ProjectSheet[];
  /** Drafted geometry, each entity on one view (phase 4). */
  drafts: DraftEntity[];
  draftLayers: DraftLayer[];
}
