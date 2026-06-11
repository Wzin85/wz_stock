// ── 지표 계산 + API fetch ─────────────────────────────────────
// computeIndicators: 순수 함수 (캐시 재사용 가능)
// fetchRaw: HTTP 호출 + 429 자동 재시도

import { SCREENER_CONFIG } from "./config.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gains += ch; else losses -= ch;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (ch > 0 ? ch : 0)) / period;
    al = (al * (period - 1) + (ch < 0 ? -ch : 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function calcBollinger(closes, period = 20, mult = 2) {
  const sl = closes.slice(-period);
  const m = avg(sl);
  const sd = Math.sqrt(avg(sl.map(c => (c - m) ** 2)));
  return { upper: m + mult * sd, middle: m, lower: m - mult * sd };
}

// values: Twelve Data 응답 (최신→과거 순)
export function computeIndicators(values) {
  const data = [...values].reverse();
  const closes = data.map(d => parseFloat(d.close));
  const highs  = data.map(d => parseFloat(d.high));
  const lows   = data.map(d => parseFloat(d.low));
  const vols   = data.map(d => parseFloat(d.volume));
  const n = closes.length;
  const cur = closes[n - 1];

  const rsi  = calcRSI(closes);
  const ma20 = avg(closes.slice(-20));
  const ma50 = n >= 50 ? avg(closes.slice(-50)) : null;
  const bb   = calcBollinger(closes);
  const bbRange = bb.upper - bb.lower;
  const bbPos = bbRange > 0 ? (cur - bb.lower) / bbRange : 0.5;

  const avgVol   = avg(vols.slice(-20));
  const volRatio = avgVol > 0 ? vols[n - 1] / avgVol : 1;

  const atrLook = Math.min(14, n - 1);
  let trSum = 0;
  for (let i = n - atrLook; i < n; i++) {
    trSum += Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }
  const atrPct = atrLook > 0 ? (trSum / atrLook / cur) * 100 : 0;

  const lb     = Math.min(252, n);
  const h52    = Math.max(...highs.slice(-lb));
  const l52    = Math.min(...lows.slice(-lb));
  const fromH52 = h52 > 0 ? ((cur - h52) / h52) * 100 : 0;
  const pos52w  = h52 > l52 ? Math.round(((cur - l52) / (h52 - l52)) * 100) : 50;

  return { cur, rsi, ma20, ma50, bbPos, volRatio, atrPct, fromH52, pos52w, h52, l52 };
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
