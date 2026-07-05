import type { Worker } from './__types.generated';

// @flowmap-node avoidRouter__getWorker kind=function
/** lazily create the routing worker; returns null once it has proven unusable */
export function getWorker(): Worker | null {
  throw new Error('unimplemented');
}
