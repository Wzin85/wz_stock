import { useState, useEffect } from "react";

const INTERPRET_PROMPT = `You are a seasoned swing trading STRATEGIST (not a checklist analyst). You receive PRE-CALCULATED indicators from REAL daily price data — trust these numbers, never recalculate. Your job is not to "score" indicators but to think like a risk manager: weave the signals into a coherent picture, decide how to protect capital first and capture upside second, and form a concrete plan. Holding horizon: days to a few weeks.

How to think (internally, before writing):
1. RISK FIRST — What can go wrong? Weigh earnings proximity, market trend (SPY/QQQ), sector strength, and volatility (ATR) BEFORE getting excited about a bullish chart. A great chart in a falling market or days before earnings is a trap.
2. RESOLVE CONFLICTS — When signals disagree (e.g. RSI overbought but strong accumulation, or price up but on upper wicks), do NOT average them into a mushy HOLD. Decide which signal dominates for a SWING horizon and let that drive the call. Your reasoning should reflect that you noticed the conflict.
3. THINK IN SCENARIOS — Frame the setup as "bullish if X holds, invalidated if Y breaks." Anchor STOP_LOSS to the invalidation level (below support / beyond 2x ATR) and TARGET to the next real resistance.
4. POSITION LOGIC — Confidence reflects edge quality, not just bullishness. A clean trend with room to resistance and a strong market = high conviction. Mixed signals or hostile backdrop = low conviction even if direction leans up.

Respond ONLY in this exact key=value format, one per line, no JSON, no markdown, no extra text:

COMPANY=애플
RECOMMENDATION=BUY
CONFIDENCE=7
ENTRY_ZONE=183-186
TARGET_PRICE=195
STOP_LOSS=179
HOLDING_PERIOD=5-10일
SUMMARY=한 문장으로 핵심 전략 판단 (단순 지표 나열이 아니라 무엇이 핵심이고 무엇을 경계하는지).
BULL_1=상승 시나리오의 핵심 근거
BULL_2=뒷받침하는 추가 근거
BEAR_1=무효화 조건 또는 핵심 리스크
BEAR_2=경계할 추가 리스크

Rules:
- COMPANY: the Korean name of the company for the given ticker
- RECOMMENDATION must be exactly BUY, HOLD, or SELL
- BE DECISIVE: HOLD only when there is genuinely no actionable edge for a swing trade — not as a way to avoid committing. When evidence leans, commit and express strength via CONFIDENCE (3-4 weak/speculative, 5-6 moderate, 7-9 strong/clean).
- The SUMMARY must read like a strategist's verdict, weaving 2-3 factors together (e.g. "추세는 살아있으나 저항 코앞 + 실적 임박, 보수적 접근"), NOT a list of indicator values.
- At least one BEAR line should state the INVALIDATION level or the single biggest risk, not a generic caveat.
- STOP_LOSS = invalidation level: below the support level OR ~2x ATR below price (whichever gives the trade sensible room for its volatility). TARGET_PRICE = next resistance or a realistic multiple of the risk. ENTRY_ZONE near current price/support.
- EARNINGS within ~14 days = major overnight gap risk: cut CONFIDENCE hard and make it a BEAR point. Within 5 days, lean HOLD unless exceptional.
- MARKET TREND: trading against a SPY/QQQ downtrend lowers odds — cut CONFIDENCE for BUYs. Strong stock + strong market = best setup.
- SECTOR: weak sector (<~40) is a headwind, strong (>~60) a tailwind — weave into confidence/reasoning when notable.
- ATR: high-volatility names need wider stops; never set a stop so tight it gets shaken out by normal daily range.
- IMPORTANT — do NOT fabricate specific historical precedents, dates, or past return figures (e.g. "in 2020 this pattern returned X%"). You may reason about what indicator combinations TYPICALLY imply in general terms, but never invent concrete past cases or statistics.
- ALL text (SUMMARY, BULL, BEAR, COMPANY) MUST be natural Korean
- CONFIDENCE is a number 1-10
- Include 2-3 BULL lines and 1-2 BEAR lines
- No quotes, no special characters in values, SUMMARY is one Korean sentence`;

const REC_PRIORITY = { BUY: 0, HOLD: 1, SELL: 2 };

// 섹터 ETF 한국어 이름
const SECTOR_KR = { XLK: "기술", XLF: "금융", XLE: "에너지", XLV: "헬스케어", XLY: "임의소비재", XLP: "필수소비재", XLI: "산업재", XLB: "소재", XLU: "유틸리티", XLRE: "부동산", XLC: "커뮤니케이션" };

// 주요 종목 → 섹터 ETF 매핑
const TICKER_SECTOR = {
  NVDA: "XLK", AMD: "XLK", AAPL: "XLK", MSFT: "XLK", AVGO: "XLK", MU: "XLK", INTC: "XLK", QCOM: "XLK", TXN: "XLK", SMCI: "XLK", ARM: "XLK", SOXL: "XLK", SOXX: "XLK", TSM: "XLK", ASML: "XLK", CRM: "XLK", ORCL: "XLK", ADBE: "XLK", PLTR: "XLK",
  META: "XLC", GOOGL: "XLC", GOOG: "XLC", NFLX: "XLC", DIS: "XLC", T: "XLC", VZ: "XLC",
  AMZN: "XLY", TSLA: "XLY", HD: "XLY", MCD: "XLY", NKE: "XLY", SBUX: "XLY", LOW: "XLY",
  JPM: "XLF", BAC: "XLF", WFC: "XLF", GS: "XLF", MS: "XLF", V: "XLF", MA: "XLF", BRK: "XLF",
  XOM: "XLE", CVX: "XLE", COP: "XLE", SLB: "XLE",
  UNH: "XLV", JNJ: "XLV", LLY: "XLV", PFE: "XLV", MRK: "XLV", ABBV: "XLV",
  WMT: "XLP", PG: "XLP", KO: "XLP", PEP: "XLP", COST: "XLP",
  BA: "XLI", CAT: "XLI", GE: "XLI", UPS: "XLI", HON: "XLI",
};

