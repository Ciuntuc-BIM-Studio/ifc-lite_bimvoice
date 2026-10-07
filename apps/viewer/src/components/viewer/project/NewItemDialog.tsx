/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A small form dialog for the Project Navigator's "New …" actions (level,
 * plan, elevation): text, number and choice fields, submitted together.
 * `onSubmit` returns an error message to show, or `null` on success.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type DialogField =
  | { key: string; label: string; type: 'text'; initial: string }
  | { key: string; label: string; type: 'number'; initial: number; step?: number }
  | { key: string; label: string; type: 'select'; initial: string; options: { value: string; label: string }[] };

export type DialogValues = Record<string, string>;

export interface NewItemDialogProps {
  open: boolean;
  title: string;
  submitLabel: string;
  fields: DialogField[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: DialogValues) => string | null;
}

const INPUT = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-foreground';

export function NewItemDialog({ open, title, submitLabel, fields, onOpenChange, onSubmit }: NewItemDialogProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<DialogValues>({});
  const [error, setError] = useState<string | null>(null);
  // Reset only when the dialog opens: `fields` is rebuilt on every render.
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(fieldsRef.current.map((f) => [f.key, String(f.initial)])));
    setError(null);
  }, [open]);

  const submit = () => {
    const message = onSubmit(values);
    if (message) setError(message);
    else onOpenChange(false);
  };
  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {fields.map((field, i) => (
            <label key={field.key} className="block space-y-1 text-sm">
              <span className="text-muted-foreground">{field.label}</span>
              {field.type === 'select' ? (
                <select className={INPUT} value={values[field.key] ?? field.initial} onChange={(e) => set(field.key, e.target.value)}>
                  {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  autoFocus={i === 0}
                  className={INPUT}
                  type={field.type === 'number' ? 'number' : 'text'}
                  step={field.type === 'number' ? field.step ?? 0.01 : undefined}
                  value={values[field.key] ?? String(field.initial)}
                  onChange={(e) => set(field.key, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                  }}
                />
              )}
            </label>
          ))}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('projectNavigator.dialog.cancel')}</Button>
          <Button onClick={submit}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
