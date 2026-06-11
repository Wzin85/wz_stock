// ── 스크리닝 유니버스 ─────────────────────────────────────────
// UNIVERSE 배열을 직접 편집해서 스캔 대상 변경 가능
// SP500 / NASDAQ100은 별도 export — 교체 시 UNIVERSE만 재할당

export const NASDAQ100 = [
  // 빅테크·반도체
  "AAPL","MSFT","NVDA","AMZN","META","GOOGL","GOOG","TSLA","AVGO","ASML",
  "AMD","QCOM","TXN","ADI","MCHP","NXPI","ON","MU","LRCX","KLAC",
  "AMAT","CDNS","SNPS","SMCI","ARM","MRVL","GFS","INTC",
  // 소프트웨어·클라우드
  "MSFT","ADBE","INTU","CRM","NOW","ORCL","WDAY","TEAM","DDOG","ZS",
  "CRWD","PANW","FTNT","PLTR","DASH","TTD",
  // 소비재·유통
  "AMZN","TSLA","COST","SBUX","BKNG","MAR","ABNB","EBAY","PYPL","MELI",
  "NFLX","DLTR","ROST","ORLY","ODFL","FAST","PCAR","CTAS","CPRT",
  // 헬스케어·바이오
  "AMGN","GILD","VRTX","REGN","BIIB","MRNA","ILMN","IDXX","ISRG","DXCM",
  // 통신·미디어
  "TMUS","WBD","TTWO",
  // 에너지·유틸리티
  "FANG","CEG","EXC","XEL","KDP",
  // 기타
  "LIN","PEP","CSCO","HON","ADP","MDLZ","MNST","SNY","AZN",
  "VRSK","GEHC","INTU","PYPL",
];

export const SP500 = [
  // ── 기술 ────────────────────────────────────────────────────
  "IBM","ACN","DELL","HPQ","HPE","GLW","ANET","VRT","FIS","FISV","GPN",
  "CTSH","EPAM","FSLR","ENPH","CDW","WU","GDDY","INTU",
  // ── 헬스케어 ────────────────────────────────────────────────
  "UNH","JNJ","LLY","ABBV","MRK","ABT","TMO","DHR","BMY","PFE",
  "CI","HUM","CVS","MCK","ELV","CNC","MOH","HCA","SYK","BSX",
  "MDT","EW","BDX","BAX","RMD","DGX","LH","MTD","VEEV","ALGN",
  "PODD","HOLX","INCY","ZBH","HSIC","ROP",
  // ── 금융 ────────────────────────────────────────────────────
  "JPM","BAC","WFC","GS","MS","C","BLK","SCHW","AXP","PGR",
  "TRV","MCO","SPGI","CME","ICE","COF","DFS","SYF","HIG","MET",
  "PRU","AFL","AIG","ALL","MMC","AON","BK","STT","USB","PNC",
  "TFC","MTB","CFG","RF","KEY","FITB","HBAN","NTRS","CINF","CB",
  "WTW","RJF","ALLY","ZION","CBSH",
  // ── 임의소비재 ──────────────────────────────────────────────
  "HD","MCD","NKE","LOW","TGT","TJX","ULTA","MGM","RCL","CCL",
  "NCLH","HLT","EXPE","UBER","F","GM","LEN","DHI","PHM","TOL",
  "NVR","ETSY","BBY","W","AAP","GPC","APTV","LKQ","POOL","WYNN",
  "LVS","GNTX","BWA",
  // ── 필수소비재 ──────────────────────────────────────────────
  "WMT","PG","KO","KHC","GIS","MKC","HSY","CL","CLX","EL",
  "MO","PM","STZ","WBA","SYY","TSN","HRL","SJM","CAG","CHD",
  "CELH","KR","USFD",
  // ── 에너지 ──────────────────────────────────────────────────
  "XOM","CVX","COP","SLB","EOG","MPC","VLO","PSX","OXY","HES",
  "HAL","DVN","BKR","CTRA","APA","EQT","RRC","CNX","AR","CHK",
  "MTDR","NOG","OVV","SM",
  // ── 산업재 ──────────────────────────────────────────────────
  "BA","CAT","GE","UPS","LMT","RTX","NOC","GD","TDG","MMM",
  "EMR","ROK","AME","PH","ETN","IR","ITW","GWW","SNA","CMI",
  "DE","CSX","UNP","NSC","CP","CNI","WM","RSG","JBHT","EXPD",
  "CHRW","AZO","XPO","SAIA","AXON","KTOS","HII","AGCO",
  // ── 소재 ────────────────────────────────────────────────────
  "APD","PPG","SHW","ECL","ALB","FCX","NEM","NUE","STLD","CF",
  "MOS","IP","PKG","LYB","EMN","AA","X","CLF","FMC","AVY","CC",
  // ── 부동산 ──────────────────────────────────────────────────
  "AMT","PLD","EQIX","CCI","DLR","SPG","O","VICI","PSA","WELL",
  "EQR","AVB","ESS","MAA","ARE","BXP","KIM","NNN","WY",
  // ── 유틸리티 ────────────────────────────────────────────────
  "NEE","DUK","SO","D","AEE","PPL","WEC","ED","SRE","PCG",
  "ETR","FE","AWK","CMS","CNP","AES","ES","NI",
  // ── 커뮤니케이션 ────────────────────────────────────────────
  "DIS","CMCSA","T","VZ","CHTR","EA","RBLX","MTCH","OMC","IPG",
  "FOXA","NWS","NWSA","LUMN",
];

// 중복 제거한 최종 유니버스
export const UNIVERSE = [...new Set([...NASDAQ100, ...SP500])];
