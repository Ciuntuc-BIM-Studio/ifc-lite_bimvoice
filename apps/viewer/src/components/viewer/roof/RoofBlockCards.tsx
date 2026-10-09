/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A roof system in the properties: the roof's card (Edit roof as a block,
 * the configurator; inside the block, Restore deleted parts and Finish) and,
 * inside the block, the selected part's card — delete or reset it, and for a
 * member its section, how far it runs past (or short of) each end, and how
 * each end is cut; a colour of its own for any part. Every change is an
 * override on the roof, kept when it regenerates.
 */

import { useMemo, useState } from 'react';
import { END_CUTS, type EndCut, type RoofPartOverride } from '@ifc-lite/create';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { roofSystemOfRenderId } from '@/project/roof-system-element';
import { openRoofDialog, stopRoofEdit, useRoofDialog } from '@/project/roof-dialog-store';
import { deletedPartCount, editRoofBlock, restoreDeletedParts, roofPartOfRenderId, setPartOverride, type RoofPartRef } from '@/project/roof-block';

const CARD = 'mb-3 border border-overlay-accent/40 bg-overlay-accent/5 px-2 py-1.5 text-xs';
const TITLE = 'mb-1 text-xs font-semibold uppercase tracking-wide text-foreground';
const ROLES = new Set(['plane', 'rafter', 'hip', 'valley', 'ridge', 'purlin', 'plate', 'chord', 'tie', 'post', 'strut']);
const FIELD = 'h-7 w-full rounded-sm border border-zinc-300 bg-transparent px-1 tabular-nums dark:border-zinc-700';

function report(result: { ok: true } | { ok: false; error: string }, failed: string): void {
  if (!result.ok) toast.error(`${failed}: ${result.error}`);
}

/** The roof and part cards for the inspected element (nothing when it is not part of a roof system). */
export function RoofBlockCards({ modelId, expressId }: { modelId: string; expressId: number }) {
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const editing = useRoofDialog((s) => s.editing);
  const renderId = useViewerStore((s) => toGlobalIdFromModels(s.models, modelId, expressId));
  const roof = useMemo(() => { void mutationVersion; return roofSystemOfRenderId(renderId); }, [renderId, mutationVersion]);
  const part = useMemo(() => { void mutationVersion; void editing; return roofPartOfRenderId(renderId); }, [renderId, mutationVersion, editing]);
  if (!roof) return null;
  return (
    <>
      <RoofCard roof={roof} renderId={renderId} />
      {part ? <RoofPartCard part={part} /> : null}
    </>
  );
}

function RoofCard({ roof, renderId }: { roof: NonNullable<ReturnType<typeof roofSystemOfRenderId>>; renderId: number }) {
  const { t } = useTranslation();
  const editing = useRoofDialog((s) => s.editing);
  const inside = editing?.modelId === roof.modelId && editing.roofId === roof.roofId;
  const deleted = inside ? deletedPartCount(roof.modelId, roof.roofId) : 0;
  return (
    <section data-roof-card className={CARD}>
      <p className={TITLE}>{t('roofBlock.title', { name: roof.spec.name })}</p>
      <div className="flex flex-wrap gap-1">
        {inside ? (
          <>
            {deleted > 0 ? <Button size="sm" variant="outline" className="h-7" onClick={() => report(restoreDeletedParts(roof.modelId, roof.roofId), t('roofBlock.failed'))}>{t('roofBlock.restore', { count: deleted })}</Button> : null}
            <Button size="sm" className="h-7" onClick={stopRoofEdit}>{t('roofBlock.finish')}</Button>
          </>
        ) : (
          <Button size="sm" variant="outline" className="h-7" onClick={() => editRoofBlock(renderId)}>{t('roofBlock.edit')}</Button>
        )}
        <Button size="sm" variant="ghost" className="h-7" onClick={() => openRoofDialog(roof)}>{t('roofBlock.configure')}</Button>
      </div>
      {inside ? <p className="mt-1 text-2xs text-muted-foreground">{t('roofBlock.insideHint')}</p> : null}
    </section>
  );
}

