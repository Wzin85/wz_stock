// ── 브라우저 스크리너용 데이터 + 유틸 ─────────────────────────
// computeIndicators 결과(App.jsx)를 그대로 사용

// ── S&P 500 풀 (~490종목, API 호출 없음) ─────────────────────
export const SP500_POOL = [
  "MMM","AOS","ABT","ABBV","ACN","ADBE","AMD","AES","AFL","A",
  "APD","ABNB","AKAM","ALB","ARE","ALGN","ALLE","LNT","ALL","GOOGL",
  "GOOG","MO","AMZN","AMCR","AEE","AAL","AEP","AXP","AIG","AMT",
  "AWK","AMP","AME","AMGN","APH","ADI","ANSS","AON","APA","AAPL",
  "AMAT","APTV","ACGL","ADM","ANET","AJG","AIZ","T","ATO","ADSK",
  "AZO","AVB","AVY","AXON","BKR","BALL","BAC","BK","BBWI","BAX",
  "BDX","WRB","BBY","TECH","BIO","BIIB","BLK","BX","BA","BCO",
  "BSX","BMY","AVGO","BR","BRO","BF.B","BLDR","BG","CDNS","CZR",
  "CPT","CPB","COF","CAH","KMX","CCL","CARR","CTLT","CAT","CBOE",
  "CBRE","CDW","CE","COR","CNC","CNP","CF","CRL","SCHW","CHTR",
  "CVX","CMG","CB","CHD","CI","CINF","CTAS","CSCO","C","CFG",
  "CLX","CME","CMS","KO","CTSH","CL","CMCSA","CMA","CAG","COP",
  "ED","STZ","CEG","COO","CPRT","GLW","CTVA","CSGP","COST","CTRA",
  "CRWD","CCI","CSX","CMI","CVS","DHI","DHR","DRI","DVA","DE",
  "DAL","XRAY","DVN","DXCM","FANG","DLR","DFS","DG","DLTR","D",
  "DPZ","DOW","DTE","DUK","DD","EMN","ETN","EBAY","ECL","EIX",
  "EW","EA","ELV","LLY","EMR","ENPH","ETR","EOG","EPAM","EQT",
  "EFX","EQIX","EQR","ESS","EL","ETSY","EVRG","ES","EXC","EXPE",
  "EXPD","EXR","XOM","FFIV","FDS","FICO","FAST","FRT","FDX","FIS",
  "FITB","FSLR","FE","FI","FMC","F","FTNT","FTV","FOXA","FOX",
  "BEN","FCX","GRMN","IT","GEHC","GEN","GNRC","GD","GE","GIS",
  "GM","GPC","GILD","GS","HAL","HIG","HAS","HCA","DOC","HSIC",
  "HSY","HES","HPE","HLT","HOLX","HD","HON","HRL","HST","HWM",
  "HPQ","HUBB","HUM","HBAN","HII","IBM","IEX","IDXX","ITW","INCY",
  "IR","PODD","INTC","ICE","IFF","IP","IPG","INTU","ISRG","IVZ",
  "INVH","IQV","IRM","JBHT","JKHY","J","JNJ","JCI","JPM","JNPR",
  "K","KVUE","KDP","KEY","KEYS","KMB","KIM","KMI","KLAC","KHC",
  "KR","LHX","LH","LRCX","LW","LVS","LKQ","LEG","LEN","LNC",
  "LIN","LYV","LMT","L","LOW","LULU","LYB","MTB","MPC","MKTX",
  "MAR","MMC","MLM","MAS","MA","MKC","MCK","MDT","MRK","META",
  "MET","MTD","MGM","MCHP","MU","MSFT","MAA","MRNA","MHK","MOH",
  "TAP","MDLZ","MPWR","MNST","MCO","MS","MOS","MSI","MSCI","NDAQ",
  "NTAP","NOV","NWSA","NWS","NEE","NKE","NEM","NFLX","NWL","NRG",
  "NUE","NVDA","NVR","NXPI","NOC","NCLH","O","OXY","ODFL","OMC",
  "ON","OKE","ORCL","OTIS","PCAR","PKG","PANW","PH","PAYX","PAYC",
  "PYPL","PNR","PEP","PFE","PCG","PM","PSX","PNW","PNC","POOL",
  "PPG","PPL","PFG","PG","PGR","PLD","PRU","PEG","PTC","PSA",
  "PHM","QRVO","QCOM","PWR","DGX","RL","RJF","RTX","REG","REGN",
  "RF","RSG","RMD","RVTY","ROK","ROL","ROP","ROST","RCL","SPGI",
  "CRM","SBAC","SLB","STX","SEE","SRE","NOW","SHW","SPG","SWKS",
  "SJM","SNA","SO","LUV","SWK","SBUX","STT","STLD","STE","SYK",
  "SMCI","SYF","SNPS","SYY","TMUS","TROW","TTWO","TPR","TGT","TEL",
  "TDY","TER","TFC","TJX","TSCO","TT","TOL","TSLA","TXN","TXT",
  "TMO","TDG","TRMB","TRV","ULTA","USB","UDR","UHS","UNM","UAL",
  "UPS","URI","UNH","VLO","VTR","VLTO","VRSN","VRSK","VZ","VRTX",
  "VICI","V","VST","VMC","WRB","WBA","WMT","DIS","WBD","WM","WAT",
  "WEC","WFC","WELL","WST","WDC","WY","WHR","WMB","WTW","GWW",
  "WYNN","XEL","XYL","YUM","ZBRA","ZBH","ZTS","ARM","PLTR","DASH",
  "TTD","DDOG","ZS","WDAY","TEAM","CRWD","FTNT","UBER","ABNB",
  "CEG","GFS","VST","GDDY","ANET","VRT","MPWR","MRVL","EPAM",
];

