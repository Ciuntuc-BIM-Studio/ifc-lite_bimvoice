/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The drafting command line: the last few history lines, the running
 * command's prompt, and an input for command names, coordinates
 * (`x,y`, `@dx,dy`, `@d<angle`), distances, values and keywords.
 */

import { forwardRef } from 'react';
import { useTranslation } from '@/i18n';
import { useDraftingSession } from '@/drafting/session';

interface CommandLineProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onEscape: () => void;
}

export const CommandLine = forwardRef<HTMLInputElement, CommandLineProps>(function CommandLine({ value, onChange, onSubmit, onEscape }, ref) {
  const { t } = useTranslation();
  const history = useDraftingSession((s) => s.history);
  const prompt = useDraftingSession((s) => s.prompt);
  const recent = history.slice(-3);
  return (
    <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono text-xs">
      <div className="px-3 pt-1 text-zinc-500 dark:text-zinc-400" aria-live="polite">
        {recent.map((line, i) => (
          <div key={i} className="truncate">
            {line.typed !== undefined ? `> ${line.typed}` : t(line.key, line.params)}
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 px-3 py-1.5">
        <span className="shrink-0 text-zinc-800 dark:text-zinc-200">{prompt ? t(prompt.key, prompt.params) : t('drafting.prompt.idle')}</span>
        <input
          ref={ref}
          aria-label={t('drafting.commandLine')}
          className="min-w-0 flex-1 bg-transparent outline-none text-zinc-900 dark:text-zinc-100"
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onEscape();
            } else if (e.key === ' ' && value.trim() === '') {
              // Space on an empty line repeats / confirms, as in CAD.
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </label>
    </div>
  );
});
