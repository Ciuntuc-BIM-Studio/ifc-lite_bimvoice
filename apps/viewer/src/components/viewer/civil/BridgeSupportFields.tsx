/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A bridge's intermediate supports in the corridor configurator.
 *
 * Bearings: whether there are any, how many pads a line, and their size.
 * They sit on every abutment seat and pier top.
 *
 * Piers: Distribute spreads them into equal spans. Each one has its
 * station, its type (wall, or columns under a cap), how far it reaches left
 * and right, its thickness or column size, its columns' count and section,
 * the cap, its height (down to the ground, or typed) and its continuous
 * footing.
 */

import { Plus, Trash2 } from 'lucide-react';
import { assemblyWidth, defaultBearings, defaultPier, distributePiers, type CorridorBridge, type CorridorSpec, type PierSpec, type PierType } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { freshProjectId } from '@/project/view-defaults';
import { INPUT } from '../joinery/JoineryFields';
import { Cell } from './CorridorFields';

function Num({ label, value, onCommit, min = 0 }: { label: string; value: number | undefined; onCommit: (v: number) => void; min?: number }) {
  return (
    <label className="grid grid-cols-[1fr_4.5rem] items-center gap-1 text-2xs">
      <span className="truncate text-zinc-500">{label}</span>
      <Cell label={label} value={value} min={min} onCommit={onCommit} />
    </label>
  );
}

const TITLE = 'text-2xs font-semibold uppercase tracking-wide text-zinc-500';

export function BearingFields({ bridge, onChange }: { bridge: CorridorBridge; onChange: (b: CorridorBridge) => void }) {
  const { t } = useTranslation();
  const b = bridge.bearings;
  const set = (p: Partial<NonNullable<CorridorBridge['bearings']>>) => onChange({ ...bridge, bearings: { ...(b ?? defaultBearings()), ...p } });
  return (
    <div className="space-y-1 rounded-sm bg-zinc-50 p-1.5 dark:bg-zinc-900">
      <label className="flex items-center gap-1.5 text-2xs">
        <input type="checkbox" checked={!!b} onChange={(e) => onChange({ ...bridge, bearings: e.target.checked ? defaultBearings() : undefined })} />
        <span className={TITLE}>{t('civil.bridge.bearings')}</span>
      </label>
      {b ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          <Num label={t('civil.bridge.bearingCount')} value={b.count} min={1} onCommit={(count) => set({ count: Math.round(count) })} />
          <Num label={t('civil.bridge.bearingHeight')} value={b.height} min={0.02} onCommit={(height) => set({ height })} />
          <Num label={t('civil.bridge.bearingWidth')} value={b.width} min={0.05} onCommit={(width) => set({ width })} />
          <Num label={t('civil.bridge.bearingLength')} value={b.length} min={0.05} onCommit={(length) => set({ length })} />
        </div>
      ) : null}
    </div>
  );
}