// ── 시드 기반 PRNG (mulberry32) ──────────────────────────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleN(arr, n, seed) {
  if (n <= 0) return [];
  if (n >= arr.length) return [...arr];
  const rng = mulberry32(seed);
  const pool = [...arr];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

// ── 유니버스 빌더 ─────────────────────────────────────────────
// fixed: 보유 종목 티커 (항상 포함)
// maxSize: 총 유니버스 크기 (기본 150)
// seed: null이면 Date.now() 사용
export function buildScreenerUniverse(fixed, maxSize = 150, seed = null) {
  const fixedUp  = [...new Set(fixed.map(t => t.toUpperCase()))];
  const fixedSet = new Set(fixedUp);
  const pool     = SP500_POOL.filter(t => !fixedSet.has(t));
  const effectiveSeed = seed !== null ? Number(seed) : Date.now();
  const sampled  = sampleN(pool, Math.max(0, maxSize - fixedUp.length), effectiveSeed);
  const sources  = {};
  for (const t of fixedUp) sources[t] = "fixed";
  for (const t of sampled) sources[t] = "random";
  return {
    tickers: [...fixedUp, ...sampled],
    sources,
    effectiveSeed,
    fixedCount:  fixedUp.length,
    randomCount: sampled.length,
  };
}

// ── 스크리너 모드 조건 ────────────────────────────────────────
// ind: App.jsx의 computeIndicators() 반환값
export const SCREENER_MODES = [
  {
    id: "A", name: "추세추종",
    conditions: [
      { label: "정배열",    fn: ind => ind.raw.ma20 != null && ind.raw.ma50 != null && ind.raw.ma20 > ind.raw.ma50 },
      { label: "MA20위",   fn: ind => ind.current_price > ind.raw.ma20 },
      { label: "신고가근접", fn: ind => ind.indicators.pos52w.fromH >= -10 },
      { label: "수급유입",  fn: ind => ind.raw.volRatio >= 1.3 },
      { label: "RSI모멘텀", fn: ind => ind.indicators.rsi.value >= 50 && ind.indicators.rsi.value <= 70 },
    ],
  },
  {
    id: "B", name: "역추세반등",
    conditions: [
      { label: "RSI과매도",  fn: ind => ind.indicators.rsi.value <= 35 },
      { label: "BB하단근접", fn: ind => {
        const bb = ind.raw.bb;
        return (bb.upper - bb.lower) > 0
          ? (ind.current_price - bb.lower) / (bb.upper - bb.lower) < 0.2
          : false;
      }},
      { label: "눌림구간",   fn: ind => ind.indicators.pos52w.fromH >= -25 && ind.indicators.pos52w.fromH <= -8 },
      { label: "반등거래량", fn: ind => ind.raw.volRatio >= 1.5 },
      { label: "MA50근접위", fn: ind => ind.raw.ma50 != null && ind.current_price >= ind.raw.ma50 * 0.97 },
    ],
  },
];

export const SCREENER_MIN_PASS = 4;

// 모드 평가 → 통과한 모드들의 결과 객체 반환 (없으면 null)
export function evalScreenerModes(ind) {
  const results = {};
  for (const mode of SCREENER_MODES) {
    const conds = mode.conditions.map(c => ({ label: c.label, passed: c.fn(ind) }));
    const count = conds.filter(r => r.passed).length;
    if (count >= SCREENER_MIN_PASS) {
      results[mode.id] = {
        name: mode.name,
        count,
        total: mode.conditions.length,
        tags: conds.filter(r => r.passed).map(r => r.label),
      };
    }
  }
  return Object.keys(results).length > 0 ? results : null;
}
