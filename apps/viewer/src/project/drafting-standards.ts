/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's drafting standards as actions: layers and layer groups,
 * layer visibility per view and per sheet viewport, text and dimension
 * styles, and the per-element style / overrides.
 *
 * Annotation heights live on the shapes (drawing units, what picking and
 * snapping measure); a style holds them in paper millimetres. So whenever a
 * style, an element's style or a view's scale changes, the heights of the
 * annotations it governs are recomputed — except where the element
 * overrides its height (`o.height`, paper mm).
 */

import {
  DEFAULT_DIM_STYLE, DEFAULT_TEXT_STYLE, overrideKey, resolveText, STANDARD,
  type DimStyle, type LayerGroup, type StyleBook, type TextStyle,
} from '@/drafting/styles';
import type { DraftEntity, DraftLayer, DraftParamValue, EntityShape } from '@/drafting/types';
import { useProjectStore } from './project-store';
import { freshProjectId } from './view-defaults';

type State = ReturnType<typeof useProjectStore.getState>;

const book = (s: State): StyleBook => ({
  textStyles: s.textStyles?.length ? s.textStyles : [DEFAULT_TEXT_STYLE],
  dimStyles: s.dimStyles?.length ? s.dimStyles : [DEFAULT_DIM_STYLE],
});

export function styleBook(): StyleBook {
  return book(useProjectStore.getState());
}

/** Drawing units per paper millimetre where an entity lives: a view's scale / 1000, a sheet's 1. */
export function paperUnitOf(viewId: string, s: State = useProjectStore.getState()): number {
  if (s.sheets.some((sheet) => sheet.id === viewId)) return 1;
  return (s.views.find((v) => v.id === viewId)?.scale ?? 100) / 1000;
}

const sized = (shape: EntityShape): shape is Extract<EntityShape, { height: number }> => 'height' in shape && typeof (shape as { height?: unknown }).height === 'number';

/** The height an annotation should have under its style (or its override). */
function styledHeight(entity: DraftEntity, s: State): number | null {
  if (!sized(entity.shape)) return null;
  const mm = resolveText(book(s), entity.params).height;
  return mm * paperUnitOf(entity.viewId, s);
}

/** Re-apply style heights to `drafts` (all, or those `which` selects). Returns the same array when nothing changes. */
function restyle(s: State, drafts: readonly DraftEntity[], which: (d: DraftEntity) => boolean = () => true): DraftEntity[] {
  let changed = false;
  const next = drafts.map((d) => {
    if (!which(d)) return d;
    const h = styledHeight(d, s);
    if (h === null || !sized(d.shape) || Math.abs(d.shape.height - h) < 1e-9) return d;
    changed = true;
    return { ...d, shape: { ...d.shape, height: h } };
  });
  return changed ? next : (drafts as DraftEntity[]);
}

function commit(patch: Partial<State>): void {
  const s = { ...useProjectStore.getState(), ...patch };
  const drafts = restyle(s, s.drafts);
  useProjectStore.setState({ ...patch, ...(drafts !== s.drafts ? { drafts } : {}), dirty: true });
}

/** A new annotation takes its style: style ids by kind, and an `o.height` when its height is not the style's. */
export function styledParams(viewId: string, shape: EntityShape, current: { textStyle: string; dimStyle: string }): Record<string, DraftParamValue> {
  if (!sized(shape)) return {};
  const s = useProjectStore.getState();
  const dimensional = shape.type === 'dimension' || shape.type === 'radial' || shape.type === 'angular';
  const params: Record<string, DraftParamValue> = dimensional ? { dimStyle: current.dimStyle } : { textStyle: current.textStyle };
  const mm = shape.height / paperUnitOf(viewId, s);
  if (Math.abs(mm - resolveText(book(s), params).height) > 1e-6) params[overrideKey('height')] = Number(mm.toFixed(3));
  return params;
}

// ─── Layers and groups ────────────────────────────────────────────────────

export function addLayer(name: string, group?: string): string {
  const id = freshProjectId('layer');
  const s = useProjectStore.getState();
  const layer: DraftLayer = { id, name, color: '#18181b', visible: true, locked: false, ...(group ? { group } : {}) };
  useProjectStore.setState({ draftLayers: [...s.draftLayers, layer], dirty: true });
  return id;
}

export function updateLayer(id: string, patch: Partial<Omit<DraftLayer, 'id'>>): void {
  const s = useProjectStore.getState();
  useProjectStore.setState({ draftLayers: s.draftLayers.map((l) => (l.id === id ? { ...l, ...patch } : l)), dirty: true });
}

/** Remove a layer; its entities move to layer 0. Layer 0 stays. */
export function removeLayer(id: string): void {
  if (id === '0') return;
  const s = useProjectStore.getState();
  useProjectStore.setState({
    draftLayers: s.draftLayers.filter((l) => l.id !== id),
    drafts: s.drafts.map((d) => (d.layerId === id ? { ...d, layerId: '0' } : d)),
    dirty: true,
  });
}

export function addLayerGroup(name: string): string {
  const id = freshProjectId('group');
  const s = useProjectStore.getState();
  useProjectStore.setState({ layerGroups: [...(s.layerGroups ?? []), { id, name, visible: true, locked: false }], dirty: true });
  return id;
}

