/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Model inspector's Dimensions section (charter #6232, M2 §1.7.2).
 *
 * Defaults mode edits what the next element is built with (the defaults
 * slice the command bars read too). Selection mode edits the element's own
 * size, one undo step each, re-meshed through the transaction: a wall's
 * thickness and height, a slab's thickness, a column's or beam's length and
 * section. It is the write the push / pull handles make (`setElementSize`),
 * so a handle and a typed value cannot disagree.
 */

import { useId, useMemo } from 'react';
import { occurrencesOfTypeInStore, readHostedElementSize, readStairDimensions, type JoinerySpec, type StairDimensions } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';
import { authoringDim, type AuthoredElementKind } from '@/store/slices/authoringDefaultsSlice';
import { CommitField, InspectorCaption, InspectorRow, InspectorSection } from './InspectorControls';
import { DEFAULT_DIMS, DIM_LABEL, METRE_SYMBOL, formatMetres, parseMetres, type DimParam } from './inspector-fields';
import { readElementSize } from '@/store/slices/mutation-element-size';
import { setElementDimensions, setHostedElementDimensions, setStairDimensions } from './inspector-edits';
import type { InspectorSelection } from './useInspectorTarget';
import { Button } from '@/components/ui/button';
import { typeOf } from '@/lib/commands/modeling/authored-kinds';
import { joineryOfElement } from '@/joinery/element-spec';
import { importJoinery, joineryEntry, resizeJoineryType } from '@/joinery/catalog';
import { openJoinery } from '@/joinery/dialog-store';