const avg = a => a.reduce((x, y) => x + y, 0) / a.length;

function ema(values, period) {
  const k = 2 / (period + 1);
  let e = values[0];
  const out = [e];
  for (let i = 1; i < values.length; i++) { e = values[i] * k + e * (1 - k); out.push(e); }
  return out;
}

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
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function calcMACD(closes) {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const line = closes.map((_, i) => e12[i] - e26[i]);
  const sig = ema(line, 9);
  const n = line.length;
  return { macd: line[n - 1], signal: sig[n - 1], hist: line[n - 1] - sig[n - 1] };
}

function calcBollinger(closes, period = 20, mult = 2) {
  const sl = closes.slice(-period);
  const m = avg(sl);
  const sd = Math.sqrt(avg(sl.map(c => (c - m) ** 2)));
  return { upper: m + mult * sd, middle: m, lower: m - mult * sd };
}

function calcVWAP(highs, lows, closes, vols, period = 20) {
  const start = Math.max(0, closes.length - period);
  let pv = 0, v = 0;
  for (let i = start; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    pv += tp * vols[i]; v += vols[i];
  }
  return pv / v;
}

function computeIndicators(values) {
  const data = [...values].reverse();
  const closes = data.map(d => parseFloat(d.close));
  const highs = data.map(d => parseFloat(d.high));
  const lows = data.map(d => parseFloat(d.low));
  const vols = data.map(d => parseFloat(d.volume));
  const n = closes.length;
  const cur = closes[n - 1], prev = closes[n - 2];
  const changePct = ((cur - prev) / prev) * 100;

  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes);
  const bb = calcBollinger(closes, 20, 2);
  const vwap = calcVWAP(highs, lows, closes, vols, 20);
  const avgVol = avg(vols.slice(-20));
  const volRatio = vols[n - 1] / avgVol;
  const ma20 = avg(closes.slice(-20));
  const ma50 = closes.length >= 50 ? avg(closes.slice(-50)) : avg(closes);

  const rsiSig = rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral";
  const rsiNote = rsi >= 70 ? "과매수 구간 (70 이상)" : rsi <= 30 ? "과매도 구간 (30 이하)" : "중립 구간";
  const macdSig = macd.hist > 0 ? "bullish" : "bearish";
  const macdNote = macd.hist > 0 ? `시그널선 상회 (히스토그램 +${macd.hist.toFixed(2)})` : `시그널선 하회 (${macd.hist.toFixed(2)})`;
  const vwapPct = ((cur - vwap) / vwap) * 100;
  const vwapStatus = cur >= vwap ? "above" : "below";
  const vwapNote = `VWAP 대비 ${vwapPct >= 0 ? "+" : ""}${vwapPct.toFixed(1)}%`;
  const pos = (cur - bb.lower) / (bb.upper - bb.lower);
  const bollPos = pos > 0.7 ? "upper" : pos < 0.3 ? "lower" : "middle";
  const bollNote = bollPos === "upper" ? `상단 밴드 근접 ($${bb.upper.toFixed(0)})` : bollPos === "lower" ? `하단 밴드 근접 ($${bb.lower.toFixed(0)})` : `중간 밴드 부근 ($${bb.middle.toFixed(0)})`;
  const volSig = volRatio > 1.2 ? "elevated" : volRatio < 0.8 ? "low" : "normal";
  const volNote = `20일 평균 대비 ${Math.round(volRatio * 100)}%`;
  const trendShort = cur >= ma20 ? "up" : "down";
  const trendMed = cur >= ma50 ? "up" : "down";
  const trendNote = `20일선 ${trendShort === "up" ? "위" : "아래"} / 50일선 ${trendMed === "up" ? "위" : "아래"}`;

  // ② 지지/저항선 (최근 60일 스윙 고저점)
  const lookback = Math.min(60, n);
  const recentHigh = Math.max(...highs.slice(-lookback));
  const recentLow = Math.min(...lows.slice(-lookback));
  const resistDist = ((recentHigh - cur) / cur) * 100;
  const supportDist = ((cur - recentLow) / cur) * 100;
  const levels = { resistance: recentHigh, support: recentLow, resistDist, supportDist };
  const levelNote = `저항 $${recentHigh.toFixed(0)} (+${resistDist.toFixed(1)}%) / 지지 $${recentLow.toFixed(0)} (-${supportDist.toFixed(1)}%)`;

  // ③ 거래량+가격 동반 (최근 10일, 고가·저가·꼬리 반영 = 차이킨 A/D 방식)
  const vpLook = Math.min(10, n);
  let mfv = 0, totalVol = 0;
  for (let i = n - vpLook; i < n; i++) {
    const range = highs[i] - lows[i];
    // CLV: 종가가 당일 고저 범위 어디서 마감했나 (-1 저가권/윗꼬리, +1 고가권/아래꼬리)
    const clv = range === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
    mfv += clv * vols[i];
    totalVol += vols[i];
  }
  const mfRatio = totalVol === 0 ? 0 : mfv / totalVol; // 거래량 가중 평균 CLV (-1 ~ +1)
  const mfPct = Math.round(mfRatio * 100);
  const vpSig = mfRatio > 0.15 ? "accumulation" : mfRatio < -0.15 ? "distribution" : "neutral";
  const vpNote = vpSig === "accumulation" ? `매수세 우위 · 고가권 마감/아래꼬리 (압력 +${mfPct})`
    : vpSig === "distribution" ? `매도세 우위 · 윗꼬리/저가권 마감 (압력 ${mfPct})`
    : `매수·매도 압력 균형 (${mfPct})`;

  // ATR(14) — 평균 진폭 (변동성 기반 손절폭 산출용)
  const atrLook = Math.min(14, n - 1);
  let trSum = 0;
  for (let i = n - atrLook; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trSum += tr;
  }
  const atr = trSum / atrLook;
  const atrPct = (atr / cur) * 100;
  // 변동성 기반 권장 손절: 현재가 - 2×ATR
  const atrStop = cur - 2 * atr;

  return {
    current_price: cur, price_change_pct: changePct, data_date: data[n - 1].datetime,
    raw: { rsi, macd, bb, vwap, vwapPct, volRatio, ma20, ma50, levels, atr, atrPct, atrStop },
    indicators: {
      rsi: { value: Math.round(rsi * 10) / 10, signal: rsiSig, note: rsiNote },
      macd: { signal: macdSig, note: macdNote },
      vwap: { status: vwapStatus, note: vwapNote },
      bollinger: { position: bollPos, note: bollNote },
      volume: { ratio: Math.round(volRatio * 100) / 100, signal: volSig, note: volNote },
      trend: { short: trendShort, medium: trendMed, note: trendNote },
      levels: { note: levelNote },
      volprice: { signal: vpSig, note: vpNote },
      atr: { value: Math.round(atr * 100) / 100, pct: atrPct, stop: atrStop, note: `ATR ${atrPct.toFixed(1)}% · 권장손절 $${atrStop.toFixed(2)} (2×ATR)` },
    },
  };
}

