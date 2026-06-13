// Node CLI compatibility layer.
// 실제 Mode A/B 규칙은 브라우저와 공유하는 src/screenerRules.js에만 정의한다.

import {
  evaluateModeA,
  evaluateModeB,
  MODE_A_REQUIRED,
  MODE_A_CONFIRMATION,
  MODE_B_CONDITIONS,
  SCREENER_RULE_VERSION,
} from "../src/screenerRules.js";

export const MODE_A = {
  id: "A",
  name: "추세추종",
  version: SCREENER_RULE_VERSION.A,
  conditions: [...MODE_A_REQUIRED, ...MODE_A_CONFIRMATION],
};

export const MODE_B = {
  id: "B",
  name: "역추세반등",
  version: SCREENER_RULE_VERSION.B,
  conditions: MODE_B_CONDITIONS,
};

export const MODES = [MODE_A, MODE_B];

export function evalMode(indicators, mode) {
  const result = mode.id === "A" ? evaluateModeA(indicators) : evaluateModeB(indicators);
  return result ? { passed: true, ...result } : null;
}
