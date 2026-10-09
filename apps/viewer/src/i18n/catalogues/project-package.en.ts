/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { TranslationValue } from '../types';
export const projectPackageEn = {
  'projectPackage.open': 'Open project',
  'projectPackage.save': 'Save project',
  'projectPackage.saveAs': 'Save project as…',
  'projectPackage.link': 'Link model',
  'projectPackage.nothingToSave': 'Nothing to save yet: open or create a model first',
  'projectPackage.saving': 'Saving the project…',
  'projectPackage.savingModel': 'Saving model {name}…',
  'projectPackage.saved': 'Project saved to {name} ({mb} MB)',
  'projectPackage.saveFailed': 'The project could not be saved: {detail}',
  'projectPackage.opening': 'Opening the project…',
  'projectPackage.openingModel': 'Loading model {name}…',
  'projectPackage.opened': 'Project {name} opened',
  'projectPackage.openFailed': 'The project could not be opened: {detail}',
  'projectPackage.modelsFailed': 'Some models did not load: {names}',
  'projectPackage.discardChanges': 'The open project has unsaved changes. Open another project and discard them?',
  'projectPackage.openAnyway': 'Open anyway',
  'projectPackage.linked': '{name} linked (read-only)',
  'projectPackage.linkedTitle': 'Linked models',
  'projectPackage.linkedHint': 'This project refers to these coordination models. Locate each file to load it read-only, or skip.',
  'projectPackage.locate': 'Locate…',
  'projectPackage.skipLinked': 'Skip',
  'projectPackage.recoveryTitle': 'Unsaved project found',
  'projectPackage.recoveryText': '"{name}" had unsaved changes when the app closed (copy from {time}).',
  'projectPackage.recoveryOpen': 'Recover',
  'projectPackage.recoveryDiscard': 'Discard',
} as const satisfies Record<string, TranslationValue>;
