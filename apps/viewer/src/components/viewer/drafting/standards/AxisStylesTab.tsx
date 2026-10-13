/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Axis types editor: the project's grid axis types on the left (the current
 * one — what AXIS draws — and the project default — what AXIS starts with
 * and the BIM grids in views are drawn with — marked, duplicate / delete), the selected type's
 * bubble, ends, size, line type, colour, label text style and first label on
 * the right, applied at once to every axis of the type. Previews a vertical
 * and a horizontal axis at 1:100.
 */

import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useProjectStore } from '@/project/project-store';
import { addAxisStyle, removeAxisStyle, setDefaultAxisStyle, updateAxisStyle } from '@/project/drafting-standards';
import { currentStyles, setCurrentStyles, useDraftingSession } from '@/drafting/session';
import {
  DEFAULT_AXIS_STYLE, DEFAULT_DIM_STYLE, DEFAULT_TEXT_STYLE, STANDARD,
  type AxisBubble, type AxisStyle, type LineType, type TextStyle,
} from '@/drafting/styles';
import { nextAxisLabel } from '@/drafting/annotation';
import type { AxisEnds, AxisShape } from '@/drafting/types';
import { AnnotationGraphics } from '../AnnotationGraphics';
import { ColorChoice, INPUT, NumberField, Row, StyleList, useSelected } from './StyleTabs';

const LINE_TYPES = ['dashdot', 'dashed', 'dotted', 'continuous'] as const;
/** Paper mm → preview metres at 1:100. */
const AT_100 = 0.1;

function AxisPreview({ style, text }: { style: AxisStyle; text: TextStyle }) {
  const { t } = useTranslation();
  const look = { text, dim: DEFAULT_DIM_STYLE, axis: style };
  const common = { bubble: style.bubble, ends: style.ends, size: style.size * AT_100, height: text.height * AT_100, lineType: style.lineType };
  const axes: AxisShape[] = [
    { type: 'axis', a: { x: 1.8, y: 1.3 }, b: { x: 1.8, y: 4.3 }, label: style.firstLabel, ...common },
    { type: 'axis', a: { x: 3.9, y: 2.8 }, b: { x: 8.4, y: 2.8 }, label: nextAxisLabel(style.firstLabel), ...common },
  ];
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800">
      <svg width={300} height={170} aria-hidden="true">
        {axes.map((shape, i) => (
          <AnnotationGraphics key={i} shape={shape} color="#18181b" selected={false}
            transform={{ scale: 30, x: 10, y: 165 }} axis="front" extraPatterns={[]} look={look} paperUnit={AT_100} />
        ))}
      </svg>
      <figcaption className="text-2xs text-zinc-500">{t('standards.axis.preview')}</figcaption>
    </figure>
  );
}

export function AxisStylesTab() {
  const { t } = useTranslation();
  useDraftingSession((s) => s.revision);
  const styles = useProjectStore((s) => s.axisStyles) ?? [DEFAULT_AXIS_STYLE];
  const textStyles = useProjectStore((s) => s.textStyles) ?? [DEFAULT_TEXT_STYLE];
  const [selected, select] = useSelected(styles);
  const style = styles.find((s) => s.id === selected) ?? DEFAULT_AXIS_STYLE;
  const set = (patch: Partial<AxisStyle>) => updateAxisStyle(style.id, patch);
  const text = textStyles.find((s) => s.id === style.textStyle) ?? DEFAULT_TEXT_STYLE;
  const current = currentStyles().axisStyle;
  const projectDefault = useProjectStore((s) => s.defaultAxisStyle) ?? STANDARD;
  return (
    <div className="flex gap-4 text-xs">
      <StyleList styles={styles} selected={selected} current={current} onSelect={select}
        onDuplicate={(s) => select(addAxisStyle(s, t('standards.style.copyName', { name: s.name })))} onDelete={removeAxisStyle} />
      <div className="flex-1 space-y-1">
        <Row label={t('standards.style.name')}>
          <input aria-label={t('standards.style.name')} className={INPUT} defaultValue={style.name} key={style.id + style.name} onBlur={(e) => e.target.value.trim() && set({ name: e.target.value.trim() })} />
        </Row>
        <Row label={t('standards.axis.bubble')}>
          <SegmentedControl size="sm" label={t('standards.axis.bubble')} value={style.bubble} onValueChange={(bubble: AxisBubble) => set({ bubble })}
            options={(['circle', 'square'] as const).map((b) => ({ value: b, label: t(`standards.axis.bubble.${b}` as TranslationKey) }))} />
        </Row>
        <Row label={t('standards.axis.ends')}>
          <SegmentedControl size="sm" label={t('standards.axis.ends')} value={style.ends} onValueChange={(ends: AxisEnds) => set({ ends })}
            options={(['both', 'start', 'end', 'none'] as const).map((e) => ({ value: e, label: t(`standards.axis.ends.${e}` as TranslationKey) }))} />
        </Row>
        <Row label={t('standards.axis.size')}><NumberField label={t('standards.axis.size')} value={style.size} min={1} step={0.5} onCommit={(size) => set({ size })} /></Row>
        <Row label={t('standards.axis.lineType')}>
          <select aria-label={t('standards.axis.lineType')} className={INPUT} value={style.lineType} onChange={(e) => set({ lineType: e.target.value as LineType })}>
            {LINE_TYPES.map((l) => <option key={l} value={l}>{t(`standards.layer.type.${l}` as TranslationKey)}</option>)}
          </select>
        </Row>
        <Row label={t('standards.axis.color')}><ColorChoice label={t('standards.axis.color')} value={style.color} onChange={(color) => set({ color })} /></Row>
        <Row label={t('standards.axis.textStyle')}>
          <select aria-label={t('standards.axis.textStyle')} className={INPUT} value={style.textStyle} onChange={(e) => set({ textStyle: e.target.value })}>
            {textStyles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Row>
        <Row label={t('standards.axis.firstLabel')}>
          <input aria-label={t('standards.axis.firstLabel')} className={INPUT} defaultValue={style.firstLabel} key={style.id + style.firstLabel}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== style.firstLabel && set({ firstLabel: e.target.value.trim() })} />
        </Row>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={current === style.id} onClick={() => setCurrentStyles({ axisStyle: style.id, firstAxisLabel: style.firstLabel })}>
            {t('standards.style.makeCurrent')}
          </Button>
          <Button size="sm" variant="outline" disabled={projectDefault === style.id} onClick={() => setDefaultAxisStyle(style.id)}>
            {projectDefault === style.id ? t('standards.axis.isDefault') : t('standards.axis.makeDefault')}
          </Button>
        </div>
      </div>
      <div className="w-[320px] shrink-0 space-y-2">
        <AxisPreview style={style} text={text} />
        <p className="text-2xs text-zinc-500">{t('standards.axis.rule')}</p>
      </div>
    </div>
  );
}
