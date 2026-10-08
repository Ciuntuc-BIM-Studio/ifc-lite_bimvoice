/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { JoinerySpec } from '@ifc-lite/create';
import type { ElementTypeKind, ElementTypeSpec } from '@/element-types/spec';
import type { DimStyle, LayerGroup, TextStyle } from '@/drafting/styles';

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
  /** The view's own graphics (Visibility / Graphics): a preset and per-category overrides. */
  graphics?: ViewGraphics;
  /** Drawing scale denominator (100 = 1:100). Annotation sizes follow it; absent = 1:100. */
  scale?: number;
  /** Drafting layers this view hides (by id), over their own switches. */
  hiddenLayers?: string[];
}

export type CategoryLineWeight = 'heavy' | 'medium' | 'light' | 'hairline';

/** How one element category draws in a view. Absent fields keep the preset's look. */
export interface CategoryGraphics {
  visible?: boolean;
  lineColor?: string;
  fillColor?: string;
  lineWeight?: CategoryLineWeight;
  /** A hatch pattern name (built-in or imported .pat) drawn over the category's cut faces. */
  cutHatch?: string;
  /** Hatch scale (1 = the pattern's own size in drawing millimetres). */
  hatchScale?: number;
}

export interface ViewGraphics {
  /** A built-in graphic override preset id; absent = the default, null = none. */
  presetId?: string | null;
  /** By category id (`VIEW_CATEGORIES`). */
  categories?: Record<string, CategoryGraphics>;
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

export type PaperSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';

/** A view placed on a sheet. Positions and sizes are paper millimetres from the sheet's top-left. */
export interface SheetViewport {
  id: string;
  viewId: string;
  /** Centre of the viewport on the paper. */
  x: number;
  y: number;
  /** Drawing scale denominator: 100 means 1:100. */
  scale: number;
  /** Crop box on the paper; the drawing is clipped to it. 0 × 0 means "fit the drawing". */
  width: number;
  height: number;
  /** Drawing point (metres) shown at the viewport centre; `null` centres the drawing. */
  center: { x: number; y: number } | null;
  /** Drafting layers this viewport hides, on top of its view's. */
  hiddenLayers?: string[];
}

export interface ProjectSheet {
  id: string;
  /** Sheet number as printed in the title block, e.g. "A-101". */
  number: string;
  name: string;
  createdAt: number;
  paper?: PaperSize;
  orientation?: 'landscape' | 'portrait';
  viewports?: SheetViewport[];
  /** Free title-block fields (project, drawn by, date, revision…). */
  titleBlock?: Record<string, string>;
}

/** The identity of a model a project refers to (content hash, else its name). */
export interface ProjectModelRef {
  key: string;
  name: string;
}

/** A joinery schedule (door / window list): a project document of its own, placeable on sheets. */
export interface ProjectSchedule {
  id: string;
  name: string;
  /** Which elements it lists. */
  kind: 'door' | 'window' | 'all';
  createdAt: number;
  /** Scale of its drawings (50 = 1:50). */
  scale?: number;
}

export interface ProjectDocument {
  name: string;
  models: ProjectModelRef[];
  views: ProjectView[];
  sheets: ProjectSheet[];
  /** Drafted geometry, each entity on one view (phase 4). */
  drafts: DraftEntity[];
  draftLayers: DraftLayer[];
  /** User-imported hatch patterns, as `.pat` text (built-ins are not stored). */
  hatchPatterns?: string;
  /** Drafting standards: text and dimension styles, and the groups layers are filed in. */
  textStyles?: TextStyle[];
  dimStyles?: DimStyle[];
  layerGroups?: LayerGroup[];
  /** Plan symbol overrides by element GlobalId: bit 1 hinges a door on its other jamb, bit 2 swings it to the other side. */
  symbolFlips?: Record<string, number>;
  /** The project's door and window types (the configurator's catalogue); each is one IFC type per model it is placed in. */
  joineryTypes?: JoinerySpec[];
  /** The catalogue entry the Door / Window tools place, per kind. */
  currentJoinery?: { door?: string; window?: string };
  /** The project's wall, slab, column, beam, roof and opening types; each is one IFC type per model it is used in. */
  elementTypes?: ElementTypeSpec[];
  /** The entry each Design tool builds with, per kind. */
  currentTypes?: Partial<Record<ElementTypeKind, string>>;
  schedules?: ProjectSchedule[];
}
