import type { Hooks } from './__types.generated';

// @flowmap-node context__createHooks kind=function
/** seed Hooks with throwing placeholders so a hook called before boot fails loudly */
export function createHooks(): Hooks {
  throw new Error('unimplemented');
}
