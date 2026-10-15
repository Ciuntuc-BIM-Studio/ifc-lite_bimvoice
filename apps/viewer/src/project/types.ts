/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { JoineryMapping } from '@/joinery/symbol-mapping';
import type { AssemblySpec, JoinerySpec, StructureProfile } from '@ifc-lite/create';
import type { ElementTypeKind, ElementTypeSpec } from '@/element-types/spec';
import type { AxisStyle, DimStyle, LayerGroup, TagType, TextStyle } from '@/drafting/styles';

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
  /** The section line drawn on a plan, world metres (viewer frame): plans show it as the section's mark. */
  marker?: { a: [number, number, number]; b: [number, number, number] };
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
  /** A viewport region of the view (drafted entity id): the viewport is that polygon — its crop and centre follow it. */
  regionId?: string;
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
  /** Left out of the sheets canvas (still in the navigator, still exported on its own). */
  hidden?: boolean;
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

/** A road drawing (longitudinal profile or cross-section set) of a corridor: a project document of its own, placeable on sheets or drawn on a plan. */
export interface ProjectCivilDrawing {
  id: string;
  name: string;
  kind: 'profile' | 'sections';
  createdAt: number;
  /** The corridor it draws, by GlobalId (in whichever loaded model has it). */
  corridorGlobalId: string;
  /** Drawing scale denominator (profile: horizontal). */
  scale: number;
  /** Profile: vertical exaggeration, grid steps. */
  vExaggeration?: number;
  stationStep?: number;
  elevationStep?: number;
  /** Sections: sample spacing or explicit stations, layout columns, half width shown (0: automatic). */
  every?: number;
  stations?: number[];
  columns?: number;
  halfWidth?: number;
}

/**
 * How a building material draws where a view cuts it (ArchiCAD's Building
 * Materials): matched by IfcMaterial name. `hatch` null draws no hatch,
 * absent takes the default its name suggests; a membrane (or any layer under
 * 2 mm) draws as a heavy dashed line instead of a band.
 */
/** The kinds of view a material draws differently in: plans (top view), elevations (front view), sections. */
export type MaterialViewKind = 'plan' | 'elevation' | 'section';

/** How a material draws in one kind of view. */
export interface MaterialViewGraphics {
  hatch?: string | null;
  /** 1 = the pattern's own size. */
  hatchScale?: number;
  /** Fill colour; null: none (white), absent: the material's colour. */
  fill?: string | null;
  /** Pen of the hatch lines. */
  hatchPen?: CategoryLineWeight;
}

/**
 * A building material. Its own fields are its section graphics (where a
 * section cuts it); `views` overrides them for plans and gives its front
 * view (the faces an elevation sees). `color` is its surface colour: the
 * colour of its elements and layers in 3D, written into the IFC models.
 */
export interface ProjectMaterial extends MaterialViewGraphics {
  id: string;
  name: string;
  membrane?: boolean;
  color?: string;
  views?: Partial<Record<Exclude<MaterialViewKind, 'section'>, MaterialViewGraphics>>;
}

/** A typical road cross-section (assembly) kept in the project's library. */
export interface ProjectTypicalSection {
  id: string;
  name: string;
  assembly: AssemblySpec;
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
  /** Drafting standards: text, dimension and axis styles, and the groups layers are filed in. */
  textStyles?: TextStyle[];
  dimStyles?: DimStyle[];
  axisStyles?: AxisStyle[];
  /** The axis type new axes and the BIM grids in views are drawn with (absent: Standard). */
  defaultAxisStyle?: string;
  /** Element tag types: text templates mapped on element parameters. */
  tagTypes?: TagType[];
  layerGroups?: LayerGroup[];
  /** Save writes the meshes of the primary model beside its IFC, so the project opens without re-meshing (absent: on). */
  packageGeometry?: boolean;
  /** Door and window opening symbols in elevation: apex at the handle (default, window makers' sketches) or at the hinges (DIN 1356). */
  openingLines?: 'handle' | 'hinge';
  /** Plan symbol overrides by element GlobalId: bit 1 hinges a door on its other jamb, bit 2 swings it to the other side. */
  symbolFlips?: Record<string, number>;
  /** The project's door and window types (the configurator's catalogue); each is one IFC type per model it is placed in. */
  joineryTypes?: JoinerySpec[];
  /** The catalogue entry the Door / Window tools place, per kind. */
  currentJoinery?: { door?: string; window?: string };
  /** Which catalogue entry draws the doors and windows a model does not type itself (`joinery/symbol-mapping.ts`). */
  joineryMapping?: JoineryMapping;
  /** The project's wall, slab, column, beam, roof and opening types; each is one IFC type per model it is used in. */
  elementTypes?: ElementTypeSpec[];
  /** The entry each Design tool builds with, per kind. */
  currentTypes?: Partial<Record<ElementTypeKind, string>>;
  schedules?: ProjectSchedule[];
  /** The project's structure profile library (retaining walls, tunnels, decks, barriers… and drawn shapes). */
  structureProfiles?: StructureProfile[];
  /** Road drawings: longitudinal profiles and cross-section sets. */
  civilDrawings?: ProjectCivilDrawing[];
  /** Typical road cross-sections (assemblies) corridors take from. */
  typicalSections?: ProjectTypicalSection[];
  /** Building materials: how each IfcMaterial draws where it is cut. */
  materials?: ProjectMaterial[];
}