function parseInterpret(text) {
  const d = {}, bulls = [], bears = [];
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.substring(0, eq).trim(), v = line.substring(eq + 1).trim();
    if (k.startsWith("BULL_")) bulls.push(v);
    else if (k.startsWith("BEAR_")) bears.push(v);
    else d[k] = v;
  }
  return {
    company_name: d.COMPANY, recommendation: d.RECOMMENDATION, confidence: parseInt(d.CONFIDENCE),
    entry_zone: d.ENTRY_ZONE, target_price: parseFloat(d.TARGET_PRICE), stop_loss: parseFloat(d.STOP_LOSS),
    holding_period: d.HOLDING_PERIOD, summary: d.SUMMARY, bull_points: bulls, bear_points: bears,
  };
}

async function fetchEarningsDays(sym, tdKey) {
  try {
    const r = await fetch(`https://api.twelvedata.com/earnings?symbol=${sym}&apikey=${tdKey}`);
    const j = await r.json();
    if (!j.earnings || !Array.isArray(j.earnings)) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const future = j.earnings
      .map(e => new Date(e.date))
      .filter(d => !isNaN(d) && d >= today)
      .sort((a, b) => a - b);
    if (!future.length) return null;
    const days = Math.round((future[0] - today) / 86400000);
    return { date: future[0].toISOString().slice(0, 10), days };
  } catch { return null; }
}

async function analyzeOne(sym, tdKey, anthropicKey, fng, market, sectors) {
  const url = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1day&outputsize=120&apikey=${tdKey}`;
  const res = await fetch(url);
  const td = await res.json();
  if (td.status === "error" || !td.values) throw new Error(td.message || "데이터 조회 실패");
  if (td.values.length < 30) throw new Error("데이터 부족");

  const ind = computeIndicators(td.values);
  const earnings = await fetchEarningsDays(sym, tdKey);
  const r = ind.raw;

  // 시장 추세 (SPY/QQQ) — closes 배열로 추세 판정
  let marketLine = "";
  if (market) {
    const trendOf = (sym2) => {
      const m = market[sym2];
      if (!m || !m.closes || m.closes.length < 20) return null;
      const c = m.closes, last = c[c.length - 1];
      const ma20 = c.slice(-20).reduce((a, b) => a + b, 0) / 20;
      return { price: last, trend: last >= ma20 ? "uptrend" : "downtrend", pct: m.pct };
    };
    const spy = trendOf("SPY"), qqq = trendOf("QQQ");
    if (spy || qqq) {
      marketLine = `\nMarket Trend: ${spy ? `SPY ${spy.trend} (today ${spy.pct >= 0 ? "+" : ""}${spy.pct?.toFixed(2)}%)` : ""}${spy && qqq ? ", " : ""}${qqq ? `QQQ ${qqq.trend} (today ${qqq.pct >= 0 ? "+" : ""}${qqq.pct?.toFixed(2)}%)` : ""} — overall market direction; trading with the trend improves odds`;
    }
  }

  // 섹터 강도
  let sectorLine = "";
  const secEtf = TICKER_SECTOR[sym];
  if (secEtf && sectors && sectors[secEtf] != null) {
    const sc = typeof sectors[secEtf] === "object" ? sectors[secEtf].score : sectors[secEtf];
    if (sc != null) sectorLine = `\nSector (${SECTOR_KR[secEtf] || secEtf}): sentiment score ${sc}/100 — the stock's sector strength; a weak sector is a headwind even for a strong stock`;
  }

  const userMsg = `Ticker: ${sym}
Current Price: ${ind.current_price.toFixed(2)}
Daily Change: ${ind.price_change_pct >= 0 ? "+" : ""}${ind.price_change_pct.toFixed(2)}%
RSI(14): ${r.rsi.toFixed(1)} (${ind.indicators.rsi.signal})
MACD: ${r.macd.macd.toFixed(2)}, Signal: ${r.macd.signal.toFixed(2)}, Histogram: ${r.macd.hist >= 0 ? "+" : ""}${r.macd.hist.toFixed(2)} (${ind.indicators.macd.signal})
Price vs VWAP(20): ${ind.indicators.vwap.note} (${ind.indicators.vwap.status})
Bollinger Bands(20,2): upper ${r.bb.upper.toFixed(2)}, middle ${r.bb.middle.toFixed(2)}, lower ${r.bb.lower.toFixed(2)} -> price at ${ind.indicators.bollinger.position}
Volume: ${Math.round(r.volRatio * 100)}% of 20-day average (${ind.indicators.volume.signal})
Volume/Price pressure (last 10d, wick-aware Chaikin A/D, range -100 to +100): ${ind.indicators.volprice.signal} — ${ind.indicators.volprice.note}. Positive = closes near highs with lower wicks (buying); negative = upper wicks / closes near lows (selling).
Support/Resistance (60d): resistance ${r.levels.resistance.toFixed(2)} (+${r.levels.resistDist.toFixed(1)}% away), support ${r.levels.support.toFixed(2)} (-${r.levels.supportDist.toFixed(1)}% away)
ATR(14): ${r.atr.toFixed(2)} (${r.atrPct.toFixed(1)}% of price). Volatility-based stop suggestion (2x ATR below price): ${r.atrStop.toFixed(2)}
MA20: ${r.ma20.toFixed(2)} (price ${ind.indicators.trend.short}), MA50: ${r.ma50.toFixed(2)} (price ${ind.indicators.trend.medium})${marketLine}${sectorLine}${earnings ? `\nNext Earnings: ${earnings.date} (in ${earnings.days} days)${earnings.days <= 14 ? " — WARNING: earnings imminent, high gap risk for a swing position" : ""}` : ""}
${fng != null ? `\nMarket Fear & Greed Index: ${fng}/100 (${fng <= 25 ? "Extreme Fear" : fng <= 45 ? "Fear" : fng <= 55 ? "Neutral" : fng <= 75 ? "Greed" : "Extreme Greed"}) — overall market sentiment, use as context for risk` : ""}

Interpret this for swing trading.`;

  const cres = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: 800, temperature: 0.4,
      system: INTERPRET_PROMPT, messages: [{ role: "user", content: userMsg }],
    }),
  });
  const cdata = await cres.json();
  if (cdata.error) throw new Error(cdata.error.message);
  const ctext = cdata.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const interp = parseInterpret(ctext);
  if (!interp.recommendation) throw new Error("해석 실패");
  let sectorInfo = null;
  if (secEtf && sectors && sectors[secEtf] != null) {
    const sc = typeof sectors[secEtf] === "object" ? sectors[secEtf].score : sectors[secEtf];
    if (sc != null) sectorInfo = { score: sc, name: SECTOR_KR[secEtf] || secEtf };
  }
  return { ticker: sym, ...ind, ...interp, earnings, sector: sectorInfo };
}

