// ── 스크리닝 유니버스 ─────────────────────────────────────────
// UNIVERSE export를 교체하면 스캔 대상 전체가 바뀜
// TOP150: 시총·거래량 상위 150 종목 (기본값, 하루 800 크레딧 내 수용)
// NASDAQ100 / SP500: 필요 시 [...new Set([...NASDAQ100,...SP500])] 로 확장

// ── 시총·거래량 상위 150 종목 ─────────────────────────────────
export const TOP150 = [
  // 빅테크·플랫폼 (10)
  "AAPL","MSFT","NVDA","AMZN","META","GOOGL","GOOG","TSLA","AVGO","ORCL",

  // 반도체 (15)
  "AMD","QCOM","TXN","INTC","MU","AMAT","LRCX","KLAC","ASML","ARM",
  "ADI","ON","MRVL","NXPI","SMCI",

  // 소프트웨어·클라우드·사이버보안 (15)
  "ACN","CSCO","IBM","CRM","ADBE","INTU","NOW","PANW","CRWD","DDOG",
  "ZS","FTNT","PLTR","WDAY","CDNS",

  // 금융 (15)
  "V","MA","JPM","BAC","WFC","GS","MS","BLK","SCHW","AXP",
  "SPGI","MCO","CME","ICE","C",

  // 헬스케어·바이오 (15)
  "UNH","LLY","JNJ","ABBV","MRK","ABT","TMO","DHR","PFE","BMY",
  "AMGN","GILD","VRTX","REGN","ISRG",

  // 임의소비재 (15)
  "HD","MCD","COST","NKE","SBUX","LOW","TGT","TJX","BKNG","UBER",
  "HLT","MAR","ABNB","F","GM",

  // 필수소비재 (10)
  "WMT","PG","KO","PEP","MO","PM","CL","CLX","EL","KHC",

  // 커뮤니케이션·미디어 (10)
  "NFLX","DIS","CMCSA","T","VZ","TMUS","EA","RBLX","TTWO","WBD",

  // 에너지 (10)
  "XOM","CVX","COP","SLB","EOG","HAL","MPC","VLO","OXY","DVN",

  // 산업재 (15)
  "GE","BA","CAT","HON","RTX","LMT","UPS","EMR","ETN","DE",
  "NOC","GD","ITW","CSX","UNP",

  // 소재 (10)
  "LIN","APD","SHW","ECL","FCX","NEM","ALB","NUE","CF","AVY",

  // 부동산·유틸리티 (10)
  "AMT","PLD","EQIX","CCI","NEE","DUK","SO","D","SPG","AWK",
];

// ── 확장 유니버스 (필요 시 UNIVERSE = FULL_UNIVERSE 로 교체) ─
export const NASDAQ100 = [
  "AAPL","MSFT","NVDA","AMZN","META","GOOGL","GOOG","TSLA","AVGO","COST",
  "ASML","NFLX","AMD","AZN","TMUS","QCOM","LIN","PEP","CSCO","TXN",
  "ADBE","INTU","AMGN","HON","BKNG","VRTX","SBUX","ISRG","SNY","GILD",
  "MDLZ","ADI","REGN","PANW","ADP","MU","LRCX","KLAC","CRWD","INTC",
  "MELI","CDNS","AMAT","MRNA","SNPS","MAR","ORLY","PYPL","FTNT","MNST",
  "PCAR","CTAS","ODFL","WDAY","MCHP","BIIB","ABNB","IDXX","KDP","EXC",
  "TTWO","DLTR","FAST","ILMN","ROST","ZS","NXPI","DXCM","WBD","VRSK",
  "TEAM","DDOG","ON","CPRT","FANG","SMCI","CEG","DASH","TTD","ARM",
  "GEHC","PLTR","GFS","MRVL","ROP",
];

export const SP500 = [
  "NOW","ORCL","CRM","IBM","ACN","DELL","HPQ","HPE","GLW","ANET","VRT","FIS","FISV","GPN","CTSH",
  "UNH","JNJ","LLY","ABBV","MRK","ABT","TMO","DHR","BMY","PFE",
  "CI","HUM","CVS","MCK","ELV","CNC","MOH","HCA","SYK","BSX","MDT","EW","BDX","BAX","RMD","DGX","LH","MTD","VEEV","ALGN",
  "JPM","BAC","WFC","GS","MS","C","BLK","SCHW","AXP","PGR",
  "TRV","MCO","SPGI","CME","ICE","COF","DFS","SYF","HIG","MET",
  "PRU","AFL","AIG","ALL","MMC","AON","BK","STT","USB","PNC","TFC","MTB","CFG","RF","KEY","CINF","CB","WTW","ALLY",
  "HD","MCD","NKE","LOW","TGT","TJX","ULTA","MGM","RCL","CCL","NCLH","HLT","EXPE","UBER","F","GM","LEN","DHI","PHM","EBAY","ETSY","BBY","GPC","WYNN","LVS",
  "WMT","PG","KO","KHC","GIS","MKC","HSY","CL","CLX","EL","MO","PM","STZ","WBA","SYY","TSN","HRL","CAG","CHD","CELH",
  "XOM","CVX","COP","SLB","EOG","MPC","VLO","PSX","OXY","HES","HAL","DVN","BKR","CTRA","APA","EQT",
  "BA","CAT","GE","UPS","LMT","RTX","NOC","GD","TDG","MMM","EMR","ROK","AME","PH","ETN","IR","ITW","GWW","SNA","CMI","DE","CSX","UNP","NSC","WM","RSG","JBHT","EXPD","CHRW","AZO","AXON",
  "APD","PPG","SHW","ECL","ALB","FCX","NEM","NUE","STLD","CF","MOS","IP","PKG","LYB","EMN","AA","X","CLF","FMC","AVY",
  "AMT","PLD","EQIX","CCI","DLR","SPG","O","VICI","PSA","WELL","EQR","AVB","ARE","BXP","KIM","NNN",
  "NEE","DUK","SO","D","AEE","PPL","WEC","ED","SRE","PCG","ETR","FE","AWK","CMS","CNP","AES",
  "DIS","CMCSA","T","VZ","CHTR","EA","RBLX","MTCH","OMC","IPG","FOXA","NWS",
];

export const FULL_UNIVERSE = [...new Set([...NASDAQ100, ...SP500])];

// ── 기본 유니버스 (여기를 바꿔서 스캔 대상 교체) ─────────────
export const UNIVERSE = TOP150;
