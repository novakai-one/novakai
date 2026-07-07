/* =====================================================================
   design.ts — K5 Design tab: factory composing model + render
   ---------------------------------------------------------------------
   Responsibility: initDesign(ctx) owns the loaded outcomes + the open-
   thread id in closure state, wires design-render's pure builders to
   design-model's pure transitions, and returns { render() } — the exact
   shape the shell calls on every route entry (SPEC_DESIGN.md §2/§4).
   No lifecycle: render() reloads from localStorage and starts at the
   rest view every time. That is also what makes journey B's "navigate
   away and back, still see the persisted row (not the reopened thread)"
   behaviour fall out for free — nothing needs to remember it was
   mid-thread across a route change.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { AssumptionKey, DesignOutcome } from './design-model';
import {
  answerDraft, answerSpecifics, confirmOutcome, discardOutcome,
  flipAssumption, handOffOutcome, loadOutcomes, saveOutcomes, startOutcome,
} from './design-model';
import type { DesignActions } from './design-render';
import { renderRest, renderThread } from './design-render';
import { initDesignLoop } from './design-loop-render';

export interface DesignApi {
  render(): HTMLElement;
}

const CONTRACTS_HASH = 'contracts';

interface DesignState {
  outcomes: DesignOutcome[];
  openId: string | null;
}

function paint(root: HTMLElement, state: DesignState, actions: DesignActions): void {
  root.innerHTML = '';
  const open = state.openId ? state.outcomes.find((outc) => outc.id === state.openId) ?? null : null;
  root.appendChild(open ? renderThread(open, actions) : renderRest(state.outcomes, actions));
}

function buildActions(ctx: AppContext, root: HTMLElement, state: DesignState): DesignActions {
  function commit(): void {
    saveOutcomes(state.outcomes);
    paint(root, state, actions);
  }
  function mutateOpen(fn: (outc: DesignOutcome) => DesignOutcome): void {
    state.outcomes = state.outcomes.map((outc) => (outc.id === state.openId ? fn(outc) : outc));
    commit();
  }
  const actions: DesignActions = {
    submitOutcome: (text) => {
      const created = startOutcome(state.outcomes, text);
      state.outcomes = [created, ...state.outcomes];
      state.openId = created.id;
      commit();
    },
    selectRow: (id) => { state.openId = id; paint(root, state, actions); },
    discard: (id) => {
      if (!confirm('Discard this draft?')) return;
      state.outcomes = discardOutcome(state.outcomes, id);
      state.openId = null;
      commit();
      ctx.hooks.toast('Draft discarded');
    },
    answerDraft: () => mutateOpen(answerDraft),
    answerSpecifics: (text) => { if (text.trim()) mutateOpen((outc) => answerSpecifics(outc, text)); },
    flipAssumption: (key: AssumptionKey) => mutateOpen((outc) => flipAssumption(outc, key)),
    confirm: () => mutateOpen(confirmOutcome),
    handOff: () => {
      mutateOpen(handOffOutcome);
      ctx.hooks.toast('Handed off to Contracts');
      location.hash = CONTRACTS_HASH;
    },
  };
  return actions;
}

export function initDesign(ctx: AppContext): DesignApi {
  function render(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'design-page';
    const state: DesignState = { outcomes: loadOutcomes(), openId: null };
    const actions = buildActions(ctx, root, state);
    paint(root, state, actions);
    root.appendChild(initDesignLoop().render());
    return root;
  }
  return { render };
}
