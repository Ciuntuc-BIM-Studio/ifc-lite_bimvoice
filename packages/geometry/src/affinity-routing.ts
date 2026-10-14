/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Content-affinity routing of geometry jobs to the worker pool (#1130
 * follow-up — see `affinity_key` in Rust).
 */

/**
 * Jobs of one affinity key a worker takes before the key spills to the whole
 * pool. Routing a key to one worker meshes its geometry once, but every
 * occurrence still costs that worker its placement, instance and transfer
 * work — on a model where most elements share one geometry (a million
 * identical cubes, a façade of one panel type) that serialises the load on a
 * single worker while the rest idle. Past this many jobs the key round-robins
 * instead: each worker meshes it once more (a few meshes) and the occurrences
 * spread evenly.
 */
export const HOT_KEY_SPILL_JOBS = 512;

/**
 * Plan content-affinity routing for one chunk: assign each job (by index) to a
 * worker bucket so that every job sharing an affinity key lands on the SAME
 * worker — across the whole stream, since `keyToWorker` is the caller's sticky
 * map. New keys are handed out round-robin from `startWorker`, so each worker
 * owns roughly `1/workerCount` of the distinct keys (≈ distinct geometries, the
 * dominant meshing cost). With `keyJobs` (the caller's sticky per-key job
 * count), a key past `HOT_KEY_SPILL_JOBS` jobs spills round-robin across the
 * pool instead. Pure: mutates only the passed maps and returns the advanced
 * round-robin cursor.
 */
export function planAffinityRouting(
  affinity: Uint32Array,
  totalJobs: number,
  workerCount: number,
  keyToWorker: Map<number, number>,
  startWorker: number,
  keyJobs?: Map<number, number>,
): { buckets: number[][]; nextWorker: number } {
  const buckets: number[][] = Array.from({ length: workerCount }, () => []);
  let nextWorker = startWorker % workerCount;
  for (let j = 0; j < totalJobs; j++) {
    const key = affinity[j];
    let w = keyToWorker.get(key);
    if (w === undefined) {
      w = nextWorker;
      nextWorker = (nextWorker + 1) % workerCount;
      keyToWorker.set(key, w);
    }
    if (keyJobs) {
      const seen = (keyJobs.get(key) ?? 0) + 1;
      keyJobs.set(key, seen);
      if (seen > HOT_KEY_SPILL_JOBS) w = (w + seen) % workerCount;
    }
    buckets[w].push(j);
  }
  return { buckets, nextWorker };
}
