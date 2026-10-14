/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The drafting session: which view is being drafted on, the running
 * command, the selection, ortho / snap toggles and the command-line
 * history. One session for the app — drafting happens in the tab in front.
 *
 * Input flows in already snapped (the view layer resolves snaps, since it
 * owns the pixel tolerance); the session applies ortho, typed coordinates
 * and command-line keywords, and drives the command state machine.
 */

import { providers } from './session-providers';
import { create } from 'zustand';
import type { TranslationKey } from '@/i18n';
import { useProjectStore } from '@/project/project-store';
import { draftCommandById, draftCommandByName } from './commands/registry';
import type { DraftCommand, DraftCommandDef, DraftContext, DraftSettings, Prompt, StepResult } from './commands/types';
import { entityBounds, nearestOnEntity, setAnnotationScreenUp } from './annotation';
import { applyOrtho, parseCoordinateInput, pointAlong } from './input';
import { drawingToUserVec, userToDrawingVec, type SectionAxisName } from './frame';
import { draftsOfView, drawRank } from './draft-store';
import type { DraftEntity, DraftShape, Pt } from './types';

export interface HistoryLine {
  key: TranslationKey;
  params?: Record<string, string | number>;
  /** What the user typed, echoed verbatim. */
  typed?: string;
}

interface SessionState {
  viewId: string | null;
  axis: SectionAxisName;
  commandId: string | null;
  /** Gathering the selection a modify command needs before it starts. */
  selecting: boolean;
  prompt: Prompt | null;
  history: HistoryLine[];
  selection: ReadonlySet<string>;
  ortho: boolean;
  /** Ctrl held down while drawing: ortho for as long as it is held. */
  orthoHeld: boolean;
  snap: boolean;
  lastCommandId: string | null;
  /** Bumped whenever the running command's internal state changes (preview refresh). */
  revision: number;
}

export const useDraftingSession = create<SessionState>()(() => ({
  viewId: null,
  axis: 'down',
  commandId: null,
  selecting: false,
  prompt: null,
  history: [],
  selection: new Set(),
  ortho: false,
  orthoHeld: false,
  snap: true,
  lastCommandId: null,
  revision: 0,
}));

const HISTORY_LINES = 50;
const settings: DraftSettings = { filletRadius: 0, offsetDistance: null, textHeight: 0.25, hatchPattern: 'LINES45', hatchScale: 1, hatchAngle: 0, extrudeClass: 'IfcBuildingElementProxy', extrudeDepth: 1,
  roofKind: 'gable', roofSystem: true, roofPick: false, roofSlope: 30, roofThickness: 0.25, roofOverhang: 0.5,
  axisLabel: '1', axisBubble: null, axisEnds: null, axisSize: null, axisLineType: null,
  currentTextStyle: 'standard', currentDimStyle: 'standard', currentAxisStyle: 'standard', currentTagType: '' };
let command: DraftCommand | null = null;
let pending: DraftCommandDef | null = null;
export { activeWorkPlane, setAnnotationProviders, setElementPicker, setModelPicker, setWorkPlaneProvider } from './session-providers';
/** The drafting settings, as the commands see them. */
export const draftSettings = (): Readonly<DraftSettings> => scaledSettings;

/**
 * The styles new annotations take; the text height setting follows the current text style (paper mm →
 * metres at 1:100). Making an axis type current restarts the axis labels at the type's first label.
 */
export function setCurrentStyles(patch: { textStyle?: string; dimStyle?: string; axisStyle?: string; firstAxisLabel?: string; textHeightMm?: number; tagType?: string }): void {
  if (patch.tagType !== undefined) settings.currentTagType = patch.tagType;
  if (patch.textStyle) settings.currentTextStyle = patch.textStyle;
  if (patch.dimStyle) settings.currentDimStyle = patch.dimStyle;
  if (patch.axisStyle) settings.currentAxisStyle = patch.axisStyle;
  if (patch.firstAxisLabel) settings.axisLabel = patch.firstAxisLabel;
  if (patch.textHeightMm) settings.textHeight = patch.textHeightMm / 10;
  set({ revision: get().revision + 1 });
}

