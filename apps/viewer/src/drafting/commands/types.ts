/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The drafting command contract: a small state machine driven by the
 * session (`../session.ts`) from clicks, picks and the command line.
 * Commands never touch the stores directly except through `DraftContext`.
 */

import type { TranslationKey } from '@/i18n';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { ProjectView } from '@/project/types';
import type { DraftEntity, DraftShape, Pt } from '../types';

export type StepResult = 'continue' | 'done';

export interface Prompt {
  key: TranslationKey;
  params?: Record<string, string | number>;
}

/** What a click on the drawing means at the current step. */
export type InputKind = 'point' | 'pick';

export interface DraftContext {
  viewId: string;
  layerId: string;
  /** The view's drafted entities on visible, unlocked layers. */
  entities(): DraftEntity[];
  /** Generated drawing lines near a region, as line shapes (trim/extend boundaries). */
  referenceShapes(min: Pt, max: Pt): DraftShape[];
  selection(): ReadonlySet<string>;
  setSelection(ids: ReadonlySet<string>): void;
  /** Closed loops a hatch can fill: drafted closed shapes and the drawing's cut outlines. */
  closedLoops(): Pt[][];
  /** The height (m) a level mark at this drawing point reports. */
  levelAt(p: Pt): number;
  /** The view's work plane (world units), when known. */
  plane(): SectionPlaneConfig | null;
  /** The kind of view being drafted on. */
  viewKind(): 'plan' | 'section' | 'elevation' | null;
  /** The project view being drafted on. */
  view(): ProjectView | null;
  /** The model element (renderer id) drawn under a drawing point, or null. */
  elementAt(p: Pt): number | null;
  /** +1, or −1 when the drawing is mirrored on screen (a user CCW angle is CW in drawing space). */
  orientation: 1 | -1;
  settings: DraftSettings;
  /** Echo a line into the command history. */
  say(key: TranslationKey, params?: Record<string, string | number>): void;
}

export interface DraftSettings {
  filletRadius: number;
  offsetDistance: number | null;
  /** Annotation text height, model metres. */
  textHeight: number;
  hatchPattern: string;
  hatchScale: number;
  hatchAngle: number;
  extrudeClass: string;
  extrudeDepth: number;
  roofKind: 'flat' | 'mono' | 'gable' | 'hip';
  /** Build a roof system (per-edge rules, covering and structure as parts) rather than one solid. */
  roofSystem: boolean;
  /** ROOF picks an existing closed contour (PICK) rather than drawing the roof's own outline (DRAW, the default). */
  roofPick: boolean;
  /** Degrees. */
  roofSlope: number;
  roofThickness: number;
  roofOverhang: number;
  /** The styles new annotations take. */
  currentTextStyle: string;
  currentDimStyle: string;
}

export interface DraftCommand {
  prompt(): Prompt;
  input(): InputKind;
  /** The rubber-band origin: ortho/polar and typed distances measure from it. */
  basePoint(): Pt | null;
  onPoint?(p: Pt): StepResult;
  onPick?(entity: DraftEntity, at: Pt): StepResult;
  /** A bare typed number when the step wants a value (radius, angle, distance) rather than a point. */
  wantsValue?(): boolean;
  onValue?(value: number): StepResult;
  /** The step wants free text (a note, a label): the whole line goes to `onText`. */
  wantsText?(): boolean;
  onText?(text: string): StepResult;
  /** A typed keyword (e.g. "C" to close); `undefined` if not understood. */
  onKeyword?(word: string): StepResult | undefined;
  onEnter?(): StepResult;
  preview?(cursor: Pt): DraftShape[];
}

export interface DraftCommandDef {
  id: string;
  /** Command-line names, upper case (the first is the canonical name). */
  aliases: string[];
  labelKey: TranslationKey;
  /** Modify commands act on a selection, gathered first when empty. */
  needsSelection?: boolean;
  create(ctx: DraftContext): DraftCommand;
}
