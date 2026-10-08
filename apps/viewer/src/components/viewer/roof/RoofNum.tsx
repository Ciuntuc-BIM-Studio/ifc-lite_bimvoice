/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A compact number cell for the roof configurator's tables, committed on Enter or blur. */

import { useState } from 'react';

export const CELL = 'h-7 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-xs tabular-nums';

export function Num({ value, onCommit, label, disabled, scale = 1 }: { value: number; onCommit: (v: number) => void; label: string; disabled?: boolean; scale?: number }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const n = Number(text.replace(',', '.'));
    setText(null);
    if (Number.isFinite(n) && n >= 0) onCommit(n / scale);
  };
  return (
    <input aria-label={label} className={CELL} disabled={disabled} inputMode="decimal" value={text ?? String(Math.round(value * scale * 100) / 100)}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setText(null); }} />
  );
}
