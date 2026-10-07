/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A drawing tab's drafting view (phase 4): the view's own generated
 * drawing (`Drawing2DCanvas`, as the Drawing panel renders it), the
 * drafted entities and command previews over it, and the command line.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphicOverrideEngine } from '@ifc-lite/drawing-2d';
import { Maximize2, Redo2, Undo2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { IconButton } from '@/components/ui/icon-button';
import { Drawing2DCanvas } from '@/components/viewer/Drawing2DCanvas';
import { useViewControls } from '@/hooks/useViewControls';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { EMPTY_VIEW_DRAWING, useViewDrawings } from '@/project/view-drawings';
import type { ProjectView } from '@/project/types';
import type { SectionAxisName } from '@/drafting/frame';
import { referenceSet, referencesIn } from '@/drafting/references';
import { draftsOfView, redoDrafts, undoDrafts } from '@/drafting/draft-store';
import {
  attachDraftingView, currentLayerId, pressEscape, runningCommand, setCurrentLayer, submitCommandLine,
  toggleOrtho, toggleSnap, useDraftingSession,
} from '@/drafting/session';
import { DraftOverlay } from './DraftOverlay';
import { CommandLine } from './CommandLine';
import { useDraftingPointer } from './useDraftingPointer';
import { useDraftingKeys } from './useDraftingKeys';

const AXIS_NAME = { y: 'down', z: 'front', x: 'side' } as const;
const NO_SHEET_TRANSFORM = { current: null };

export function DraftingView({ view }: { view: Exclude<ProjectView, { kind: '3d' }> }) {
  const { t } = useTranslation();
  const entry = useViewDrawings((s) => s.byView[view.id]) ?? EMPTY_VIEW_DRAWING;
  const { drawing, status } = entry;
  const showHiddenLines = useViewerStore((s) => s.drawing2DDisplayOptions.showHiddenLines);
  const allDrafts = useProjectStore((s) => s.drafts);
  const layers = useProjectStore((s) => s.draftLayers);
  const selection = useDraftingSession((s) => s.selection);
  const ortho = useDraftingSession((s) => s.ortho);
  const snap = useDraftingSession((s) => s.snap);
  useDraftingSession((s) => s.revision);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');

  const plane = drawing?.config.plane;
  const axis: SectionAxisName = plane ? AXIS_NAME[plane.axis] : 'down';
  const sectionPlane = useMemo(() => ({ axis, position: plane?.position ?? 0, flipped: plane?.flipped ?? false }), [axis, plane]);
  const { viewTransform, setViewTransform, fitToView } = useViewControls({
    drawing, sectionPlane, containerRef, panelVisible: true, status, sheetEnabled: false, activeSheet: null,
    isPinned: false, cachedSheetTransformRef: NO_SHEET_TRANSFORM,
  });

  const references = useMemo(() => (drawing ? referenceSet(drawing, false) : null), [drawing]);
  const entities = useMemo(() => draftsOfView(view.id, allDrafts), [allDrafts, view.id]);
  const entityShapes = useMemo(() => entities.map((e) => e.shape), [entities]);
  const overrideEngine = useMemo(() => new GraphicOverrideEngine([]), []);
  const noColors = useMemo(() => new Map<number, [number, number, number, number]>(), []);

  useEffect(() => {
    attachDraftingView(view.id, axis, (min, max) => (references ? referencesIn(references, min, max) : []));
  }, [view.id, axis, references]);

  const { state, handlers } = useDraftingPointer({ containerRef, transform: viewTransform, setTransform: setViewTransform, axis, entityShapes, references });
  const submit = () => {
    submitCommandLine(text, state.cursor);
    setText('');
  };
  useDraftingKeys({ inputRef, setText, submit: () => submitCommandLine('', state.cursor) });

  const command = runningCommand();
  const preview = command && state.cursor && command.preview ? command.preview(state.cursor) : [];

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center gap-1 h-9 px-2 border-b border-zinc-200 dark:border-zinc-800 text-xs">
        <span className="font-semibold truncate">{view.name}</span>
        <span className="flex-1" />
        <Toggle active={snap} label={t('drafting.snap')} onClick={toggleSnap} />
        <Toggle active={ortho} label={t('drafting.ortho')} onClick={toggleOrtho} />
        <select
          aria-label={t('drafting.layer')}
          className="h-6 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1"
          value={currentLayerId()}
          onChange={(e) => setCurrentLayer(e.target.value)}
        >
          {layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <IconButton label={t('drafting.undo')} className="size-7" onClick={() => undoDrafts()}><Undo2 className="size-4" /></IconButton>
        <IconButton label={t('drafting.redo')} className="size-7" onClick={() => redoDrafts()}><Redo2 className="size-4" /></IconButton>
        <IconButton label={t('drafting.fit')} className="size-7" onClick={fitToView}><Maximize2 className="size-4" /></IconButton>
      </div>
      <div
        ref={containerRef}
        data-drafting-canvas
        className="relative min-h-0 flex-1 overflow-hidden bg-white dark:bg-zinc-950 cursor-none touch-none"
        {...handlers}
      >
        {drawing ? (
          <Drawing2DCanvas
            drawing={drawing}
            transform={viewTransform}
            showHiddenLines={showHiddenLines}
            overrideEngine={overrideEngine}
            overridesEnabled={false}
            entityColorMap={noColors}
            useIfcMaterials={false}
            sectionAxis={axis}
          />
        ) : null}
        {status === 'generating' ? (
          <div className="absolute inset-x-0 top-2 flex justify-center pointer-events-none">
            <div className="flex items-center gap-2 rounded-md bg-background/90 px-3 py-1 text-xs shadow">
              <Spinner className="size-3.5" /> {entry.phase} {Math.round(entry.progress)}%
            </div>
          </div>
        ) : null}
        {status === 'error' && entry.error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-destructive pointer-events-none">{entry.error}</div>
        ) : null}
        <DraftOverlay
          entities={entities}
          layers={layers}
          selection={selection}
          hoverId={state.hoverId}
          preview={preview}
          snap={state.snap}
          cursor={state.cursor}
          window={state.window}
          transform={viewTransform}
          axis={axis}
        />
      </div>
      <CommandLine ref={inputRef} value={text} onChange={setText} onSubmit={submit} onEscape={() => { setText(''); pressEscape(); }} />
    </div>
  );
}

function Toggle({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn('h-6 rounded-sm px-2 font-medium', active ? 'bg-primary/15 text-primary' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900')}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
