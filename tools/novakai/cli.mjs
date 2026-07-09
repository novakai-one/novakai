// Implemented from contract packet b2e277cb… (contract-slice WI-7, node novakaiUnderstand__cli).
// Thin human dispatcher: forwards each verb to the existing npm script. No new behaviour.
import { spawnSync } from 'node:child_process';

const VERBS = {
  onboard: 'novakai:onboard',
  plan: 'novakai:plan-check',
  contract: 'novakai:contract',
  verify: 'novakai:verify',
  ship: 'novakai:ship',
  status: 'novakai:status',
};

const STAGE_BY_VERB = {
  onboard: 'understand',
  plan: 'plan',
  contract: 'implement — it emits the packet a subagent implements from',
  verify: 're-sync — the map-true-and-complete gate',
  ship: 're-sync — regenerates map+bodies from code',
  status: 'plan — verified work-state for resuming',
};

function printHelp() {
  const lines = [
    'novakai — one door onto the novakai:* npm scripts.',
    '',
    'Verbs:',
    ...Object.entries(VERBS).map(([verb, script]) => `  ${verb.padEnd(8)} -> npm run ${script}`),
    '  help     -> (prints this message, runs no script)',
    '',
    'Loop stages: understand -> plan -> review -> approve -> implement -> re-sync',
    ...Object.entries(STAGE_BY_VERB).map(([verb, stage]) => `  ${verb} serves: ${stage}`),
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function runVerb(script, rest) {
  const result = spawnSync('npm', ['run', script, '--', ...rest], { stdio: 'inherit' });
  if (result.status === null) {
    process.exit(1);
  }
  process.exit(result.status);
}

function main() {
  const verb = process.argv[2];

  if (verb === 'help') {
    printHelp();
    process.exit(0);
  }

  const script = VERBS[verb];
  if (!script) {
    process.stderr.write('usage: novakai <onboard|plan|contract|verify|ship|status|help> [args...]\n');
    process.exit(2);
  }

  runVerb(script, process.argv.slice(3));
}

main();
