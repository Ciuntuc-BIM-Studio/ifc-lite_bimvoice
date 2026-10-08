/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The selected view's configuration: its drawing (work) plane, its cut
 * plane and its view depth. Edits regenerate only that view's drawing
 * (`ViewDrawingHost`); the front tab follows immediately.
 */

import { useEffect, useState } from 'react';
import { FlipHorizontal2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { useProjectStore, updateProjectView } from '@/project/project-store';
import { useDocumentTabs } from '@/project/document-tabs';
import { activateDocumentTab } from '@/project/open-view';
import { resolvePlanLevel } from '@/project/view-defaults';
import type { ProjectView } from '@/project/types';
import { SHEET_SCALES } from '@/project/sheets';
import { Button } from '@/components/ui/button';
import { ViewGraphicsDialog } from './ViewGraphicsDialog';

const AXIS_KEYS = {
  down: 'projectNavigator.props.axisDown',
  front: 'projectNavigator.props.axisFront',
  side: 'projectNavigator.props.axisSide',
} as const;

const DIRECTION_KEYS = {
  north: 'projectNavigator.props.north',
  south: 'projectNavigator.props.south',
  east: 'projectNavigator.props.east',
  west: 'projectNavigator.props.west',
} as const;

/** Re-apply the front tab's plane after its view changed (header, exports, BCF follow it). */
function edit(view: ProjectView, patch: Parameters<typeof updateProjectView>[1]): void {
  updateProjectView(view.id, patch);
  if (useDocumentTabs.getState().activeId === view.id) activateDocumentTab(view.id);
}

export function ViewPropertiesPanel({ view }: { view: ProjectView }) {
  const { t } = useTranslation();
  const levels = useProjectStore((s) => s.levels);
  const [graphicsOpen, setGraphicsOpen] = useState(false);
  if (view.kind === '3d') return null;

  const depthHint = view.kind === 'plan' ? t('projectNavigator.props.depthCutOnly') : t('projectNavigator.props.depthAuto');
  let workPlane: string;
  if (view.kind === 'plan') {
    const level = resolvePlanLevel(view, levels) ?? view.level;
    workPlane = t('projectNavigator.props.levelPlane', { name: level.name, elevation: level.elevation.toFixed(2) });
  } else {
    workPlane = t('projectNavigator.props.cutPlane');
  }

  return (
    <section aria-label={t('projectNavigator.props.title')} className="shrink-0 border-t-2 border-zinc-200 dark:border-zinc-800 p-3 space-y-2 text-xs">
      <h3 className="font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">{t('projectNavigator.props.title')}</h3>
      <Row label={t('projectNavigator.props.workPlane')}><span className="text-zinc-600 dark:text-zinc-400">{workPlane}</span></Row>
      {view.kind === 'plan' ? (
        <Row label={t('projectNavigator.props.cutHeight')}>
          <MetresField value={view.cutHeight} label={t('projectNavigator.props.cutHeight')} onCommit={(v) => v !== null && edit(view, { cutHeight: v })} />
        </Row>
      ) : null}
      {view.kind === 'section' ? (
        <>
          <Row label={t('projectNavigator.props.cutPlaneAxis')}>
            <span className="text-zinc-600 dark:text-zinc-400">{view.plane.custom ? t('projectNavigator.props.axisCustom') : t(AXIS_KEYS[view.plane.axis])}</span>
          </Row>
          {view.plane.custom ? null : (
            <Row label={t('projectNavigator.props.cutOffset')}>
              <div className="flex items-center gap-1">
                <MetresField value={view.plane.offset} label={t('projectNavigator.props.cutOffset')} onCommit={(v) => v !== null && edit(view, { plane: { ...view.plane, offset: v } })} />
                <IconButton label={t('projectNavigator.props.flip')} className="size-6" onClick={() => edit(view, { plane: { ...view.plane, flipped: !view.plane.flipped } })}>
                  <FlipHorizontal2 className="size-3.5" />
                </IconButton>
              </div>
            </Row>
          )}
        </>
      ) : null}
      {view.kind === 'elevation' ? (
        <Row label={t('projectNavigator.props.facing')}><span className="text-zinc-600 dark:text-zinc-400">{t(DIRECTION_KEYS[view.direction])}</span></Row>
      ) : null}
      <Row label={t('projectNavigator.props.viewDepth')}>
        <MetresField value={view.viewDepth ?? null} placeholder={depthHint} label={t('projectNavigator.props.viewDepth')} allowEmpty onCommit={(v) => edit(view, { viewDepth: v })} />
      </Row>
      <Row label={t('projectNavigator.props.scale')}>
        <select
          aria-label={t('projectNavigator.props.scale')}
          className="h-6 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1"
          value={view.scale ?? 100}
          onChange={(e) => edit(view, { scale: Number(e.target.value) })}
        >
          {SHEET_SCALES.map((s) => <option key={s} value={s}>{`1:${s}`}</option>)}
        </select>
      </Row>
      <Button variant="outline" size="sm" className="w-full" onClick={() => setGraphicsOpen(true)}>{t('viewGraphics.open')}</Button>
      <ViewGraphicsDialog view={view} open={graphicsOpen} onOpenChange={setGraphicsOpen} />
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 min-h-6">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <div className="min-w-0 truncate text-right">{children}</div>
    </div>
  );
}

interface MetresFieldProps {
  value: number | null;
  label: string;
  placeholder?: string;
  allowEmpty?: boolean;
  onCommit: (value: number | null) => void;
}

/** A metres input that commits on Enter / blur; empty means "default" when allowed. */
function MetresField({ value, label, placeholder, allowEmpty, onCommit }: MetresFieldProps) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const commit = () => {
    const trimmed = text.trim().replace(',', '.');
    if (!trimmed) {
      if (allowEmpty) onCommit(null);
      else setText(value === null ? '' : String(value));
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) onCommit(n);
    else setText(value === null ? '' : String(value));
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      className="w-24 h-6 px-1.5 text-right tabular-nums bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-sm outline-none focus:border-primary"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}
