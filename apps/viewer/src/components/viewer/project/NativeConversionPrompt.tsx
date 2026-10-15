/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The load-time choice for an imported IFC (N7, decision 5): once a model the
 * user loaded (not one a project or a recovery opened) has finished loading,
 * and it has something the native schema can take over (untyped doors and
 * windows today), it offers to keep it as IFC or convert it to native. Asked
 * once per model; the walls, slabs and members Lapin already reads stay as
 * they are either way. A model a project opened is asked too, once it is
 * open, when it still has untyped doors and windows (placed before the tools
 * typed every one): they take their joinery types of size the same way.
 */

import { useEffect, useState } from 'react';
import type { NativeConversionPlan } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { usePackageSession } from '@/project/package/session';
import { convertModelToNative, planModelConversion } from '@/lib/native/convert-model';

/** Models already asked about (or linked, which are not asked). */
const asked = new Set<string>();
/** Models a project or a recovery opened: asked about their untyped joinery only. */
const fromProject = new Set<string>();

interface Offer { modelId: string; name: string; plan: NativeConversionPlan; project: boolean }

export function NativeConversionPrompt() {
  const { t } = useTranslation();
  const [offer, setOffer] = useState<Offer | null>(null);

  useEffect(() => {
    const check = () => {
      // A project or a recovery being opened loads its own models: asked once it is open.
      const opening = usePackageSession.getState().busy !== null;
      for (const [id, model] of useViewerStore.getState().models) {
        if (asked.has(id)) continue;
        if (model.linked) { asked.add(id); continue; }
        if (opening) { fromProject.add(id); continue; }
        if (model.loadState !== 'complete') continue;
        asked.add(id);
        const project = fromProject.has(id);
        setTimeout(() => {
          const plan = useViewerStore.getState().models.has(id) ? planModelConversion(id) : null;
          if (plan && plan.joinery.length > 0) setOffer({ modelId: id, name: model.name, plan, project });
        }, 300);
      }
    };
    const offViewer = useViewerStore.subscribe(check);
    const offSession = usePackageSession.subscribe(check);
    return () => { offViewer(); offSession(); };
  }, []);

  if (!offer) return null;
  const joinery = offer.plan.joinery.reduce((n, g) => n + g.ids.length, 0);
  const remaining = offer.plan.remaining.reduce((n, [, c]) => n + c, 0);
  return (
    <output className="fixed bottom-14 left-4 z-50 block w-96 space-y-2 rounded-md border border-primary bg-white p-3 text-xs shadow-lg dark:bg-zinc-900">
      <p className="font-semibold">{t(offer.project ? 'joinery.untypedTitle' : 'projectPackage.convertTitle', { name: offer.name })}</p>
      <p className="text-muted-foreground">{offer.project
        ? t('joinery.untypedText', { joinery: String(joinery), types: String(offer.plan.joinery.length) })
        : t('projectPackage.convertText', {
          joinery: String(joinery), types: String(offer.plan.joinery.length), native: String(offer.plan.native), remaining: String(remaining),
        })}</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOffer(null)}>{t(offer.project ? 'joinery.untypedKeep' : 'projectPackage.convertKeep')}</Button>
        <Button size="sm" onClick={() => {
          const current = offer;
          setOffer(null);
          const outcome = convertModelToNative(current.modelId, current.plan);
          if (outcome.refused.length && outcome.converted === 0) toast.error(t('projectPackage.convertFailed', { reason: outcome.refused[0] }));
          else toast.success(t('projectPackage.convertDone', { converted: String(outcome.converted), types: String(outcome.types) }));
        }}>{t(offer.project ? 'joinery.untypedApply' : 'projectPackage.convertNative')}</Button>
      </div>
    </output>
  );
}