function MetreRow({ param, value, onCommit }: { param: DimParam; value: number | null; onCommit?: (metres: number) => boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const label = t(DIM_LABEL[param]);
  const commit = (text: string) => {
    const metres = parseMetres(text);
    if (metres === null) { toast.error(t('modelInspector.dims.invalid')); return false; }
    return onCommit?.(metres) ?? false;
  };
  return (
    <InspectorRow label={label} htmlFor={id}>
      <CommitField
        id={id}
        value={value === null ? '' : formatMetres(value)}
        onCommit={commit}
        readOnly={!onCommit}
        suffix={METRE_SYMBOL}
        ariaLabel={t('modelInspector.dims.fieldAria', { label })}
      />
    </InspectorRow>
  );
}

export function DefaultDimensions({ kind }: { kind: AuthoredElementKind }) {
  const { t } = useTranslation();
  const defaults = useViewerStore((s) => s.authoringDefaults);
  const setDims = useViewerStore((s) => s.setAuthoringDims);
  // A picked section replaces the rectangle's own sides (Width x Height, Width x Depth): they are the Profile section's.
  const sectioned = (kind === 'beam' || kind === 'member' || kind === 'column') && defaults.profiles[kind].type !== 'Rectangle';
  const rectangleSides: readonly DimParam[] = ['Width', 'Depth', ...(kind === 'column' ? [] : ['Height' as const])];
  const params = DEFAULT_DIMS[kind].filter((param) => !sectioned || !rectangleSides.includes(param));
  if (params.length === 0) return null;
  return (
    <InspectorSection title={t('modelInspector.dims.title')}>
      {params.map((param) => (
        <MetreRow
          key={param}
          param={param}
          value={authoringDim(defaults, kind, param)}
          onCommit={(metres) => { setDims(kind, { [param]: metres }); return true; }}
        />
      ))}
    </InspectorSection>
  );
}

type Measured =
  | { kind: 'wall'; length: number; thickness: number; height: number }
  | { kind: 'slab'; thickness: number }
  | { kind: 'linear'; column: boolean; length: number; width: number; cross: number; profiled: boolean }
  | { kind: 'hosted'; width: number; height: number; typed?: { spec: JoinerySpec; count: number } }
  | { kind: 'stair'; dimensions: StairDimensions }
  | { kind: 'none'; reason: 'modelInspector.dims.notRectangular' | 'modelInspector.dims.unknown' };

function measure(selection: InspectorSelection): Measured {
  const s = useViewerStore.getState();
  const { modelId, expressId, kind } = selection;
  if (isStairSelection(selection)) {
    const dimensions = readStairDimensions(selection.live.dataStore, expressId, s.mutationViews.get(modelId));
    return dimensions ? { kind: 'stair', dimensions } : { kind: 'none', reason: 'modelInspector.dims.unknown' };
  }
  if (kind === 'door' || kind === 'window') {
    const view = s.mutationViews.get(modelId);
    const size = readHostedElementSize(selection.live.dataStore, expressId, view);
    if (!size) return { kind: 'none', reason: 'modelInspector.dims.unknown' };
    // A configured door / window takes its size from its type: an edit goes to the type.
    const joinery = joineryOfElement(modelId, expressId);
    const typeId = joinery ? typeOf({ dataStore: selection.live.dataStore, view: view ?? null }, expressId) : null;
    const typed = joinery && typeId !== null ? { spec: joinery.spec, count: occurrencesOfTypeInStore(selection.live.dataStore, typeId, view).length } : undefined;
    return { kind: 'hosted', width: size.OverallWidth, height: size.OverallHeight, typed };
  }
  if (kind === 'wall') {
    const wall = s.readWallEndpoints(modelId, expressId);
    if (!wall) return { kind: 'none', reason: 'modelInspector.dims.notRectangular' };
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    return { kind: 'wall', length, thickness: wall.thickness, height: wall.height };
  }
  const size = readElementSize(s, modelId, expressId);
  if (size?.kind === 'slab' && (kind === 'slab' || kind === 'roof' || kind === 'plate')) return size;
  if (size?.kind === 'linear' && (kind === 'column' || kind === 'beam' || kind === 'member')) return { ...size, column: kind === 'column' };
  return { kind: 'none', reason: 'modelInspector.dims.unknown' };
}

export function SelectionDimensions({ selection }: { selection: InspectorSelection }) {
  const { t } = useTranslation();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const measured = useMemo(() => { void mutationVersion; return measure(selection); }, [selection, mutationVersion]);
  const { modelId, expressId } = selection;

  return (
    <InspectorSection title={t('modelInspector.dims.title')}>
      {measured.kind === 'wall' && (
        <>
          <MetreRow param="Length" value={measured.length} />
          <MetreRow param="Thickness" value={measured.thickness} onCommit={(thickness) => setElementDimensions(modelId, expressId, { kind: 'wall', thickness })} />
          <MetreRow param="Height" value={measured.height} onCommit={(height) => setElementDimensions(modelId, expressId, { kind: 'wall', height })} />
        </>
      )}
      {measured.kind === 'slab' && (
        <MetreRow param="Thickness" value={measured.thickness} onCommit={(thickness) => setElementDimensions(modelId, expressId, { kind: 'slab', thickness })} />
      )}
      {measured.kind === 'linear' && (
        <>
          {/* A column runs up (Height) with a Width x Depth section; a beam or member runs along (Length) with Width x Height. */}
          {/* A profiled section's outer size is shown, not typed: the Profile section edits its own dimensions. */}
          <MetreRow param={measured.column ? 'Width' : 'Length'} value={measured.column ? measured.width : measured.length}
            onCommit={measured.column && measured.profiled ? undefined : (metres) => setElementDimensions(modelId, expressId, { kind: 'linear', ...(measured.column ? { width: metres } : { length: metres }) })} />
          <MetreRow param={measured.column ? 'Depth' : 'Width'} value={measured.column ? measured.cross : measured.width}
            onCommit={measured.profiled ? undefined : (metres) => setElementDimensions(modelId, expressId, { kind: 'linear', ...(measured.column ? { cross: metres } : { width: metres }) })} />
          <MetreRow param="Height" value={measured.column ? measured.length : measured.cross}
            onCommit={!measured.column && measured.profiled ? undefined : (metres) => setElementDimensions(modelId, expressId, { kind: 'linear', ...(measured.column ? { length: metres } : { cross: metres }) })} />
          {measured.profiled && <InspectorCaption>{t('profileSection.inspector.outerSize')}</InspectorCaption>}
        </>
      )}
      {measured.kind === 'hosted' && !measured.typed && (
        <>
          <MetreRow param="Width" value={measured.width} onCommit={OverallWidth => setHostedElementDimensions(modelId, expressId, { OverallWidth })} />
          <MetreRow param="Height" value={measured.height} onCommit={OverallHeight => setHostedElementDimensions(modelId, expressId, { OverallHeight })} />
        </>
      )}
      {measured.kind === 'hosted' && measured.typed && <TypedSize width={measured.width} height={measured.height} {...measured.typed} />}
      {measured.kind === 'stair' && (
        <>
          {(['Width', 'RiserHeight', 'TreadLength', 'WaistThickness'] as const)
            .filter(param => measured.dimensions[param] !== undefined).map(param => (
            <MetreRow key={param} param={param}
              value={measured.dimensions[param] ?? null}
              onCommit={metres => setStairDimensions(modelId, expressId, { [param]: metres })} />
          ))}
          <InspectorCaption>{t('stairRailing.inspector.effect')}</InspectorCaption>
        </>
      )}
      {measured.kind === 'none' && <InspectorCaption>{t(measured.reason)}</InspectorCaption>}
    </InspectorSection>
  );
}

/** A configured door's / window's size: a type parameter, so a change resizes every occurrence of the type. */
function TypedSize({ width, height, spec, count }: { width: number; height: number; spec: JoinerySpec; count: number }) {
  const { t } = useTranslation();
  const resize = (size: { width?: number; height?: number }) => {
    const out = resizeJoineryType(spec, size);
    if (out.refused.length) toast.error(t('joinery.inspector.refused', { list: out.refused.join('; ') }));
    else toast.success(t('joinery.inspector.resized', { mark: spec.mark, count: out.updated }));
    return out.refused.length === 0;
  };
  return (
    <>
      <MetreRow param="Width" value={width} onCommit={(w) => resize({ width: w })} />
      <MetreRow param="Height" value={height} onCommit={(h) => resize({ height: h })} />
      <InspectorCaption>{t('joinery.inspector.typeSize', { mark: spec.mark || spec.name, count })}</InspectorCaption>
      <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={() => {
        if (!joineryEntry(spec.id)) importJoinery([spec]);
        openJoinery(spec.id ?? null);
      }}>{t('joinery.inspector.editType')}</Button>
    </>
  );
}

export function isStairSelection(selection: InspectorSelection): boolean {
  return selection.ifcClass === 'IfcStair' || selection.ifcClass === 'IfcStairFlight';
}
