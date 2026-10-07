/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Properties of the selected drafted entities: identity (UUID), type,
 * layer, measured quantities and the free-form custom parameters, all
 * editable as one undoable drafting edit each.
 */

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { setDraftLayer, setDraftParams } from '@/drafting/draft-store';
import { measureShape, parseParamValue } from '@/drafting/measure';
import { isGeometry, type DraftEntity, type DraftLayer } from '@/drafting/types';
import type { HatchPattern } from '@/drafting/hatch/pattern';
import { AnnotationFields } from './AnnotationFields';

const TYPE_KEYS = {
  line: 'drafting.props.typeLine',
  polyline: 'drafting.props.typePolyline',
  circle: 'drafting.props.typeCircle',
  arc: 'drafting.props.typeArc',
  text: 'drafting.props.typeText',
  leader: 'drafting.props.typeLeader',
  dimension: 'drafting.props.typeDimension',
  radial: 'drafting.props.typeRadial',
  angular: 'drafting.props.typeAngular',
  level: 'drafting.props.typeLevel',
  hatch: 'drafting.props.typeHatch',
} as const;

const fmt = (n: number) => n.toFixed(3);

export function DraftPropertiesPanel({ entities, layers, extraPatterns }: { entities: DraftEntity[]; layers: DraftLayer[]; extraPatterns: readonly HatchPattern[] }) {
  const { t } = useTranslation();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  if (entities.length === 0) return null;
  const ids = new Set(entities.map((e) => e.id));
  const single = entities.length === 1 ? entities[0] : null;
  const layerId = entities.every((e) => e.layerId === entities[0].layerId) ? entities[0].layerId : '';
  // Parameters every selected entity shares (with the first one's value).
  const keys = Object.keys(entities[0].params).filter((k) => entities.every((e) => k in e.params));
  const measure = single && isGeometry(single.shape) ? measureShape(single.shape) : null;

  const addParam = () => {
    const key = newKey.trim();
    if (!key) return;
    setDraftParams(ids, { [key]: parseParamValue(newValue) });
    setNewKey('');
    setNewValue('');
  };

  return (
    <section
      aria-label={t('drafting.props.title')}
      className="absolute right-2 top-2 z-10 cursor-auto w-72 max-h-[80%] overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 p-3 text-xs shadow-md space-y-2"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <h3 className="font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
        {single ? t(TYPE_KEYS[single.shape.type]) : t('drafting.props.multiple', { count: entities.length })}
      </h3>
      {single ? <Row label={t('drafting.props.id')}><code className="break-all select-all text-2xs">{single.id}</code></Row> : null}
      <Row label={t('drafting.layer')}>
        <select
          aria-label={t('drafting.layer')}
          className="h-6 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent"
          value={layerId}
          onChange={(e) => setDraftLayer(ids, e.target.value)}
        >
          {layerId === '' ? <option value="">{t('drafting.props.mixed')}</option> : null}
          {layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Row>
      {single && !isGeometry(single.shape) ? <AnnotationFields entity={single} shape={single.shape} extraPatterns={extraPatterns} /> : null}
      {measure ? (
        <>
          <Row label={t('drafting.props.length')}>{t('drafting.unit.metres', { value: fmt(measure.length) })}</Row>
          {measure.radius !== undefined ? <Row label={t('drafting.props.radius')}>{t('drafting.unit.metres', { value: fmt(measure.radius) })}</Row> : null}
          {measure.area !== undefined ? <Row label={t('drafting.props.area')}>{t('drafting.unit.squareMetres', { value: fmt(measure.area) })}</Row> : null}
          {measure.angleDeg !== undefined ? <Row label={t('drafting.props.angle')}>{t('drafting.unit.degrees', { value: measure.angleDeg.toFixed(2) })}</Row> : null}
        </>
      ) : null}
      <h4 className="pt-1 font-semibold text-zinc-700 dark:text-zinc-300">{t('drafting.props.params')}</h4>
      {keys.length === 0 ? <p className="text-zinc-500">{t('drafting.props.noParams')}</p> : null}
      {keys.map((key) => (
        <div key={key} className="flex items-center gap-1">
          <span className="w-24 shrink-0 truncate text-zinc-500" title={key}>{key}</span>
          <input
            aria-label={key}
            className="min-w-0 flex-1 h-6 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1"
            defaultValue={String(entities[0].params[key])}
            key={`${key}:${String(entities[0].params[key])}`}
            onBlur={(e) => setDraftParams(ids, { [key]: parseParamValue(e.target.value) })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <IconButton label={t('drafting.props.removeParam', { key })} className="size-6" onClick={() => setDraftParams(ids, { [key]: null })}>
            <X className="size-3" />
          </IconButton>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input
          aria-label={t('drafting.props.newKey')}
          placeholder={t('drafting.props.newKey')}
          className="w-24 shrink-0 h-6 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <input
          aria-label={t('drafting.props.newValue')}
          placeholder={t('drafting.props.newValue')}
          className="min-w-0 flex-1 h-6 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addParam();
          }}
        />
        <IconButton label={t('drafting.props.addParam')} className="size-6" onClick={addParam}>
          <Plus className="size-3" />
        </IconButton>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <div className="min-w-0 text-right tabular-nums">{children}</div>
    </div>
  );
}
