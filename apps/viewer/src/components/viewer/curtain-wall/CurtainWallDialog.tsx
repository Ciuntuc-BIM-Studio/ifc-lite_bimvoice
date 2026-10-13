/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The curtain wall configurator: one curtain wall's parameters — name,
 * length, height, base, its type (or none) and its build (grids, sections,
 * frame, panels, colours) — with an elevation preview, applied as one undo
 * step (`applyCurtainWall`). A curtain wall placed before it kept its
 * parameters opens read back from its parts; applying makes it parametric.
 * Changing the build of a typed curtain wall detaches it from its type;
 * "Save as type" makes the build a catalogue entry this wall then follows.
 */

import { useMemo, useState } from 'react';
import { curtainWallSpecLayout, curtainWallTypeOf, type CurtainWallLayout, type CurtainWallSpec, type CurtainWallTypeSpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { addElementType, updateElementType } from '@/element-types/catalog';
import { applyCurtainWall, closeCurtainWallDialog, curtainWallRef, specFromType, useCurtainWallDialog } from '@/project/curtain-wall-element';
import { Field, Mm } from '../element-types/TypeFields';
import { CurtainTypeFields } from './CurtainTypeFields';

const CELL = 'h-6 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1';

const lengthOf = (s: CurtainWallSpec) => Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1]);

/** The same line, `length` long from its start. */
function withLength(s: CurtainWallSpec, length: number): CurtainWallSpec {
  const l = lengthOf(s) || 1;
  const dx = (s.end[0] - s.start[0]) / l, dy = (s.end[1] - s.start[1]) / l;
  return { ...s, end: [s.start[0] + dx * length, s.start[1] + dy * length, s.start[2]] };
}

/** The curtain wall's elevation, scaled to fit: frame members dark, panels tinted. */
function Elevation({ layout, spec }: { layout: CurtainWallLayout; spec: CurtainWallSpec }) {
  const W = 420, H = 240, pad = 12;
  const k = Math.min((W - 2 * pad) / layout.length, (H - 2 * pad) / layout.height);
  const x = (u: number) => pad + u * k;
  const y = (v: number) => H - pad - v * k;
  const panel = spec.panel.kind === 'glass' ? spec.glassColor : spec.opaqueColor;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="rounded-sm border border-zinc-200 bg-white dark:border-zinc-800" aria-hidden="true">
      {layout.panels.map((p, i) => (
        <rect key={`p${i}`} x={x(p.u0)} y={y(p.v1)} width={(p.u1 - p.u0) * k} height={(p.v1 - p.v0) * k} fill={panel} fillOpacity={spec.panel.kind === 'glass' ? 0.45 : 1} />
      ))}
      {layout.mullions.map((u, i) => (
        <rect key={`m${i}`} x={x(u - spec.mullion.width / 2)} y={y(layout.height)} width={Math.max(1, spec.mullion.width * k)} height={layout.height * k} fill={spec.frameColor} />
      ))}
      {layout.transoms.map((t, i) => (
        <rect key={`t${i}`} x={x(t.u0)} y={y(t.v + spec.transom.width / 2)} width={(t.u1 - t.u0) * k} height={Math.max(1, spec.transom.width * k)} fill={spec.frameColor} />
      ))}
    </svg>
  );
}