// The project's default axis type is what AXIS starts with: on opening a
// project and whenever the default changes (Drafting standards › Axis types).
useProjectStore.subscribe((s, prev) => {
  if (s.defaultAxisStyle === prev.defaultAxisStyle) return;
  const id = s.defaultAxisStyle ?? 'standard';
  const first = s.axisStyles?.find((a) => a.id === id)?.firstLabel;
  setCurrentStyles({ axisStyle: id, ...(first ? { firstAxisLabel: first } : {}) });
});

export function currentStyles(): { textStyle: string; dimStyle: string; axisStyle: string; tagType: string } {
  return { textStyle: settings.currentTextStyle, dimStyle: settings.currentDimStyle, axisStyle: settings.currentAxisStyle, tagType: settings.currentTagType };
}

const get = () => useDraftingSession.getState();
const set = (patch: Partial<SessionState>) => useDraftingSession.setState(patch);

function say(line: HistoryLine): void {
  set({ history: [...get().history.slice(-(HISTORY_LINES - 1)), line] });
}

function visibleEntities(viewId: string): DraftEntity[] {
  const { drafts, draftLayers } = useProjectStore.getState();
  const usable = new Set(draftLayers.filter((l) => l.visible && !l.locked).map((l) => l.id));
  return draftsOfView(viewId, drafts).filter((d) => usable.has(d.layerId));
}

function context(viewId: string): DraftContext {
  const { axis } = get();
  const { kx, ky } = { kx: axis === 'side' ? -1 : 1, ky: axis !== 'down' ? -1 : 1 };
  return {
    viewId,
    layerId: currentLayerId(),
    entities: () => visibleEntities(viewId),
    referenceShapes: (min, max) => providers.references(min, max),
    closedLoops: () => providers.loops(),
    levelAt: (p) => providers.levelAt(p),
    plane: () => providers.plane(),
    viewKind: () => providers.viewKind(),
    view: () => providers.view(),
    elementAt: (p) => providers.elementAt(p),
    selection: () => get().selection,
    setSelection: (ids) => set({ selection: ids }),
    // userToDrawing is diag(kx, −ky): orientation-reversing when its determinant is negative.
    orientation: (kx * -ky) > 0 ? 1 : -1,
    settings: scaledSettings,
    say: (key, params) => say({ key, params }),
  };
}

let activeLayerId = '0';
export function currentLayerId(): string {
  const layers = useProjectStore.getState().draftLayers;
  return layers.some((l) => l.id === activeLayerId) ? activeLayerId : (layers[0]?.id ?? '0');
}
export function setCurrentLayer(id: string): void {
  activeLayerId = id;
  set({ revision: get().revision + 1 });
}

function refresh(): void {
  set({ prompt: command ? command.prompt() : get().selecting ? { key: 'drafting.prompt.selectObjects' } : null, revision: get().revision + 1 });
}

function finish(result: StepResult): void {
  if (result === 'done') {
    command = null;
    set({ commandId: null });
  }
  refresh();
}

/** Point the session at the view in front (or none). A running command is cancelled on a view change. */
/**
 * Annotation sizes (text height, hatch scale) are model metres on a view; a
 * sheet drafts in paper millimetres, where the same settings read ×10
 * (as on a 1:100 view): 0.25 m text is 2.5 mm on paper.
 */
let sizeScale = 1;

const SCALED = new Set<keyof DraftSettings>(['textHeight', 'hatchScale']);

/** The settings as commands see them on the current target. */
const scaledSettings = new Proxy(settings, {
  get: (target, key) => (SCALED.has(key as keyof DraftSettings) ? (target[key as keyof DraftSettings] as number) * sizeScale : target[key as keyof DraftSettings]),
  set: (target, key, value) => {
    (target as unknown as Record<string, unknown>)[key as string] = SCALED.has(key as keyof DraftSettings) ? Number(value) / sizeScale : value;
    return true;
  },
});

