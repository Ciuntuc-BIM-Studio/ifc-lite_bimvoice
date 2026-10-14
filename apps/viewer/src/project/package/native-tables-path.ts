/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Folder of a model's native tables inside the package, next to its IFC (no Arrow import, for the save path). */
export const nativeTablesFolder = (modelKey: string) => `models/${modelKey}/native`;
