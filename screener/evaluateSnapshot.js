#!/usr/bin/env node

import {
  computeScreenerSnapshot,
  evaluateScreenerSnapshot,
  getSpyMarketRegime,
} from "../src/screenerRules.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const payload = JSON.parse(input);
  const snapshot = computeScreenerSnapshot(payload.values);
  const marketRegime = payload.spyValues
    ? getSpyMarketRegime(computeScreenerSnapshot(payload.spyValues))
    : { allowModeA: payload.allowModeA !== false };
  const modes = evaluateScreenerSnapshot(snapshot, { allowModeA: marketRegime.allowModeA });
  process.stdout.write(JSON.stringify({ snapshot, modes, marketRegime }));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