function Configurator({ modelId, curtainWallId }: { modelId: string; curtainWallId: number }) {
  const { t } = useTranslation();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const types = useProjectStore((s) => s.elementTypes) ?? [];
  const curtainTypes = types.filter((x) => x.kind === 'curtainWall');
  const saved = useMemo(() => curtainWallRef(modelId, curtainWallId), [modelId, curtainWallId, mutationVersion]);
  const [draft, setDraft] = useState<CurtainWallSpec | null>(() => (saved ? structuredClone(saved.spec) : null));
  if (!saved || !draft) return <p className="text-xs text-zinc-500">{t('curtainCfg.notOne')}</p>;

  let layout: CurtainWallLayout | null = null;
  let problem: string | null = null;
  try { layout = curtainWallSpecLayout(draft); } catch (err) { problem = err instanceof Error ? err.message : String(err); }
  const panels = layout?.panels.length ?? 0;
  const dirty = saved.inferred || JSON.stringify(draft) !== JSON.stringify(saved.spec);
  const typeEntry = curtainTypes.find((x) => x.id === draft.typeId);

  // The build changed by hand: no longer the type's.
  const setBuild = (build: CurtainWallTypeSpec) => setDraft({ ...draft, ...build, typeId: undefined });
  const pickType = (id: string) => {
    const entry = curtainTypes.find((x) => x.id === id);
    if (entry?.kind === 'curtainWall') setDraft(specFromType(draft, { id: entry.id, spec: entry.curtain, height: entry.height }));
    else setDraft({ ...draft, typeId: undefined });
  };
  const saveAsType = () => {
    const id = addElementType('curtainWall');
    const entry = useProjectStore.getState().elementTypes?.find((x) => x.id === id);
    if (entry?.kind !== 'curtainWall') return;
    updateElementType({ ...entry, name: draft.name, height: draft.height, curtain: curtainWallTypeOf(draft) });
    setDraft({ ...draft, typeId: id });
    toast.success(t('curtainCfg.typeSaved', { name: draft.name }));
  };
  const apply = () => {
    const result = applyCurtainWall(saved, draft);
    if (result.ok) {
      toast.success(t('curtainCfg.applied'));
      closeCurtainWallDialog();
    } else toast.error(t('curtainCfg.failed', { detail: result.error }));
  };

  return (
    <>
      <div className="flex gap-4 text-xs">
        <div className="w-72 shrink-0 space-y-1">
          {saved.inferred ? <p className="rounded-sm bg-amber-50 p-2 text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t('curtainCfg.inferred')}</p> : null}
          <Field label={t('curtainCfg.name')}>
            <input aria-label={t('curtainCfg.name')} className={CELL} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label={t('curtainCfg.length')}><Mm label={t('curtainCfg.length')} value={lengthOf(draft)} onCommit={(l) => setDraft(withLength(draft, l))} /></Field>
          <Field label={t('curtainCfg.height')}><Mm label={t('curtainCfg.height')} value={draft.height} onCommit={(height) => setDraft({ ...draft, height })} /></Field>
          <Field label={t('curtainCfg.base')}>
            <Mm label={t('curtainCfg.base')} value={draft.start[2]} zero onCommit={(z) => setDraft({ ...draft, start: [draft.start[0], draft.start[1], z], end: [draft.end[0], draft.end[1], z] })} />
          </Field>
          <Field label={t('curtainCfg.type')}>
            <select aria-label={t('curtainCfg.type')} className={CELL} value={draft.typeId ?? ''} onChange={(e) => pickType(e.target.value)}>
              <option value="">{t('curtainCfg.noType')}</option>
              {curtainTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          {typeEntry ? <p className="text-zinc-500">{t('curtainCfg.typedHint', { name: typeEntry.name })}</p> : null}
          <CurtainTypeFields spec={draft} onChange={setBuild} />
          <Button size="sm" variant="outline" className="w-full" onClick={saveAsType}>{t('curtainCfg.saveAsType')}</Button>
        </div>
        <div className="flex-1 space-y-2">
          {layout ? <Elevation layout={layout} spec={draft} /> : null}
          {problem ? <p className="text-destructive">{problem}</p> : <p className="text-zinc-500">{t('curtainCfg.summary', { bays: layout!.uLines.length - 1, rows: layout!.vLines.length - 1, panels })}</p>}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={closeCurtainWallDialog}>{t('curtainCfg.cancel')}</Button>
        <Button disabled={!dirty || problem !== null} onClick={apply}>{t('curtainCfg.apply')}</Button>
      </DialogFooter>
    </>
  );
}

export function CurtainWallDialog() {
  const { t } = useTranslation();
  const target = useCurtainWallDialog((s) => s.target);
  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) closeCurtainWallDialog(); }}>
      <DialogContent className="sm:max-w-[780px] max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('curtainCfg.title')}</DialogTitle></DialogHeader>
        {target ? <Configurator key={`${target.modelId}:${target.curtainWallId}`} modelId={target.modelId} curtainWallId={target.curtainWallId} /> : null}
      </DialogContent>
    </Dialog>
  );
}
