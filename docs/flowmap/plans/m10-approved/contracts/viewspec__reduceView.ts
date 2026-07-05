import type { ViewAction, ViewModelIndex, ViewSpec } from './__types.generated';

// @flowmap-node viewspec__reduceView kind=function
/** pure view reducer — returns a NEW spec, never mutates its (possibly frozen) input; centralizes the invariants: collapse folds descendants, reveal unhides the chain, last-visible-root hide guard, sel/selWire/focusType/fmOpen mutual exclusions, stage invalidates selWire */
export function reduceView(_spec: ViewSpec, _action: ViewAction, _model: ViewModelIndex): ViewSpec {
  throw new Error('unimplemented');
}