function PierRow({ n, p, onChange, onRemove }: { n: number; p: PierSpec; onChange: (p: PierSpec) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const set = (q: Partial<PierSpec>) => onChange({ ...p, ...q });
  const auto = p.autoHeight ?? true;
  return (
    <div className="space-y-1 border-t border-zinc-200 pt-1 dark:border-zinc-700">
      <div className="flex items-center gap-1">
        <span className="w-12 shrink-0 text-2xs text-zinc-500">{t('civil.bridge.pierN', { n })}</span>
        <Cell label={t('civil.bridge.pierStation', { n })} value={p.station} onCommit={(station) => set({ station })} />
        <select aria-label={t('civil.bridge.pierType', { n })} className={INPUT} value={p.type} onChange={(e) => set({ type: e.target.value as PierType, cap: e.target.value === 'columns' && p.cap.depth <= 0 ? { depth: 1.2, width: 1.8 } : p.cap })}>
          <option value="columns">{t('civil.bridge.pier.columns')}</option>
          <option value="wall">{t('civil.bridge.pier.wall')}</option>
        </select>
        <IconButton label={t('civil.bridge.removePier', { n })} className="size-6" onClick={onRemove}><Trash2 className="size-3" /></IconButton>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <Num label={t('civil.bridge.left')} value={p.left} onCommit={(left) => set({ left })} />
        <Num label={t('civil.bridge.right')} value={p.right} onCommit={(right) => set({ right })} />
        <Num label={t(p.type === 'wall' ? 'civil.bridge.pierThickness' : 'civil.bridge.columnSize')} value={p.thickness} min={0.2} onCommit={(thickness) => set({ thickness })} />
        {p.type === 'columns' ? (
          <>
            <Num label={t('civil.bridge.columns')} value={p.columns} min={1} onCommit={(columns) => set({ columns: Math.round(columns) })} />
            <label className="grid grid-cols-[1fr_4.5rem] items-center gap-1 text-2xs">
              <span className="truncate text-zinc-500">{t('civil.bridge.columnShape')}</span>
              <select aria-label={t('civil.bridge.columnShape')} className={INPUT} value={p.shape} onChange={(e) => set({ shape: e.target.value as PierSpec['shape'] })}>
                <option value="round">{t('civil.bridge.shape.round')}</option>
                <option value="square">{t('civil.bridge.shape.square')}</option>
              </select>
            </label>
            <Num label={t('civil.bridge.capDepth')} value={p.cap.depth} min={0.2} onCommit={(depth) => set({ cap: { ...p.cap, depth } })} />
            <Num label={t('civil.bridge.capWidth')} value={p.cap.width} min={0.2} onCommit={(width) => set({ cap: { ...p.cap, width } })} />
          </>
        ) : null}
        <label className="col-span-2 flex items-center gap-1.5 text-2xs">
          <input type="checkbox" checked={auto} onChange={(e) => set({ autoHeight: e.target.checked })} />
          {t('civil.bridge.autoHeight')}
        </label>
        {!auto ? <Num label={t('civil.bridge.pierHeight')} value={p.height} min={0.5} onCommit={(height) => set({ height })} /> : null}
        <Num label={t('civil.bridge.footingWidth')} value={p.footing.width} min={0.5} onCommit={(width) => set({ footing: { ...p.footing, width } })} />
        <Num label={t('civil.bridge.footingThickness')} value={p.footing.thickness} min={0.2} onCommit={(thickness) => set({ footing: { ...p.footing, thickness } })} />
      </div>
    </div>
  );
}

export function PierFields({ spec, bridge, onChange }: { spec: CorridorSpec; bridge: CorridorBridge; onChange: (b: CorridorBridge) => void }) {
  const { t } = useTranslation();
  const piers = bridge.piers ?? [];
  const half = Math.ceil(assemblyWidth(spec.assembly) + 0.5);
  const setPiers = (next: PierSpec[]) => onChange({ ...bridge, piers: [...next].sort((a, b) => a.station - b.station) });
  const spans = piers.length + 1;
  return (
    <div className="space-y-1 rounded-sm bg-zinc-50 p-1.5 dark:bg-zinc-900">
      <div className="flex items-center gap-1">
        <span className={`flex-1 ${TITLE}`}>{t('civil.bridge.piers')}</span>
        <span className="text-2xs text-zinc-500">{t('civil.bridge.spans')}</span>
        <div className="w-14"><Cell label={t('civil.bridge.spans')} value={spans} min={1} onCommit={(n) => setPiers(distributePiers(bridge, n, half, () => freshProjectId('pier')))} /></div>
        <IconButton label={t('civil.bridge.addPier')} className="size-6" onClick={() => {
          const lo = Math.min(bridge.from, bridge.to), hi = Math.max(bridge.from, bridge.to);
          // In the middle of the longest span.
          const stops = [lo, ...piers.map((p) => p.station), hi];
          let at = (lo + hi) / 2, longest = 0;
          for (let i = 1; i < stops.length; i++) if (stops[i] - stops[i - 1] > longest) { longest = stops[i] - stops[i - 1]; at = (stops[i] + stops[i - 1]) / 2; }
          const like = piers[0];
          setPiers([...piers, like ? { ...structuredClone(like), id: freshProjectId('pier'), station: Math.round(at * 100) / 100 } : defaultPier(freshProjectId('pier'), Math.round(at * 100) / 100, half)]);
        }}><Plus className="size-3" /></IconButton>
      </div>
      {piers.length === 0 ? <p className="text-2xs text-zinc-500">{t('civil.bridge.noPiers')}</p> : null}
      {piers.map((p, i) => (
        <PierRow key={p.id} n={i + 1} p={p} onChange={(q) => setPiers(piers.map((x, k) => (k === i ? q : x)))} onRemove={() => setPiers(piers.filter((_, k) => k !== i))} />
      ))}
    </div>
  );
}