export default function App() {
  const [tdKey, setTdKey] = useState(() => { try { return localStorage.getItem("wz_tdKey") || ""; } catch { return ""; } });
  const [anthropicKey, setAnthropicKey] = useState(() => { try { return localStorage.getItem("wz_anthropicKey") || ""; } catch { return ""; } });
  const [input, setInput] = useState(() => { try { return localStorage.getItem("wz_watchlist") || ""; } catch { return ""; } });
  const [focused, setFocused] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ cur: 0, total: 0, sym: "" });
  const [results, setResults] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState(null);
  const [fng, setFng] = useState(null);
  const [market, setMarket] = useState(null);
  const [sectors, setSectors] = useState(null);
  const [positions, setPositions] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wz_positions") || "[]"); }
    catch { return []; }
  });
  const [showPos, setShowPos] = useState(false);
  const [newPos, setNewPos] = useState({ ticker: "", entry: "", stop: "" });

  const savePositions = (next) => {
    setPositions(next);
    try { localStorage.setItem("wz_positions", JSON.stringify(next)); } catch {}
  };

  const addPosition = () => {
    const t = newPos.ticker.trim().toUpperCase();
    const entry = parseFloat(newPos.entry), stop = parseFloat(newPos.stop);
    if (!t || isNaN(entry)) { setError("티커와 진입가를 입력해주세요"); return; }
    if (positions.some(p => p.ticker === t)) { setError(`${t}는 이미 보유 목록에 있어요`); return; }
    setError(null);
    savePositions([...positions, { ticker: t, side: "BUY", entry, stop: isNaN(stop) ? null : stop, target: null, date: new Date().toISOString().slice(0, 10) }]);
    setNewPos({ ticker: "", entry: "", stop: "" });
  };

  const removePosition = (t) => savePositions(positions.filter(p => p.ticker !== t));

  const updatePositionLevels = (ticker, newStop, newTarget) => {
    savePositions(positions.map(p =>
      p.ticker === ticker ? { ...p, stop: newStop, target: newTarget } : p
    ));
  };

  useEffect(() => { try { localStorage.setItem("wz_tdKey", tdKey); } catch {} }, [tdKey]);
  useEffect(() => { try { localStorage.setItem("wz_anthropicKey", anthropicKey); } catch {} }, [anthropicKey]);
  useEffect(() => { try { localStorage.setItem("wz_watchlist", input); } catch {} }, [input]);

  useEffect(() => {
    fetch("https://feargreedchart.com/api/?action=all")
      .then(r => r.json())
      .then(d => {
        if (d?.score?.score != null) setFng(d.score.score);
        if (d?.market) setMarket(d.market);
        if (d?.sectors) setSectors(d.sectors);
      })
      .catch(() => {});
  }, []);

  const analyzePositions = () => {
    if (!positions.length) { setError("보유 종목이 없어요. 먼저 추가해주세요"); return; }
    runAnalysis(positions.map(p => p.ticker));
  };

  const runAnalysis = async (symbols) => {
    if (!tdKey.trim()) { setError("Twelve Data API 키를 입력해주세요"); return; }
    if (!anthropicKey.trim()) { setError("Anthropic API 키를 입력해주세요"); return; }
    const syms = [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean))];
    if (!syms.length || analyzing) return;
    setAnalyzing(true); setError(null); setResults([]); setExpanded(null);

    const collected = [];
    for (let i = 0; i < syms.length; i++) {
      setProgress({ cur: i + 1, total: syms.length, sym: syms[i] });
      try {
        const res = await analyzeOne(syms[i], tdKey.trim(), anthropicKey.trim(), fng, market, sectors);
        const pos = positions.find(p => p.ticker === syms[i]);
        if (pos) {
          const pnlPct = ((res.current_price - pos.entry) / pos.entry) * 100;
          const stopBroken = pos.stop != null && res.current_price <= pos.stop;
          let status;
          if (res.recommendation === "BUY") status = { txt: "신호 유효 · 보유 지속", col: "#00e5a0" };
          else if (stopBroken) status = { txt: "손절가 도달 · 청산 검토", col: "#ff4757" };
          else if (res.recommendation === "SELL") status = { txt: "신호 약화 · 손절선은 유효 (룰상 보유)", col: "#ffb830" };
          else status = { txt: "중립 전환 · 손절선 유효", col: "#ffb830" };
          res.position = { ...pos, pnlPct, stopBroken, status };
        }
        collected.push(res);
      }
      catch (e) { collected.push({ ticker: syms[i], error: true, errMsg: e.message }); }
      const sorted = [...collected].sort((a, b) => {
        const pa = a.error ? 9 : REC_PRIORITY[a.recommendation] ?? 5;
        const pb = b.error ? 9 : REC_PRIORITY[b.recommendation] ?? 5;
        if (pa !== pb) return pa - pb;
        return (b.confidence || 0) - (a.confidence || 0);
      });
      setResults(sorted);
      if (i < syms.length - 1) await new Promise(r => setTimeout(r, 8500));
    }
    setAnalyzing(false);
  };

  const recColor = rec => rec === "BUY" ? "#00e5a0" : rec === "SELL" ? "#ff4757" : "#ffb830";
  const rsiCol = v => !v ? "#607d9f" : v < 30 ? "#00e5a0" : v > 70 ? "#ff4757" : "#e8f0fe";
  const sigCol = s => {
    if (!s) return "#607d9f";
    const l = s.toLowerCase();
    if (["bullish", "above", "up", "elevated"].includes(l)) return "#00e5a0";
    if (["bearish", "below", "down", "overbought"].includes(l)) return "#ff4757";
    if (l === "oversold") return "#00e5a0";
    return "#ffb830";
  };

  const counts = results.reduce((a, r) => { if (r.error) a.err++; else a[r.recommendation] = (a[r.recommendation] || 0) + 1; return a; }, { BUY: 0, HOLD: 0, SELL: 0, err: 0 });

  const s = {
    root: { minHeight: "100vh", background: "#070d18", fontFamily: "'Courier New', Courier, monospace", color: "#dce8f5", padding: "24px 14px" },
    wrap: { maxWidth: "820px", margin: "0 auto" },
    head: { textAlign: "center", marginBottom: "22px" },
    title: { fontSize: "23px", fontWeight: "700", letterSpacing: "7px", color: "#00e5a0" },
    sub: { fontSize: "10px", color: "#334d66", letterSpacing: "3px", marginTop: "6px" },
    inp: f => ({ width: "100%", boxSizing: "border-box", background: "#0b1522", border: `1px solid ${focused === f ? "#00e5a055" : "#182434"}`, borderRadius: "3px", padding: "12px 15px", color: "#dce8f5", fontSize: "14px", fontFamily: "inherit", letterSpacing: "1px", outline: "none", marginBottom: "9px" }),
    hint: { fontSize: "9px", color: "#334d66", letterSpacing: "0.5px", marginTop: "-4px", marginBottom: "12px" },
    btnRow: { display: "flex", gap: "8px", marginBottom: "22px" },
    btn: { flex: 1, background: analyzing ? "#0b1522" : "#00e5a0", color: analyzing ? "#334d66" : "#070d18", border: `1px solid ${analyzing ? "#182434" : "#00e5a0"}`, borderRadius: "3px", padding: "12px", fontSize: "11px", fontWeight: "700", letterSpacing: "2px", cursor: analyzing ? "not-allowed" : "pointer", fontFamily: "inherit" },
    btn2: { background: "#0b1522", color: "#607d9f", border: "1px solid #182434", borderRadius: "3px", padding: "12px 14px", fontSize: "10px", fontWeight: "700", letterSpacing: "1px", cursor: analyzing ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
    card: { background: "#0b1522", border: "1px solid #182434", borderRadius: "3px", padding: "16px 18px", marginBottom: "10px" },
    lbl: { fontSize: "9px", letterSpacing: "2.5px", color: "#334d66", textTransform: "uppercase", marginBottom: "5px" },
    grid3: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginTop: "12px" },
    iCard: { background: "#090e19", border: "1px solid #182434", borderRadius: "3px", padding: "11px" },
    row: { display: "flex", alignItems: "center", gap: "12px", background: "#0b1522", border: "1px solid #182434", borderRadius: "3px", padding: "13px 16px", marginBottom: "8px", cursor: "pointer" },
  };

  return (
    <div style={s.root}>
      <div style={s.wrap}>
        <div style={s.head}>
          <div style={s.title}>WZ STOCK</div>
          <div style={s.sub}>실제 데이터 기반 스윙 분석</div>
        </div>

        {fng != null && (() => {
          const lbl = fng <= 25 ? "극공포" : fng <= 45 ? "공포" : fng <= 55 ? "중립" : fng <= 75 ? "탐욕" : "극탐욕";
          const col = fng <= 25 ? "#ff4757" : fng <= 45 ? "#ff8c42" : fng <= 55 ? "#607d9f" : fng <= 75 ? "#7ed957" : "#00e5a0";
          return (
            <div style={{ background: "#0b1522", border: `1px solid ${col}33`, borderRadius: "3px", padding: "12px 16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                <span style={{ fontSize: "9px", letterSpacing: "2px", color: "#334d66" }}>시장 공포·탐욕 지수</span>
                <span style={{ fontSize: "18px", fontWeight: "700", color: col }}>{fng} · {lbl}</span>
              </div>
              <div style={{ position: "relative", height: "5px", borderRadius: "3px", background: "linear-gradient(to right, #ff4757, #ff8c42, #607d9f, #7ed957, #00e5a0)" }}>
                <div style={{ position: "absolute", left: `${fng}%`, top: "-3px", width: "2px", height: "11px", background: "#fff", transform: "translateX(-1px)", borderRadius: "1px" }} />
              </div>
            </div>
          );
        })()}

        {market && (() => {
          const mt = (sym2) => {
            const m = market[sym2];
            if (!m || !m.closes || m.closes.length < 20) return null;
            const c = m.closes, last = c[c.length - 1];
            const ma20 = c.slice(-20).reduce((a, b) => a + b, 0) / 20;
            return { up: last >= ma20, pct: m.pct };
          };
          const items = [["SPY", mt("SPY")], ["QQQ", mt("QQQ")]].filter(x => x[1]);
          if (!items.length) return null;
          return (
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              {items.map(([name, d]) => (
                <div key={name} style={{ flex: 1, background: "#0b1522", border: "1px solid #182434", borderRadius: "3px", padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "10px", color: "#607d9f", fontWeight: "700" }}>{name}</span>
                  <span style={{ fontSize: "10px", color: d.up ? "#00e5a0" : "#ff4757", fontWeight: "700" }}>
                    {d.up ? "▲ 상승추세" : "▼ 하락추세"} {d.pct >= 0 ? "+" : ""}{d.pct?.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          );
        })()}

        <input style={s.inp("a")} type="password" value={anthropicKey}
          onChange={e => setAnthropicKey(e.target.value)}
          onFocus={() => setFocused("a")} onBlur={() => setFocused("")}
          placeholder="Anthropic API 키 (sk-ant-...)" />
        <input style={s.inp("t")} type="password" value={tdKey}
          onChange={e => setTdKey(e.target.value)}
          onFocus={() => setFocused("t")} onBlur={() => setFocused("")}
          placeholder="Twelve Data API 키" />
        <div style={s.hint}>
          키·관심종목은 이 기기 브라우저에 저장돼요 (다음에 자동 입력)
          {(tdKey || anthropicKey) && (
            <span onClick={() => { setTdKey(""); setAnthropicKey(""); try { localStorage.removeItem("wz_tdKey"); localStorage.removeItem("wz_anthropicKey"); } catch {} }}
              style={{ color: "#ff4757", cursor: "pointer", marginLeft: "8px" }}>[키 삭제]</span>
          )}
        </div>

        <input style={s.inp("tk")} value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && runAnalysis(input.split(/[,\s]+/))}
          onFocus={() => setFocused("tk")} onBlur={() => setFocused("")}
          placeholder="티커 입력 (쉼표로 구분: NVDA, AAPL, TSLA)" />

        <div style={s.btnRow}>
          <button style={s.btn} onClick={() => runAnalysis(input.split(/[,\s]+/))} disabled={analyzing}>
            {analyzing ? `분석 중 ${progress.cur}/${progress.total} · ${progress.sym}` : "ANALYZE"}
          </button>
          <button style={s.btn2} onClick={() => setShowPos(v => !v)} disabled={analyzing}>
            내 포지션 {positions.length > 0 ? `(${positions.length})` : ""} {showPos ? "▴" : "▾"}
          </button>
        </div>

        {showPos && (
          <div style={{ ...s.card, padding: "14px 16px" }}>
            <div style={{ ...s.lbl, marginBottom: "10px" }}>보유 종목</div>
            {positions.length === 0 && <div style={{ fontSize: "11px", color: "#334d66", marginBottom: "12px" }}>아직 등록된 보유 종목이 없어요</div>}
            {positions.map(p => (
              <div key={p.ticker} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 0", borderBottom: "1px solid #121c2a", fontSize: "11px" }}>
                <span style={{ fontWeight: "700", minWidth: "52px" }}>{p.ticker}</span>
                <span style={{ flex: 1, color: "#607d9f" }}>진입 ${p.entry}{p.stop != null ? ` · 손절 $${p.stop}` : ""}</span>
                <span onClick={() => removePosition(p.ticker)} style={{ color: "#ff4757", cursor: "pointer", padding: "2px 8px", fontWeight: "700" }}>×</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: "6px", marginTop: "12px" }}>
              <input value={newPos.ticker} onChange={e => setNewPos({ ...newPos, ticker: e.target.value })}
                placeholder="티커" style={{ ...s.inp("np1"), marginBottom: 0, flex: "1.2", fontSize: "12px", padding: "9px 10px", textTransform: "uppercase" }} />
              <input value={newPos.entry} onChange={e => setNewPos({ ...newPos, entry: e.target.value })}
                placeholder="진입가" inputMode="decimal" style={{ ...s.inp("np2"), marginBottom: 0, flex: "1", fontSize: "12px", padding: "9px 10px" }} />
              <input value={newPos.stop} onChange={e => setNewPos({ ...newPos, stop: e.target.value })}
                placeholder="손절가" inputMode="decimal" style={{ ...s.inp("np3"), marginBottom: 0, flex: "1", fontSize: "12px", padding: "9px 10px" }} />
            </div>
            <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
              <button style={{ ...s.btn2, flex: 1 }} onClick={addPosition} disabled={analyzing}>+ 추가</button>
              <button style={{ ...s.btn, flex: 1.5 }} onClick={analyzePositions} disabled={analyzing}>보유 전체 분석</button>
            </div>
            <div style={{ fontSize: "8px", color: "#334d66", marginTop: "8px" }}>※ 이 기기 브라우저에만 저장돼요 (캐시 삭제 시 사라짐)</div>
          </div>
        )}

        {analyzing && (
          <div style={{ height: "2px", background: "#182434", borderRadius: "1px", overflow: "hidden", marginBottom: "20px" }}>
            <div style={{ height: "100%", width: `${(progress.cur / progress.total) * 100}%`, background: "#00e5a0", transition: "width 0.4s ease" }} />
          </div>
        )}

        {error && <div style={{ ...s.card, borderColor: "#ff4757", color: "#ff4757", fontSize: "12px" }}>✕ {error}</div>}

        {results.length > 0 && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            {[{ k: "BUY", v: counts.BUY, c: "#00e5a0" }, { k: "HOLD", v: counts.HOLD, c: "#ffb830" }, { k: "SELL", v: counts.SELL, c: "#ff4757" }].map(x => (
              <div key={x.k} style={{ flex: 1, background: x.c + "12", border: `1px solid ${x.c}33`, borderRadius: "3px", padding: "10px", textAlign: "center" }}>
                <div style={{ color: x.c, fontSize: "20px", fontWeight: "700" }}>{x.v}</div>
                <div style={{ color: x.c, fontSize: "9px", letterSpacing: "2px" }}>{x.k}</div>
              </div>
            ))}
          </div>
        )}

        {results.map((r, idx) => {
          if (r.error) return (
            <div key={idx} style={{ ...s.row, cursor: "default", borderColor: "#ff475733" }}>
              <div style={{ fontWeight: "700", fontSize: "15px", minWidth: "70px" }}>{r.ticker}</div>
              <div style={{ color: "#ff4757", fontSize: "10px" }}>✕ {r.errMsg}</div>
            </div>
          );
          const open = expanded === r.ticker, rc = recColor(r.recommendation);
          const livePos = r.position ? positions.find(p => p.ticker === r.ticker) : null;
          return (
            <div key={idx}>
              <div style={{ ...s.row, borderColor: open ? rc + "55" : "#182434", marginBottom: open ? 0 : "8px" }} onClick={() => setExpanded(open ? null : r.ticker)}>
                <div style={{ minWidth: "62px" }}>
                  <div style={{ fontWeight: "700", fontSize: "15px", letterSpacing: "1px" }}>
                    {r.ticker}
                    {r.position && <span style={{ color: r.position.status.col, fontSize: "8px", marginLeft: "5px", border: `1px solid ${r.position.status.col}55`, borderRadius: "2px", padding: "1px 4px", verticalAlign: "middle" }}>보유</span>}
                    {r.earnings && r.earnings.days <= 14 && <span style={{ color: "#ff8c42", fontSize: "10px", marginLeft: "4px" }}>⚠</span>}
                  </div>
                  <div style={{ color: "#334d66", fontSize: "9px" }}>{r.company_name}</div>
                </div>
                <div style={{ flex: 1, textAlign: "right" }}>
                  <div style={{ fontSize: "14px", fontWeight: "700" }}>${r.current_price?.toFixed(2)}</div>
                  <div style={{ color: r.price_change_pct >= 0 ? "#00e5a0" : "#ff4757", fontSize: "10px" }}>
                    {r.price_change_pct >= 0 ? "▲" : "▼"} {Math.abs(r.price_change_pct)?.toFixed(2)}%
                  </div>
                </div>
                <div style={{ background: rc + "18", border: `1px solid ${rc}`, borderRadius: "3px", padding: "7px 12px", textAlign: "center", minWidth: "60px" }}>
                  <div style={{ color: rc, fontSize: "13px", fontWeight: "700", letterSpacing: "1px" }}>{r.recommendation}</div>
                  <div style={{ color: "#334d66", fontSize: "8px" }}>{r.confidence}/10</div>
                </div>
                <div style={{ color: "#334d66", fontSize: "12px", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▸</div>
              </div>

              {open && (
                <div style={{ ...s.card, borderColor: rc + "33", borderTop: "none", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                  {r.position && (
                    <div style={{ marginBottom: "10px", padding: "10px 12px", borderRadius: "3px", background: r.position.status.col + "12", border: `1px solid ${r.position.status.col}44` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "10px", color: r.position.status.col, fontWeight: "700" }}>보유 중 (진입 ${r.position.entry})</span>
                        <span style={{ fontSize: "11px", fontWeight: "700", color: r.position.pnlPct >= 0 ? "#00e5a0" : "#ff4757" }}>
                          {r.position.pnlPct >= 0 ? "+" : ""}{r.position.pnlPct.toFixed(1)}%
                        </span>
                      </div>
                      <div style={{ fontSize: "10px", color: r.position.status.col }}>→ {r.position.status.txt}</div>
                      {livePos?.stop != null && (
                        <div style={{ fontSize: "9px", color: "#607d9f", marginTop: "3px" }}>
                          손절가 ${livePos.stop} {r.current_price <= livePos.stop ? "· 🔴 도달" : "· 유효"}
                          {livePos.target != null ? ` · 목표가 $${livePos.target}` : ""}
                        </div>
                      )}
                      {livePos && (livePos.stop !== r.stop_loss || livePos.target !== r.target_price) && (
                        <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${r.position.status.col}22` }}>
                          <div style={{ fontSize: "9px", color: "#dce8f5", marginBottom: "6px" }}>
                            새 분석값: 손절 ${r.stop_loss} · 목표 ${r.target_price}
                          </div>
                          <button
                            style={{ ...s.btn2, width: "100%", boxSizing: "border-box", color: "#00e5a0", borderColor: "#00e5a055" }}
                            onClick={(e) => { e.stopPropagation(); updatePositionLevels(r.ticker, r.stop_loss, r.target_price); }}>
                            ↻ 손절·목표가 새 분석값으로 적용
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ fontSize: "12px", lineHeight: "1.7", color: "#b0c4d8", marginBottom: "4px" }}>{r.summary}</div>
                  <div style={{ fontSize: "8px", color: "#334d66", marginBottom: "8px" }}>데이터 기준일: {r.data_date}</div>

                  <div style={s.grid3}>
                    {[
                      { lbl: "RSI", val: r.indicators?.rsi?.value, col: rsiCol(r.indicators?.rsi?.value), note: r.indicators?.rsi?.note },
                      { lbl: "MACD", val: r.indicators?.macd?.signal, col: sigCol(r.indicators?.macd?.signal), note: r.indicators?.macd?.note },
                      { lbl: "VWAP", val: r.indicators?.vwap?.status, col: sigCol(r.indicators?.vwap?.status), note: r.indicators?.vwap?.note },
                      { lbl: "볼린저", val: r.indicators?.bollinger?.position, col: "#ffb830", note: r.indicators?.bollinger?.note },
                      { lbl: "거래량", val: r.indicators?.volume?.ratio + "x", col: sigCol(r.indicators?.volume?.signal), note: r.indicators?.volume?.note },
                      { lbl: "추세 S/M", val: `${r.indicators?.trend?.short}/${r.indicators?.trend?.medium}`, col: sigCol(r.indicators?.trend?.short), note: r.indicators?.trend?.note },
                    ].map((ind, i) => (
                      <div key={i} style={s.iCard}>
                        <div style={s.lbl}>{ind.lbl}</div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: ind.col, textTransform: "uppercase", marginBottom: "3px" }}>{ind.val}</div>
                        <div style={{ fontSize: "8px", color: "#334d66", lineHeight: 1.4 }}>{ind.note}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }}>
                    <div style={s.iCard}>
                      <div style={s.lbl}>지지 / 저항</div>
                      <div style={{ fontSize: "9px", color: "#b0c4d8", lineHeight: 1.5 }}>{r.indicators?.levels?.note}</div>
                    </div>
                    <div style={s.iCard}>
                      <div style={s.lbl}>매수·매도 압력</div>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: sigCol(r.indicators?.volprice?.signal === "accumulation" ? "up" : r.indicators?.volprice?.signal === "distribution" ? "down" : ""), marginBottom: "2px" }}>
                        {r.indicators?.volprice?.signal === "accumulation" ? "매수 우위" : r.indicators?.volprice?.signal === "distribution" ? "매도 우위" : "균형"}
                      </div>
                      <div style={{ fontSize: "8px", color: "#334d66", lineHeight: 1.4 }}>{r.indicators?.volprice?.note}</div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }}>
                    <div style={s.iCard}>
                      <div style={s.lbl}>변동성 (ATR)</div>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: "#ffb830", marginBottom: "2px" }}>{r.indicators?.atr?.pct?.toFixed(1)}%</div>
                      <div style={{ fontSize: "8px", color: "#334d66", lineHeight: 1.4 }}>{r.indicators?.atr?.note}</div>
                    </div>
                    {r.sector ? (
                      <div style={s.iCard}>
                        <div style={s.lbl}>섹터 강도</div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: r.sector.score >= 60 ? "#00e5a0" : r.sector.score <= 40 ? "#ff4757" : "#ffb830", marginBottom: "2px" }}>{r.sector.score}/100</div>
                        <div style={{ fontSize: "8px", color: "#334d66", lineHeight: 1.4 }}>{r.sector.name} 섹터</div>
                      </div>
                    ) : <div style={s.iCard}><div style={s.lbl}>섹터 강도</div><div style={{ fontSize: "9px", color: "#334d66", marginTop: "4px" }}>해당 없음</div></div>}
                  </div>

                  {r.earnings && (
                    <div style={{ marginTop: "8px", padding: "9px 12px", borderRadius: "3px", fontSize: "10px",
                      background: r.earnings.days <= 14 ? "#ff8c4218" : "#0b1522",
                      border: `1px solid ${r.earnings.days <= 14 ? "#ff8c4255" : "#182434"}`,
                      color: r.earnings.days <= 14 ? "#ff8c42" : "#607d9f" }}>
                      {r.earnings.days <= 14 ? "⚠ " : "📅 "}실적 발표: {r.earnings.date} (D-{r.earnings.days})
                      {r.earnings.days <= 14 ? " · 보유 중 갭 리스크 주의" : ""}
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "10px" }}>
                    <div>
                      <div style={{ ...s.lbl, color: "#00e5a0" }}>▲ 상승 근거</div>
                      {r.bull_points?.map((p, i) => <div key={i} style={{ fontSize: "10px", color: "#b0c4d8", marginTop: "5px", paddingLeft: "7px", borderLeft: "2px solid #00e5a025" }}>{p}</div>)}
                    </div>
                    <div>
                      <div style={{ ...s.lbl, color: "#ff4757" }}>▼ 하락 근거</div>
                      {r.bear_points?.map((p, i) => <div key={i} style={{ fontSize: "10px", color: "#b0c4d8", marginTop: "5px", paddingLeft: "7px", borderLeft: "2px solid #ff475725" }}>{p}</div>)}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #182434" }}>
                    {[
                      { lbl: "매수구간", val: r.entry_zone, col: "#ffb830" },
                      { lbl: "목표가", val: `$${r.target_price}`, col: "#00e5a0" },
                      { lbl: "손절가", val: `$${r.stop_loss}`, col: "#ff4757" },
                      { lbl: "보유기간", val: r.holding_period, col: "#dce8f5" },
                    ].map((l, i) => (
                      <div key={i}>
                        <div style={s.lbl}>{l.lbl}</div>
                        <div style={{ fontSize: "12px", fontWeight: "700", color: l.col }}>{l.val}</div>
                      </div>
                    ))}
                  </div>

                  {!r.position && (
                    <button
                      style={{ ...s.btn2, width: "100%", marginTop: "12px", boxSizing: "border-box" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (positions.some(p => p.ticker === r.ticker)) { setError(`${r.ticker}는 이미 보유 목록에 있어요`); return; }
                        setError(null);
                        savePositions([...positions, { ticker: r.ticker, side: "BUY", entry: r.current_price, stop: r.stop_loss, target: r.target_price, date: new Date().toISOString().slice(0, 10) }]);
                      }}>
                      + 보유 등록 (진입 ${r.current_price?.toFixed(2)} · 손절 ${r.stop_loss})
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {results.length > 0 && (
          <div style={{ textAlign: "center", marginTop: "18px", fontSize: "9px", color: "#1e2e3e", letterSpacing: "1.5px" }}>
            ⚠ 투자 권유가 아닙니다 — 교육 목적의 참고 자료입니다
          </div>
        )}
      </div>
    </div>
  );
}