export function updateLayerGroup(id: string, patch: Partial<Omit<LayerGroup, 'id'>>): void {
  const s = useProjectStore.getState();
  useProjectStore.setState({ layerGroups: (s.layerGroups ?? []).map((g) => (g.id === id ? { ...g, ...patch } : g)), dirty: true });
}

/** Remove a group; its layers stay, ungrouped. */
export function removeLayerGroup(id: string): void {
  const s = useProjectStore.getState();
  useProjectStore.setState({
    layerGroups: (s.layerGroups ?? []).filter((g) => g.id !== id),
    draftLayers: s.draftLayers.map((l) => (l.group === id ? { ...l, group: undefined } : l)),
    dirty: true,
  });
}

const toggled = (list: readonly string[] | undefined, id: string) => (list?.includes(id) ? list.filter((x) => x !== id) : [...(list ?? []), id]);

/** Show / hide a layer (or every layer of a group) in one view only. */
export function toggleViewLayers(viewId: string, layerIds: readonly string[], hide: boolean): void {
  const s = useProjectStore.getState();
  useProjectStore.setState({
    views: s.views.map((v) => {
      if (v.id !== viewId) return v;
      const hidden = new Set(v.hiddenLayers ?? []);
      for (const id of layerIds) (hide ? hidden.add(id) : hidden.delete(id));
      return { ...v, hiddenLayers: [...hidden] };
    }),
    dirty: true,
  });
}

export function toggleViewportLayer(sheetId: string, viewportId: string, layerId: string): void {
  const s = useProjectStore.getState();
  useProjectStore.setState({
    sheets: s.sheets.map((sheet) => sheet.id !== sheetId ? sheet : {
      ...sheet,
      viewports: (sheet.viewports ?? []).map((vp) => (vp.id === viewportId ? { ...vp, hiddenLayers: toggled(vp.hiddenLayers, layerId) } : vp)),
    }),
    dirty: true,
  });
}

// ─── Styles ───────────────────────────────────────────────────────────────

export function addTextStyle(from: TextStyle, name: string): string {
  const id = freshProjectId('text');
  const s = useProjectStore.getState();
  commit({ textStyles: [...book(s).textStyles, { ...from, id, name }] });
  return id;
}

export function updateTextStyle(id: string, patch: Partial<Omit<TextStyle, 'id'>>): void {
  const s = useProjectStore.getState();
  commit({ textStyles: book(s).textStyles.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}

/** Remove a style (not Standard): what used it falls back to Standard. */
export function removeTextStyle(id: string): void {
  if (id === STANDARD) return;
  const s = useProjectStore.getState();
  commit({
    textStyles: book(s).textStyles.filter((t) => t.id !== id),
    dimStyles: book(s).dimStyles.map((d) => (d.textStyle === id ? { ...d, textStyle: STANDARD } : d)),
    drafts: s.drafts.map((d) => (d.params.textStyle === id ? { ...d, params: { ...d.params, textStyle: STANDARD } } : d)),
  });
}

export function addDimStyle(from: DimStyle, name: string): string {
  const id = freshProjectId('dim');
  const s = useProjectStore.getState();
  commit({ dimStyles: [...book(s).dimStyles, { ...from, id, name }] });
  return id;
}

export function updateDimStyle(id: string, patch: Partial<Omit<DimStyle, 'id'>>): void {
  const s = useProjectStore.getState();
  commit({ dimStyles: book(s).dimStyles.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
}

export function removeDimStyle(id: string): void {
  if (id === STANDARD) return;
  const s = useProjectStore.getState();
  commit({
    dimStyles: book(s).dimStyles.filter((d) => d.id !== id),
    drafts: s.drafts.map((d) => (d.params.dimStyle === id ? { ...d, params: { ...d.params, dimStyle: STANDARD } } : d)),
  });
}

// ─── Per element ──────────────────────────────────────────────────────────

function patchParams(ids: ReadonlySet<string>, patch: Record<string, DraftParamValue | null>): void {
  const s = useProjectStore.getState();
  const drafts = s.drafts.map((d) => {
    if (!ids.has(d.id)) return d;
    const params = { ...d.params };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete params[k];
      else params[k] = v;
    }
    return { ...d, params };
  });
  useProjectStore.setState({ drafts: restyle(s, drafts, (d) => ids.has(d.id)), dirty: true });
}

/** Give elements a text or dimension style. */
export function setElementStyle(ids: ReadonlySet<string>, kind: 'textStyle' | 'dimStyle', styleId: string): void {
  patchParams(ids, { [kind]: styleId });
}

/** Override one style field on elements (`null` clears it back to the style). */
export function setElementOverride(ids: ReadonlySet<string>, field: string, value: DraftParamValue | null): void {
  patchParams(ids, { [overrideKey(field)]: value });
}

/** Clear every override of the elements. */
export function resetElementOverrides(ids: ReadonlySet<string>): void {
  const s = useProjectStore.getState();
  const keys = new Set(s.drafts.filter((d) => ids.has(d.id)).flatMap((d) => Object.keys(d.params).filter((k) => k.startsWith('o.'))));
  patchParams(ids, Object.fromEntries([...keys].map((k) => [k, null])));
}

/** A view's scale changed: its annotations keep their paper size. */
export function rescaleViewAnnotations(viewId: string): void {
  const s = useProjectStore.getState();
  const drafts = restyle(s, s.drafts, (d) => d.viewId === viewId);
  if (drafts !== s.drafts) useProjectStore.setState({ drafts, dirty: true });
}
