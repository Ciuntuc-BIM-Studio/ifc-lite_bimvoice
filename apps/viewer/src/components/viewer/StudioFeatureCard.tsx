/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The selected Studio solid in the properties: the steps it was built from
 * (`project/studio-feature.ts`) — sketch, face, operation, class — each
 * editable, the solid rebuilt from them in place.
 */

import { useMemo } from 'react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { contourMeasures } from '@/project/contour-quantities';
import { editSketch, setFeatureParam, studioFeatureOf, type StudioOperation } from '@/project/studio-feature';
import { EXTRUDE_CLASSES } from './drafting/DraftBimFields';

const CARD = 'mb-3 border border-overlay-accent/40 bg-overlay-accent/5 px-2 py-1.5 text-xs';
const TITLE = 'mb-1 text-xs font-semibold uppercase tracking-wide text-foreground';
const CELL = 'h-6 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1';

const OP_KEYS: Record<StudioOperation, TranslationKey> = {
  extrude: 'studioFeature.op.extrude', sweep: 'studioFeature.op.sweep', revolve: 'studioFeature.op.revolve',
};

function Step({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** A number committed on Enter or on leaving the field. */
function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const commit = (text: string) => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== 0 && v !== value) onCommit(v);
  };
  return (
    <input
      key={value}
      aria-label={label}
      type="number"
      step="any"
      className={CELL}
      defaultValue={value}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); }}
    />
  );
}

export function StudioFeatureCard({ modelId, expressId }: { modelId: string; expressId: number }) {
  const { t } = useTranslation();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const drafts = useProjectStore((s) => s.drafts);
  const feature = useMemo(() => { void mutationVersion; void drafts; return studioFeatureOf(modelId, expressId); }, [modelId, expressId, mutationVersion, drafts]);
  if (!feature) return null;
  const face = feature.face?.shape.type === 'hatch' ? contourMeasures(feature.face.shape.loops) : null;
  return (
    <section data-studio-feature-card className={CARD}>
      <p className={TITLE}>{t('studioFeature.title', { operation: t(OP_KEYS[feature.operation]) })}</p>
      <Step label={t('studioFeature.sketch')}>
        <span className="text-muted-foreground">{t('studioFeature.sketchSummary', { view: feature.view.name, holes: feature.holes.length })}</span>
      </Step>
      {face ? (
        <Step label={t('studioFeature.face')}><span className="text-muted-foreground">{t('studioFeature.faceSummary', { area: face.netArea.toFixed(2) })}</span></Step>
      ) : null}
      {feature.operation !== 'extrude' ? (
        <Step label={t(feature.operation === 'sweep' ? 'studioFeature.path' : 'studioFeature.axis')}>
          <span className={feature.guide ? 'text-muted-foreground' : 'text-destructive'}>{feature.guide ? feature.guide.shape.type : t('studioFeature.guideMissing')}</span>
        </Step>
      ) : null}
      {feature.depth !== undefined ? (
        <Step label={t('studioFeature.depth')}><NumberField label={t('studioFeature.depth')} value={feature.depth} onCommit={(v) => setFeatureParam(feature, 'depth', v)} /></Step>
      ) : null}
      {feature.angle !== undefined ? (
        <Step label={t('studioFeature.angle')}>
          <NumberField label={t('studioFeature.angle')} value={feature.angle} onCommit={(v) => { if (Math.abs(v) <= 360) setFeatureParam(feature, 'angle', v); }} />
        </Step>
      ) : null}
      <Step label={t('studioFeature.class')}>
        <select aria-label={t('studioFeature.class')} className={CELL} value={feature.ifcClass} onChange={(e) => setFeatureParam(feature, 'ifcClass', e.target.value)}>
          {[...new Set([feature.ifcClass, ...EXTRUDE_CLASSES])].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Step>
      <p className="my-1 text-2xs text-muted-foreground">{t('studioFeature.hint')}</p>
      <Button size="sm" variant="outline" className="h-7" onClick={() => editSketch(feature)}>{t('studioFeature.editSketch')}</Button>
    </section>
  );
}
