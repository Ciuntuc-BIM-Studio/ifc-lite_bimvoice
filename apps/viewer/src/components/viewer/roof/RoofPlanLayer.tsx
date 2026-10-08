/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Roof systems on a floor plan (`project/roof-plan.ts`): ridges, hips and
 * valleys, eaves and verges, and on each plane its downslope arrow and
 * pitch. While a roof is in edit mode, every edge carries a chip — eave and
 * pitch, or gable — that opens a small editor on the canvas; each change
 * regenerates the roof, and Finish leaves the mode.
 */

import { memo, useMemo, useState } from 'react';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { RoofEdgeRule } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { drawingToScreen, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import type { ProjectView } from '@/project/types';
import { planRoofs, type PlanRoof } from '@/project/roof-plan';
import { applyRoofSystem } from '@/project/roof-system-element';
import { openRoofDialog, stopRoofEdit, useRoofDialog } from '@/project/roof-dialog-store';

const DASH: Partial<Record<string, string>> = { valley: '6 3', eave: undefined, verge: undefined };

interface Props {
  view: ProjectView;
  plane: SectionPlaneConfig | null;
  transform: ViewTransform;
  axis: SectionAxisName;
}

function EdgeEditor({ rule, onChange, onClose }: { rule: RoofEdgeRule; onChange: (r: RoofEdgeRule) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [pitch, setPitch] = useState(String(rule.pitch || 30));
  const [overhang, setOverhang] = useState(String(Math.round(rule.overhang * 1000)));
  const commit = (patch: Partial<RoofEdgeRule>) => onChange({ ...rule, ...patch });
  return (
    <div className="flex items-center gap-1 rounded-md border border-zinc-300 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900" onPointerDown={(e) => e.stopPropagation()}>
      <select aria-label={t('roof.edge.kind')} className="h-7 rounded-sm border border-zinc-300 bg-transparent px-1 dark:border-zinc-700" value={rule.kind}
        onChange={(e) => commit({ kind: e.target.value as RoofEdgeRule['kind'], pitch: Number(pitch) || 30 })}>
        <option value="eave">{t('roof.edge.eave')}</option>
        <option value="gable">{t('roof.edge.gable')}</option>
      </select>
      {rule.kind === 'eave' ? (
        <input aria-label={t('roof.edge.pitch')} className="h-7 w-14 rounded-sm border border-zinc-300 bg-transparent px-1 tabular-nums dark:border-zinc-700" value={pitch}
          onChange={(e) => setPitch(e.target.value)} onBlur={() => Number(pitch) > 0 && commit({ pitch: Number(pitch) })}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && Number(pitch) > 0) commit({ pitch: Number(pitch) }); }} />
      ) : null}
      <input aria-label={t('roof.edge.overhang')} className="h-7 w-16 rounded-sm border border-zinc-300 bg-transparent px-1 tabular-nums dark:border-zinc-700" value={overhang}
        onChange={(e) => setOverhang(e.target.value)} onBlur={() => Number(overhang) >= 0 && commit({ overhang: Number(overhang) / 1000 })}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && Number(overhang) >= 0) commit({ overhang: Number(overhang) / 1000 }); }} />
      <IconButton label={t('roof.edit.done')} className="size-7" onClick={onClose}><Check className="size-3.5" /></IconButton>
    </div>
  );
}

export const RoofPlanLayer = memo(function RoofPlanLayer({ view, plane, transform, axis }: Props) {
  const { t } = useTranslation();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const models = useViewerStore((s) => s.models);
  const editing = useRoofDialog((s) => s.editing);
  const [open, setOpen] = useState<number | null>(null);
  const roofs = useMemo(() => (plane ? planRoofs(view, plane) : []), [view, plane, mutationVersion, models]);
  if (roofs.length === 0) return null;
  const S = (p: Pt) => drawingToScreen(p, transform, axis);
  const path = (pts: Pt[], closed = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${S(p).x.toFixed(1)},${S(p).y.toFixed(1)}`).join('') + (closed ? 'Z' : '');
  const active = (r: PlanRoof) => editing?.modelId === r.modelId && editing.roofId === r.roofId;
  const change = (r: PlanRoof, i: number, rule: RoofEdgeRule) => {
    const result = applyRoofSystem(r, { ...r.spec, rules: r.spec.rules.map((x, k) => (k === i ? rule : x)) });
    if (!result.ok) toast.error(t('roof.problem', { reason: result.error }));
  };

  return (
    <>
      <svg data-roof-plan className="absolute inset-0 h-full w-full pointer-events-none text-zinc-700 dark:text-zinc-300" aria-hidden="true">
        {roofs.map((r) => (
          <g key={`${r.modelId}:${r.roofId}`} opacity={editing && !active(r) ? 0.35 : 1}>
            {r.lines.map((l, i) => (
              <path key={i} d={path([l.a, l.b])} stroke={active(r) ? '#2563eb' : 'currentColor'} strokeWidth={l.kind === 'ridge' ? 1.2 : 0.8} strokeDasharray={DASH[l.kind]} fill="none" />
            ))}
            {r.arrows.map((a, i) => {
              const from = S(a.from), to = S(a.to);
              const ang = Math.atan2(to.y - from.y, to.x - from.x);
              const head = `M${to.x},${to.y}L${to.x - 7 * Math.cos(ang - 0.4)},${to.y - 7 * Math.sin(ang - 0.4)}M${to.x},${to.y}L${to.x - 7 * Math.cos(ang + 0.4)},${to.y - 7 * Math.sin(ang + 0.4)}`;
              return (
                <g key={`a${i}`} stroke="currentColor" fill="none" strokeWidth={0.9}>
                  <path d={`M${from.x},${from.y}L${to.x},${to.y}${head}`} />
                  <text x={(from.x + to.x) / 2 + 4} y={(from.y + to.y) / 2 - 4} fontSize={11} fill="currentColor" stroke="none">{a.pitch}°</text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {roofs.filter(active).map((r) => (
        <div key={`edit${r.roofId}`} className="pointer-events-none absolute inset-0">
          {r.outline.map((p, i) => {
            const q = r.outline[(i + 1) % r.outline.length];
            const m = S({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
            const rule = r.spec.rules[i];
            const text = rule.kind === 'gable' ? t('roof.edge.gable') : `${rule.pitch}°`;
            return (
              <div key={i} className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2" style={{ left: m.x, top: m.y }}>
                {open === i ? (
                  <EdgeEditor rule={rule} onChange={(next) => change(r, i, next)} onClose={() => setOpen(null)} />
                ) : (
                  <button type="button" aria-label={t('roof.edit.chip', { n: i + 1, rule: text })} onPointerDown={(e) => e.stopPropagation()}
                    className={`rounded-full border px-2 py-0.5 text-2xs font-semibold shadow ${rule.kind === 'gable' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-primary bg-white text-primary'}`}
                    onClick={() => setOpen(i)}>
                    {i + 1} · {text}
                  </button>
                )}
              </div>
            );
          })}
          <div className="pointer-events-auto absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-primary bg-white/95 px-3 py-1.5 text-xs shadow-lg dark:bg-zinc-900/95" onPointerDown={(e) => e.stopPropagation()}>
            <span className="font-semibold">{t('roof.edit.title', { name: r.spec.name })}</span>
            <span className="text-zinc-500">{t('roof.edit.hint')}</span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => openRoofDialog(r)}>{t('roof.edit.settings')}</Button>
            <Button size="sm" className="h-7" onClick={() => { setOpen(null); stopRoofEdit(); }}>{t('roof.edit.finish')}</Button>
          </div>
        </div>
      ))}
    </>
  );
});
