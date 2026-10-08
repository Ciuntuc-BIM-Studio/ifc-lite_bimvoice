/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Drafting standards: layers (with groups and per-view visibility), text
 * styles and dimension styles — one dialog, opened from the Annotations tab,
 * a drawing tab's header or a selected annotation (`openStandards`).
 */

import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { closeStandards, useStandardsDialog, type StandardsTab } from '@/project/standards-dialog-store';
import { LayersTab } from './LayersTab';
import { DimStylesTab, TextStylesTab } from './StyleTabs';

export function DraftingStandardsDialog() {
  const { t } = useTranslation();
  const tab = useStandardsDialog((s) => s.tab);
  return (
    <Dialog open={tab !== null} onOpenChange={(open) => { if (!open) closeStandards(); }}>
      <DialogContent className="sm:max-w-[980px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('standards.title')}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab ?? 'layers'} onValueChange={(value) => useStandardsDialog.setState({ tab: value as StandardsTab })}>
          <TabsList>
            <TabsTrigger value="layers">{t('standards.tab.layers')}</TabsTrigger>
            <TabsTrigger value="text">{t('standards.tab.text')}</TabsTrigger>
            <TabsTrigger value="dim">{t('standards.tab.dim')}</TabsTrigger>
          </TabsList>
          <TabsContent value="layers" className="pt-3"><LayersTab /></TabsContent>
          <TabsContent value="text" className="pt-3"><TextStylesTab /></TabsContent>
          <TabsContent value="dim" className="pt-3"><DimStylesTab /></TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={closeStandards}>{t('standards.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
