/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Project package requests from commands and shortcuts, handled by `ProjectPackageHost`. */

export type PackageAction = 'open' | 'save' | 'save-as' | 'link' | 'save-version' | 'update-version' | 'history';
export const PACKAGE_ACTION_EVENT = 'bimvoice:project-package';

export function requestPackageAction(action: PackageAction): void {
  window.dispatchEvent(new CustomEvent<PackageAction>(PACKAGE_ACTION_EVENT, { detail: action }));
}