export function attachDraftingView(viewId: string | null, axis: SectionAxisName, references: (min: Pt, max: Pt) => DraftShape[], unitsScale = 1): void {
  providers.references = references;
  sizeScale = unitsScale;
  // Plans draw drawing-y downward on screen; text and marks grow up on screen.
  setAnnotationScreenUp(axis === 'down' ? -1 : 1);
  if (get().viewId === viewId && get().axis === axis) return;
  if (get().viewId !== viewId) cancelCommand();
  set({ viewId, axis, selection: get().viewId === viewId ? get().selection : new Set() });
}

export function runningCommand(): DraftCommand | null {
  return command;
}

/**
 * Where a selection command goes when nothing drafted is selected but model elements are
 * (MOVE / COPY / ROTATE / ARRAY / ERASE on BIM elements); true when it took the command.
 */
let modelEditRoute: ((id: string) => boolean) | null = null;
export function setModelEditRoute(route: typeof modelEditRoute): void {
  modelEditRoute = route;
}

export function startDraftCommand(id: string): void {
  const def = draftCommandById(id);
  const { viewId } = get();
  if (!def || !viewId) return;
  cancelCommand();
  if (def.needsSelection && get().selection.size === 0 && modelEditRoute?.(def.id)) return;
  say({ key: def.labelKey });
  set({ lastCommandId: def.id });
  if (def.needsSelection && get().selection.size === 0) {
    pending = def;
    set({ selecting: true, commandId: def.id });
    refresh();
    return;
  }
  begin(def, viewId);
}

function begin(def: DraftCommandDef, viewId: string): void {
  pending = null;
  command = def.create(context(viewId));
  set({ commandId: def.id, selecting: false });
  refresh();
}

export function cancelCommand(): void {
  if (command || pending) say({ key: 'drafting.msg.cancelled' });
  command = null;
  pending = null;
  set({ commandId: null, selecting: false });
  refresh();
}

/**
 * The entity under `p` within `tolerance` drawing units: the front-most one
 * (a contour before the face or hatch it bounds, though inside the fill
 * counts as on it), then the nearest.
 */
export function pickEntity(p: Pt, tolerance: number): DraftEntity | null {
  const { viewId } = get();
  if (!viewId) return null;
  let best: DraftEntity | null = null;
  let bestDist = tolerance;
  let bestRank = -1;
  for (const entity of visibleEntities(viewId)) {
    const d = nearestOnEntity(entity.shape, p).dist;
    const rank = drawRank(entity);
    if (d <= tolerance && (rank > bestRank || d <= bestDist)) {
      best = entity;
      bestDist = d;
      bestRank = rank;
    }
  }
  return best;
}

/** Ortho (the toggle, or Ctrl held) constrains a point against the command's base point. */
export function constrainPoint(p: Pt): Pt {
  const base = command?.basePoint() ?? null;
  return base && (get().ortho || get().orthoHeld) ? applyOrtho(base, p) : p;
}

/**
 * A click on the drawing, with the pick tolerance in drawing units. A point
 * that snapped to something stays where it snapped (object snap wins over
 * ortho); any other is constrained by ortho.
 */
export function clickDrawing(p: Pt, tolerance: number, additive: boolean, snapped = false): void {
  const { viewId, selecting } = get();
  if (!viewId) return;
  if (selecting || !command) {
    const hit = pickEntity(p, tolerance);
    // Idle, nothing drafted under the click: the click is for the model's elements.
    if (!hit && !selecting && providers.modelPicker) {
      if (!additive) set({ selection: new Set() });
      providers.modelPicker(p, tolerance, additive);
      refresh();
      return;
    }
    const next = new Set(additive || selecting ? get().selection : []);
    if (hit) {
      if (next.has(hit.id) && additive) next.delete(hit.id);
      else next.add(hit.id);
    }
    set({ selection: next });
    refresh();
    return;
  }
  if (command.input() === 'pick') {
    const hit = pickEntity(p, tolerance);
    if (hit && command.onPick) finish(command.onPick(hit, p));
    return;
  }
  if (command.onPoint) finish(command.onPoint(snapped ? p : constrainPoint(p)));
}

