/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * String table - deduplicated string storage
 * Reduces memory by storing each unique string once
 */

export class StringTable {
  private strings: string[] = [''];
  /** value -> index; null until first needed (see `fromArray`). */
  private index: Map<string, number> | null = new Map([['', 0]]);

  readonly NULL_INDEX = -1;

  /**
   * Reconstruct a StringTable from a flat array as produced by `getAll()`.
   *
   * Used by the parser-worker → main thread transport so a complete table
   * round-trips without re-interning each string at every call site.
   * The first slot must be the canonical empty string at index 0. The
   * value -> index map is built on the first `intern` / `has` / `indexOf`:
   * a hydrated store mostly reads by index, and building the map for a
   * million-element model's two million strings cost the main thread most
   * of a second on every hydration.
   */
  static fromArray(strings: string[]): StringTable {
    const table = new StringTable();
    table.strings = strings.length > 0 && strings[0] === '' ? strings.slice() : ['', ...strings];
    table.index = null;
    return table;
  }

  private lookup(): Map<string, number> {
    if (this.index) return this.index;
    const index = new Map<string, number>();
    for (let i = 0; i < this.strings.length; i++) {
      // First occurrence wins so duplicate inputs (rare but possible
      // after manual concatenation) don't shadow the canonical index.
      if (!index.has(this.strings[i])) index.set(this.strings[i], i);
    }
    this.index = index;
    return index;
  }
  
  get count(): number {
    return this.strings.length;
  }
  
  /**
   * Get string by index
   */
  get(idx: number): string {
    if (idx < 0 || idx >= this.strings.length) {
      return '';
    }
    return this.strings[idx];
  }
  
  /**
   * Intern string (add if not exists, return index)
   */
  intern(value: string | null | undefined): number {
    if (value === null || value === undefined) {
      return this.NULL_INDEX;
    }
    
    const index = this.lookup();
    const existing = index.get(value);
    if (existing !== undefined) {
      return existing;
    }
    
    const newIndex = this.strings.length;
    this.strings.push(value);
    index.set(value, newIndex);
    return newIndex;
  }
  
  /**
   * Check if string exists
   */
  has(value: string): boolean {
    return this.lookup().has(value);
  }
  
  /**
   * Get index of string (returns -1 if not found)
   */
  indexOf(value: string): number {
    return this.lookup().get(value) ?? -1;
  }
  
  /**
   * Get all strings (for debugging/export)
   */
  getAll(): string[] {
    return [...this.strings];
  }
}
