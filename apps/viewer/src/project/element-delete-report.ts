/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** What a Delete did, told once: how many elements left the model, or why not. */

import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import type { DeleteOutcome } from './element-delete';

export function reportDelete(out: DeleteOutcome): void {
  if (out.deleted > 0) toast.success(resolve('elementDelete.done', { count: out.deleted }));
  const reasons = [...new Set(out.refused)];
  if (reasons.length) toast.error(resolve('elementDelete.refused', { reasons: reasons.join('; ') }));
}