/** Window (fully inside) or crossing (touching) selection of a drawn rectangle. */
export function windowSelect(a: Pt, b: Pt, crossing: boolean, additive: boolean): void {
  const { viewId } = get();
  if (!viewId) return;
  const min = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  const max = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  const next = new Set(additive || get().selecting ? get().selection : []);
  for (const entity of visibleEntities(viewId)) {
    const bb = entityBounds(entity.shape);
    const inside = bb.min.x >= min.x && bb.max.x <= max.x && bb.min.y >= min.y && bb.max.y <= max.y;
    const touches = bb.max.x >= min.x && bb.min.x <= max.x && bb.max.y >= min.y && bb.min.y <= max.y;
    if (inside || (crossing && touches)) next.add(entity.id);
  }
  set({ selection: next });
  refresh();
}

/** Enter: finish the selection / the command, or repeat the last command when idle. */
export function pressEnter(): void {
  const { selecting, viewId, lastCommandId } = get();
  if (selecting && pending && viewId) {
    if (get().selection.size === 0) cancelCommand();
    else begin(pending, viewId);
    return;
  }
  if (command) {
    finish(command.onEnter ? command.onEnter() : 'done');
    return;
  }
  if (lastCommandId) startDraftCommand(lastCommandId);
}

/** Escape: cancel the command, else clear the selection. */
export function pressEscape(): void {
  if (command || pending) cancelCommand();
  else set({ selection: new Set() });
  refresh();
}

/**
 * A command-line entry. Idle: a command name. Running: a keyword, a
 * coordinate (`x,y`, `@dx,dy`, `@d<a`, `d<a`) in the user's screen-aligned
 * frame, or a bare number — a value when the step wants one, otherwise a
 * distance from the base point toward the cursor.
 */
export function submitCommandLine(text: string, cursor: Pt | null): void {
  const trimmed = text.trim();
  if (!trimmed) {
    pressEnter();
    return;
  }
  if (!command && !get().selecting) {
    const def = draftCommandByName(trimmed);
    if (def) startDraftCommand(def.id);
    else say({ key: 'drafting.msg.unknownCommand', params: { name: trimmed } });
    return;
  }
  say({ key: 'drafting.msg.typed', typed: trimmed, params: { text: trimmed } });
  if (!command) return;
  if (command.wantsText?.() && command.onText) {
    finish(command.onText(text.trim()));
    return;
  }
  const word = trimmed.toUpperCase();
  if (/^[A-Z][A-Z0-9_.-]*$/.test(word) && command.onKeyword) {
    const result = command.onKeyword(word);
    if (result) {
      finish(result);
      return;
    }
  }
  const { axis } = get();
  const base = command.basePoint();
  const parsed = parseCoordinateInput(trimmed, { last: base ? drawingToUserVec(base, axis) : null });
  if (!parsed) {
    say({ key: 'drafting.msg.invalidInput' });
    return;
  }
  if (parsed.kind === 'point') {
    if (command.onPoint) finish(command.onPoint(userToDrawingVec(parsed.pt, axis)));
    return;
  }
  if (command.wantsValue?.() && command.onValue) {
    finish(command.onValue(parsed.d));
    return;
  }
  if (base && cursor && command.onPoint) {
    finish(command.onPoint(pointAlong(base, constrainPoint(cursor), parsed.d)));
    return;
  }
  say({ key: 'drafting.msg.invalidInput' });
}

export { setDraftSelection, setOrthoHeld, toggleOrtho, toggleSnap } from './session-aids';
