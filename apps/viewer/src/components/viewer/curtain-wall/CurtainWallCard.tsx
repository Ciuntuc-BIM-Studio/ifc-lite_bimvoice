/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The selected curtain wall in the properties: its build at a glance, and its configurator. */

import { useMemo } from 'react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { curtainWallRef, openCurtainWallDialog } from '@/project/curtain-wall-element';

const CARD = 'mb-3 border border-overlay-accent/40 bg-overlay-accent/5 px-2 py-1.5 text-xs';
const TITLE = 'mb-1 text-xs font-semibold uppercase tracking-wide text-foreground';

export function CurtainWallCard({ modelId, expressId }: { modelId: string; expressId: number }) {
  const { t } = useTranslation();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const types = useProjectStore((s) => s.elementTypes);
  const ref = useMemo(() => { void mutationVersion; return curtainWallRef(modelId, expressId); }, [modelId, expressId, mutationVersion]);
  if (!ref) return null;
  const length = Math.hypot(ref.spec.end[0] - ref.spec.start[0], ref.spec.end[1] - ref.spec.start[1]);
  const type = types?.find((x) => x.id === ref.spec.typeId);
  return (
    <section data-curtain-wall-card className={CARD}>
      <p className={TITLE}>{t('curtainCfg.cardTitle', { name: ref.spec.name })}</p>
      <p className="mb-1 text-muted-foreground">
        {t('curtainCfg.cardSummary', { length: length.toFixed(2), height: ref.spec.height.toFixed(2) })}
        {type ? ` · ${type.name}` : ''}
      </p>
      {ref.inferred ? <p className="mb-1 text-2xs text-muted-foreground">{t('curtainCfg.cardInferred')}</p> : null}
      <Button size="sm" variant="outline" className="h-7" onClick={() => openCurtainWallDialog(ref)}>{t('curtainCfg.configure')}</Button>
    </section>
  );
}
