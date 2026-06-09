import { useState, useEffect } from "react";

const INTERPRET_PROMPT = `You are a professional swing trading analyst. You are given PRE-CALCULATED technical indicators computed from REAL daily price data. Trust these numbers completely — do not recalculate or doubt them. Provide a swing trading interpretation (holding period: days to a few weeks).

Respond ONLY in this exact key=value format, one per line, no JSON, no markdown, no extra text:

COMPANY=애플
RECOMMENDATION=BUY
CONFIDENCE=7
ENTRY_ZONE=183-186
TARGET_PRICE=195
STOP_LOSS=179
HOLDING_PERIOD=5-10일
SUMMARY=평균 이상 거래량과 이평선 정배열로 상승 모멘텀이 유효함.
BULL_1=주요 이동평균선 위 안착
BULL_2=MACD 골든크로스 유지
BEAR_1=RSI 과매수 구간 근접

Rules:
- COMPANY: the Korean name of the company for the given ticker
- RECOMMENDATION must be exactly BUY, HOLD, or SELL
- BE DECISIVE: Reserve HOLD ONLY for setups where signals genuinely conflict with no clear edge. When evidence tilts one way even moderately, commit to BUY or SELL and express strength via CONFIDENCE (4-5 weak, 7-9 strong). Do NOT default to HOLD.
- ALL text (SUMMARY, BULL, BEAR, COMPANY) MUST be natural Korean
- TARGET_PRICE and STOP_LOSS: realistic levels near current price, informed by the Bollinger bands and recent range provided
- If a Market Fear & Greed Index is given, factor it into your judgment: extreme fear can signal contrarian buying opportunity but also elevated risk; extreme greed warrants caution about overheating. Reflect this in CONFIDENCE and mention it in SUMMARY or a BULL/BEAR point when relevant.
- Use the Support/Resistance levels to set realistic TARGET_PRICE (near resistance) and STOP_LOSS (below support), and ENTRY_ZONE near support or current price.
- Volume/Price pressure: accumulation (buying) supports BUY; distribution (selling) supports caution/SELL even if price looks fine.
- EARNINGS RISK IS CRITICAL: If earnings are within ~14 days, a swing position carries large overnight gap risk. Lower CONFIDENCE meaningfully and add a BEAR point warning about it, regardless of how good the chart looks. If earnings are imminent (within 5 days), lean toward HOLD unless the setup is exceptional.
- ENTRY_ZONE: a price range near current price / support
- CONFIDENCE is a number 1-10
- Include 2-3 BULL lines and 1-2 BEAR lines
- No quotes, no special characters, SUMMARY is one Korean sentence`;

const REC_PRIORITY = { BUY: 0, HOLD: 1, SELL: 2 };

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

  return {
    current_price: cur, price_change_pct: changePct, data_date: data[n - 1].datetime,
    raw: { rsi, macd, bb, vwap, vwapPct, volRatio, ma20, ma50, levels },
    indicators: {
      rsi: { value: Math.round(rsi * 10) / 10, signal: rsiSig, note: rsiNote },
      macd: { signal: macdSig, note: macdNote },
      vwap: { status: vwapStatus, note: vwapNote },
      bollinger: { position: bollPos, note: bollNote },
      volume: { ratio: Math.round(volRatio * 100) / 100, signal: volSig, note: volNote },
      trend: { short: trendShort, medium: trendMed, note: trendNote },
      levels: { note: levelNote },
      volprice: { signal: vpSig, note: vpNote },
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

async function analyzeOne(sym, tdKey, anthropicKey, fng) {
  const url = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1day&outputsize=120&apikey=${tdKey}`;
  const res = await fetch(url);
  const td = await res.json();
  if (td.status === "error" || !td.values) throw new Error(td.message || "데이터 조회 실패");
  if (td.values.length < 30) throw new Error("데이터 부족");

  const ind = computeIndicators(td.values);
  const earnings = await fetchEarningsDays(sym, tdKey);
  const r = ind.raw;
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
MA20: ${r.ma20.toFixed(2)} (price ${ind.indicators.trend.short}), MA50: ${r.ma50.toFixed(2)} (price ${ind.indicators.trend.medium})${earnings ? `\nNext Earnings: ${earnings.date} (in ${earnings.days} days)${earnings.days <= 14 ? " — WARNING: earnings imminent, high gap risk for a swing position" : ""}` : ""}
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
  return { ticker: sym, ...ind, ...interp, earnings };
}

export default function App() {
  const [tdKey, setTdKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ cur: 0, total: 0, sym: "" });
  const [results, setResults] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState(null);
  const [fng, setFng] = useState(null);
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
    savePositions([...positions, { ticker: t, side: "BUY", entry, stop: isNaN(stop) ? null : stop, date: new Date().toISOString().slice(0, 10) }]);
    setNewPos({ ticker: "", entry: "", stop: "" });
  };

  const removePosition = (t) => savePositions(positions.filter(p => p.ticker !== t));

  useEffect(() => {
    fetch("https://feargreedchart.com/api/?action=all")
      .then(r => r.json())
      .then(d => { if (d?.score?.score != null) setFng(d.score.score); })
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
        const res = await analyzeOne(syms[i], tdKey.trim(), anthropicKey.trim(), fng);
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

        <input style={s.inp("a")} type="password" value={anthropicKey}
          onChange={e => setAnthropicKey(e.target.value)}
          onFocus={() => setFocused("a")} onBlur={() => setFocused("")}
          placeholder="Anthropic API 키 (sk-ant-...)" />
        <input style={s.inp("t")} type="password" value={tdKey}
          onChange={e => setTdKey(e.target.value)}
          onFocus={() => setFocused("t")} onBlur={() => setFocused("")}
          placeholder="Twelve Data API 키" />
        <div style={s.hint}>키는 이 기기에만 입력되며 새로고침하면 다시 입력해야 해요</div>

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
                      {r.position.stop != null && (
                        <div style={{ fontSize: "9px", color: "#607d9f", marginTop: "3px" }}>
                          손절가 ${r.position.stop} {r.position.stopBroken ? "· 🔴 도달" : "· 유효"}
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
                        savePositions([...positions, { ticker: r.ticker, side: "BUY", entry: r.current_price, stop: r.stop_loss, date: new Date().toISOString().slice(0, 10) }]);
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
