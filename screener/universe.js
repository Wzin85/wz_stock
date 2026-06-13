// ── 유니버스 빌더 ─────────────────────────────────────────────
// buildUniverse(): 고정(워치리스트+보유) + 랜덤 샘플 조합
// S&P 500 전체 목록은 sp500.json에 보관 (API 크레딧 0)

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// sp500.json 로드 (정적 파일, 절대 API 호출 없음)
function loadSP500() {
  const data = require(path.join(__dirname, "sp500.json"));
  // 중복 제거 후 반환
  return [...new Set(data.tickers.map(t => t.toUpperCase()))];
}

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

// 시드 기반 Fisher-Yates 셔플 후 앞에서 n개 추출
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

// ── 유니버스 구성 ─────────────────────────────────────────────
/**
 * @param {string[]} watchlist  - 워치리스트 티커
 * @param {string[]} holdings   - 보유 종목 티커
 * @param {number}   maxSize    - 총 유니버스 크기 (기본 150)
 * @param {number|null} seed    - 랜덤 시드 (null이면 Date.now() 사용)
 * @returns {{ tickers, sources, effectiveSeed, stats }}
 */
export function buildUniverse(watchlist = [], holdings = [], maxSize = 150, seed = null) {
  const sp500 = loadSP500();

  // 고정 슬롯: 워치리스트 + 보유 (중복 제거, 대문자 통일)
  const fixed = [...new Set([
    ...watchlist.map(t => t.toUpperCase()),
    ...holdings.map(t => t.toUpperCase()),
  ])];

  // 고정 종목이 S&P500 목록 밖이어도 그대로 포함
  const fixedSet = new Set(fixed);
  const pool = sp500.filter(t => !fixedSet.has(t));

  const needed = Math.max(0, maxSize - fixed.length);
  const effectiveSeed = seed !== null ? Number(seed) : Date.now();
  const sampled = sampleN(pool, needed, effectiveSeed);

  // 출처 맵: "holding" | "watchlist" | "random"
  const sources = {};
  for (const t of watchlist.map(ticker => ticker.toUpperCase())) sources[t] = "watchlist";
  for (const t of holdings.map(ticker => ticker.toUpperCase())) sources[t] = "holding";
  for (const t of sampled) sources[t] = "random";

  return {
    tickers: [...fixed, ...sampled],
    sources,
    effectiveSeed,
    stats: {
      total: fixed.length + sampled.length,
      fixed: fixed.length,
      random: sampled.length,
      sp500Pool: sp500.length,
      watchlist: watchlist.length,
      holdings: holdings.length,
    },
  };
}

// 로드 검증용 (테스트 목적)
export function getSP500Count() {
  return loadSP500().length;
}
