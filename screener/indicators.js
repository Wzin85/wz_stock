// ── 지표 계산 + API fetch ─────────────────────────────────────
// computeIndicators: 순수 함수 (캐시 재사용 가능)
// fetchRaw: HTTP 호출 + 429 자동 재시도

import { SCREENER_CONFIG } from "./config.js";
import { computeScreenerSnapshot } from "../src/screenerRules.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// values: Twelve Data 응답 (최신→과거 순)
export function computeIndicators(values) {
  const snapshot = computeScreenerSnapshot(values);
  return {
    ...snapshot,
    cur: snapshot.close,
    bbPos: snapshot.bb_pos,
    volRatio: snapshot.vol_ratio,
    fromH52: snapshot.from_h52,
    pos52w: Math.round(snapshot.pos52w * 100),
    mfRatio: snapshot.mf_ratio,
    ma20GapPct: snapshot.ma20_gap_pct,
    atrPct: snapshot.atr_pct,
  };
}

// 429 자동 재시도 포함 raw values fetch
// onRetry 콜백: 429 발생 시 진행 표시줄 업데이트용
export async function fetchRaw(sym, apiKey, cfg = SCREENER_CONFIG, onRetry = null) {
  const url =
    `${cfg.apiBaseUrl}/time_series` +
    `?symbol=${sym}&interval=${cfg.interval}&outputsize=${cfg.outputsize}&apikey=${apiKey}`;

  for (let attempt = 0; attempt < cfg.retryMaxAttempts; attempt++) {
    const res = await fetch(url);

    if (res.status === 429) {
      const waitMs = cfg.retryWaitMs;
      if (onRetry) onRetry(attempt + 1, cfg.retryMaxAttempts, waitMs);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (json.status === "error" || !json.values) throw new Error(json.message || "데이터 없음");
    if (json.values.length < 55) throw new Error("데이터 부족 (MA50 계산 불가)");

    return json.values;
  }
  throw new Error(`429 재시도 ${cfg.retryMaxAttempts}회 초과`);
}
