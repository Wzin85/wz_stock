// ── App.jsx에서 추출한 순수 지표 함수 ────────────────────────
// (스크리너 전용 — 무거운 지표는 제외)

import { SCREENER_CONFIG } from "./config.js";

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

function computeIndicators(values) {
  // values: Twelve Data 응답 (최신→과거 순)
  const data = [...values].reverse(); // 과거→최신 정렬
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

  const avgVol  = avg(vols.slice(-20));
  const volRatio = avgVol > 0 ? vols[n - 1] / avgVol : 1;

  // ATR(14)
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

  // 52주 위치
  const lb  = Math.min(252, n);
  const h52 = Math.max(...highs.slice(-lb));
  const l52 = Math.min(...lows.slice(-lb));
  const fromH52 = h52 > 0 ? ((cur - h52) / h52) * 100 : 0;
  const pos52w  = h52 > l52 ? Math.round(((cur - l52) / (h52 - l52)) * 100) : 50;

  return { cur, rsi, ma20, ma50, bbPos, volRatio, atrPct, fromH52, pos52w, h52, l52 };
}

export async function fetchIndicators(sym, apiKey, cfg = SCREENER_CONFIG) {
  const url =
    `${cfg.apiBaseUrl}/time_series` +
    `?symbol=${sym}&interval=${cfg.interval}&outputsize=${cfg.outputsize}&apikey=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.status === "error" || !json.values) throw new Error(json.message || "데이터 없음");
  if (json.values.length < 55) throw new Error("데이터 부족 (MA50 계산 불가)");

  return computeIndicators(json.values);
}
