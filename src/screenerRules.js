const avg = values => values.reduce((sum, value) => sum + value, 0) / values.length;

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
  }
  return avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
}

function calcBollingerPosition(closes, period = 20) {
  const window = closes.slice(-period);
  const mean = avg(window);
  const stdDev = Math.sqrt(avg(window.map(value => (value - mean) ** 2)));
  const upper = mean + 2 * stdDev;
  const lower = mean - 2 * stdDev;
  return upper > lower ? (closes[closes.length - 1] - lower) / (upper - lower) : 0.5;
}

function calcMoneyFlowRatio(highs, lows, closes, volumes, period = 10) {
  const start = Math.max(0, closes.length - period);
  let weightedClv = 0;
  let totalVolume = 0;
  for (let i = start; i < closes.length; i++) {
    const range = highs[i] - lows[i];
    const clv = range === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
    weightedClv += clv * volumes[i];
    totalVolume += volumes[i];
  }
  return totalVolume > 0 ? weightedClv / totalVolume : 0;
}

export function computeScreenerSnapshot(values) {
  const data = [...values].reverse();
  const closes = data.map(row => Number(row.close));
  const highs = data.map(row => Number(row.high));
  const lows = data.map(row => Number(row.low));
  const volumes = data.map(row => Number(row.volume));
  const n = closes.length;
  if (n < 55) throw new Error("데이터 부족 (최소 55거래일)");

  const close = closes[n - 1];
  const ma20 = avg(closes.slice(-20));
  const ma20_5d = avg(closes.slice(-25, -5));
  const ma50 = avg(closes.slice(-50));
  const avgVolume20 = avg(volumes.slice(-20));
  let trueRangeSum = 0;
  for (let i = n - 14; i < n; i++) {
    trueRangeSum += Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }
  const atr = trueRangeSum / 14;
  const lookback52 = Math.min(252, n);
  const high52 = Math.max(...highs.slice(-lookback52));
  const low52 = Math.min(...lows.slice(-lookback52));
  const range52 = high52 - low52;

  return {
    close,
    rsi: calcRSI(closes),
    ma20,
    ma20_5d,
    ma50,
    ma200: n >= 200 ? avg(closes.slice(-200)) : null,
    bb_pos: calcBollingerPosition(closes),
    vol_ratio: avgVolume20 > 0 ? volumes[n - 1] / avgVolume20 : 1,
    pos52w: range52 > 0 ? (close - low52) / range52 : 0.5,
    from_h52: high52 > 0 ? (close / high52 - 1) * 100 : 0,
    mf_ratio: calcMoneyFlowRatio(highs, lows, closes, volumes),
    atr,
    atr_pct: close > 0 ? (atr / close) * 100 : 0,
    ma20_gap_pct: ma20 > 0 ? (close / ma20 - 1) * 100 : Number.NaN,
    data_date: data[n - 1]?.datetime || null,
  };
}

export const SCREENER_RULE_VERSION = {
  A: "v3_required4_confirmation1",
  B: "v1_4of5",
  market: "SPY_MA200_v1",
  selection: "MODE_A_MA20_GAP_4PCT_v1",
};

export const MODE_A_REQUIRED = [
  { id: "ma_aligned", label: "정배열", test: row => row.ma20 > row.ma50 },
  { id: "above_ma20", label: "MA20위", test: row => row.close > row.ma20 },
  { id: "ma20_rising", label: "MA20상승", test: row => row.ma20 > row.ma20_5d },
  { id: "rsi_momentum", label: "RSI모멘텀", test: row => row.rsi >= 50 && row.rsi <= 70 },
];

export const MODE_A_CONFIRMATION = [
  { id: "vol_inflow", label: "수급유입", test: row => row.vol_ratio >= 1.3 },
  { id: "strong_close", label: "강한마감", test: row => row.mf_ratio > 0.2 },
];

export const MODE_B_CONDITIONS = [
  { id: "rsi_oversold", label: "RSI과매도", test: row => row.rsi <= 35 },
  { id: "bb_lower", label: "BB하단근접", test: row => row.bb_pos < 0.2 },
  { id: "pullback_zone", label: "눌림구간", test: row => row.from_h52 >= -25 && row.from_h52 <= -8 },
  { id: "vol_spike", label: "반등거래량", test: row => row.vol_ratio >= 1.5 },
  { id: "above_ma50", label: "MA50근접위", test: row => row.close >= row.ma50 * 0.97 },
];

function evaluateConditions(row, conditions) {
  return conditions.map(condition => {
    let passed = false;
    try { passed = Boolean(condition.test(row)); } catch {}
    return { id: condition.id, label: condition.label, passed };
  });
}

export function evaluateModeA(row) {
  const required = evaluateConditions(row, MODE_A_REQUIRED);
  const confirmations = evaluateConditions(row, MODE_A_CONFIRMATION);
  if (!required.every(condition => condition.passed)) return null;
  if (!confirmations.some(condition => condition.passed)) return null;
  const detail = [...required, ...confirmations];
  return {
    name: "추세추종",
    count: detail.filter(condition => condition.passed).length,
    total: detail.length,
    tags: detail.filter(condition => condition.passed).map(condition => condition.label),
    detail,
  };
}

export function evaluateModeB(row) {
  const detail = evaluateConditions(row, MODE_B_CONDITIONS);
  const count = detail.filter(condition => condition.passed).length;
  if (count < 4) return null;
  return {
    name: "역추세반등",
    count,
    total: detail.length,
    tags: detail.filter(condition => condition.passed).map(condition => condition.label),
    detail,
  };
}

export function evaluateScreenerSnapshot(row, { allowModeA = true } = {}) {
  const results = {};
  const modeA = allowModeA ? evaluateModeA(row) : null;
  const modeB = evaluateModeB(row);
  if (modeA) results.A = modeA;
  if (modeB) results.B = modeB;
  return Object.keys(results).length ? results : null;
}

export function getSpyMarketRegime(spySnapshot) {
  const hasMa200 = Number.isFinite(spySnapshot?.ma200);
  const allowModeA = hasMa200 && spySnapshot.close >= spySnapshot.ma200;
  return {
    allowModeA,
    trend: allowModeA ? "bull" : "bear",
    close: spySnapshot?.close ?? null,
    ma200: hasMa200 ? spySnapshot.ma200 : null,
    gapPct: hasMa200 && spySnapshot.ma200 !== 0
      ? (spySnapshot.close / spySnapshot.ma200 - 1) * 100
      : null,
    reason: hasMa200
      ? (allowModeA ? "SPY가 MA200 위" : "SPY가 MA200 아래")
      : "SPY MA200 데이터 부족",
  };
}

export function sortModeACandidates(candidates) {
  return [...candidates].sort((a, b) => {
    const aGap = Number.isFinite(a.ma20GapPct) ? Math.abs(a.ma20GapPct - 4) : Number.POSITIVE_INFINITY;
    const bGap = Number.isFinite(b.ma20GapPct) ? Math.abs(b.ma20GapPct - 4) : Number.POSITIVE_INFINITY;
    return aGap - bGap || a.ticker.localeCompare(b.ticker);
  });
}