/** A millimetre field committed on Enter or blur. */
function Mm({ label, value, onCommit, allowNegative }: { label: string; value: number; onCommit: (m: number) => void; allowNegative?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const n = Number(text.replace(',', '.'));
    setText(null);
    if (Number.isFinite(n) && (allowNegative || n > 0)) onCommit(n / 1000);
  };
  return (
    <label className="grid grid-cols-[1fr_5.5rem] items-center gap-2">
      <span className="truncate text-muted-foreground">{label}</span>
      <input aria-label={label} className={FIELD} inputMode="decimal" value={text ?? String(Math.round(value * 1000))}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') setText(null); }} />
    </label>
  );
}

function RoofPartCard({ part }: { part: RoofPartRef }) {
  const { t } = useTranslation();
  const o: RoofPartOverride = part.spec.overrides?.[part.key] ?? {};
  const set = (patch: RoofPartOverride | null) => report(setPartOverride(part, patch), t('roofBlock.failed'));
  const member = part.kind === 'member';
  const cut = (label: string, value: EndCut | undefined, key: 'startCut' | 'endCut') => (
    <label className="grid grid-cols-[1fr_5.5rem] items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <select aria-label={label} className={FIELD} value={value ?? ''} onChange={(e) => set({ [key]: (e.target.value || undefined) as EndCut | undefined })}>
        <option value="">{t('roofBlock.cut.default')}</option>
        {END_CUTS.map((c) => <option key={c} value={c}>{t(`roofBlock.cut.${c}`)}</option>)}
      </select>
    </label>
  );
  const spec = part.spec.structure;
  const defaultSection = part.role === 'purlin' ? spec.purlin : part.role === 'ridge' ? spec.ridge : part.role === 'plate' ? spec.wallPlate
    : part.role === 'hip' || part.role === 'valley' ? spec.hipRafter : part.role === 'chord' || part.role === 'tie' ? spec.truss?.chord
    : part.role === 'post' || part.role === 'strut' ? spec.truss?.web : spec.rafter;
  return (
    <section data-roof-part-card className={`${CARD} space-y-1.5`}>
      <p className={TITLE}>{t('roofBlock.part', { role: ROLES.has(part.role) ? t(`roofBlock.role.${part.role}` as TranslationKey) : part.role })}</p>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" className="h-7 text-red-600" onClick={() => set({ deleted: true })}>{t('roofBlock.deletePart')}</Button>
        {Object.keys(o).length ? <Button size="sm" variant="ghost" className="h-7" onClick={() => set(null)}>{t('roofBlock.reset')}</Button> : null}
      </div>
      {member ? (
        <>
          <Mm label={t('roofBlock.width')} value={o.width ?? defaultSection?.width ?? 0.08} onCommit={(width) => set({ width })} />
          <Mm label={t('roofBlock.depth')} value={o.depth ?? defaultSection?.depth ?? 0.16} onCommit={(depth) => set({ depth })} />
          <Mm label={t('roofBlock.extendStart')} value={o.extendStart ?? 0} allowNegative onCommit={(extendStart) => set({ extendStart })} />
          <Mm label={t('roofBlock.extendEnd')} value={o.extendEnd ?? 0} allowNegative onCommit={(extendEnd) => set({ extendEnd })} />
          {cut(t('roofBlock.startCut'), o.startCut, 'startCut')}
          {cut(t('roofBlock.endCut'), o.endCut, 'endCut')}
        </>
      ) : null}
      <label className="flex items-center gap-2">
        <input type="color" aria-label={t('roofBlock.color')} className="h-6 w-8 rounded-sm border border-zinc-300 dark:border-zinc-700"
          key={`${part.key}:${o.color ?? ''}`} defaultValue={o.color ?? (member ? part.spec.timberColor : part.spec.covering.color)}
          onBlur={(e) => { if (e.target.value !== (o.color ?? '')) set({ color: e.target.value }); }} />
        <span className="text-muted-foreground">{t('roofBlock.color')}</span>
      </label>
    </section>
  );
}
