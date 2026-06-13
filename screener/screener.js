#!/usr/bin/env node
// ── WZ Stock Screener ─────────────────────────────────────────
// 사용법:
//   node screener/screener.js --apikey YOUR_TD_KEY
//   node screener/screener.js --apikey YOUR_TD_KEY --seed 42
//   node screener/screener.js --apikey YOUR_TD_KEY --limit 16
//   node screener/screener.js --apikey YOUR_TD_KEY --watchlist NVDA,TSLA --holdings AMD
//   node screener/screener.js --apikey YOUR_TD_KEY --force-refresh

import { buildUniverse, getSP500Count } from "./universe.js";
import { fetchRaw, computeIndicators } from "./indicators.js";
import {
  evaluateScreenerSnapshot,
  getSpyMarketRegime,
  sortModeACandidates,
} from "../src/screenerRules.js";
import { API_PLAN, SCREENER_CONFIG } from "./config.js";
import { getCached, setCached, countCached } from "./cache.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── CLI 파싱 ─────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) printHelp();

  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  const getList = (flag) => {
    const val = get(flag);
    return val ? val.split(",").map(t => t.trim().toUpperCase()).filter(Boolean) : null;
  };

  const apiKey = get("--apikey") || process.env.TD_API_KEY;
  if (!apiKey) {
    console.error("오류: API 키가 없어요.\n  --apikey YOUR_KEY 또는 TD_API_KEY 환경변수를 사용하세요.\n");
    process.exit(1);
  }

  const seedArg = get("--seed");
  const seed = seedArg !== null ? parseInt(seedArg, 10) : null;

  const limitArg = get("--limit");
  const limit = limitArg ? Math.min(parseInt(limitArg, 10), SCREENER_CONFIG.universeMaxSize) : null;

  const watchlistArg = getList("--watchlist");
  const holdingsArg  = getList("--holdings");
  const forceRefresh = args.includes("--force-refresh");

  return { apiKey, seed, limit, watchlistArg, holdingsArg, forceRefresh };
}

function printHelp() {
  console.log(`
WZ Stock Screener

사용법:
  node screener/screener.js --apikey <KEY> [옵션]
  TD_API_KEY=<KEY> node screener/screener.js [옵션]

옵션:
  --apikey   <key>         Twelve Data API 키
  --seed     <n>           랜덤 시드 고정 (재현용, 기본: 매 실행마다 달라짐)
  --limit    <n>           유니버스 크기 제한 (최대 ${SCREENER_CONFIG.universeMaxSize}, 테스트용)
  --watchlist A,B,C        CLI에서 워치리스트 지정 (my_tickers.json 오버라이드)
  --holdings  D,E          CLI에서 보유 종목 지정 (my_tickers.json 오버라이드)
  --force-refresh          캐시 무시하고 API 재호출 (크레딧 소모)
  --help                   이 도움말

고정 종목 관리:
  screener/my_tickers.json 파일에 watchlist/holdings 추가 → 항상 스캔에 포함

배치 방식:
  ${API_PLAN.batchSize}종목씩 묶어 호출 → ${API_PLAN.batchCooldownMs / 1000}초 쿨다운 → 반복
  하루 크레딧: ${API_PLAN.creditsPerDay} / 기본 유니버스: ${SCREENER_CONFIG.universeMaxSize}종목 (~${Math.ceil(SCREENER_CONFIG.universeMaxSize * API_PLAN.batchCooldownMs / API_PLAN.batchSize / 60000)}분)
  캐시: screener/cache/YYYY-MM-DD/ (같은 날 재실행 = 크레딧 0)
`);
  process.exit(0);
}

// ── my_tickers.json 로드 ─────────────────────────────────────
function loadMyTickers() {
  try {
    const data = require(path.join(__dirname, "my_tickers.json"));
    return {
      watchlist: (data.watchlist || []).map(t => t.toUpperCase()),
      holdings:  (data.holdings  || []).map(t => t.toUpperCase()),
    };
  } catch {
    return { watchlist: [], holdings: [] };
  }
}

// ── 배치 헬퍼 ────────────────────────────────────────────────
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function clearLine() { process.stdout.write("\r\x1b[2K"); }

// ── 종목 처리 (캐시 우선) ─────────────────────────────────────
async function processTicker(sym, apiKey, date, forceRefresh) {
  let values = null;
  let fromCache = false;

  if (!forceRefresh) {
    values = await getCached(sym, date);
    if (values) fromCache = true;
  }

  if (!values) {
    values = await fetchRaw(sym, apiKey, SCREENER_CONFIG, (attempt, max, waitMs) => {
      clearLine();
      console.log(`  ⚠  429 크레딧 초과 [${sym}] → ${waitMs / 1000}초 대기 후 재시도 (${attempt}/${max})...`);
    });
    await setCached(sym, date, values);
  }

  return { indicators: computeIndicators(values), fromCache };
}

// ── 메인 스크리닝 루프 ────────────────────────────────────────
async function runScreener(universe, apiKey, date, forceRefresh) {
  const { tickers, sources, effectiveSeed, stats } = universe;
  const scanTickers = ["SPY", ...tickers.filter(ticker => ticker !== "SPY")];
  const batches  = chunk(scanTickers, API_PLAN.batchSize);
  const candidates = [];
  let marketRegime = { allowModeA: false, trend: "bear", close: null, ma200: null, gapPct: null, reason: "SPY 미처리" };
  let apiCalls = 0, cacheHits = 0, errors = 0;
  const startTime = Date.now();
  const alreadyCached = await countCached(date);

  // ── 헤더 출력 ─────────────────────────────────────────────
  console.log(`\n${"═".repeat(72)}`);
  console.log("  WZ STOCK SCREENER");
  console.log(`${"═".repeat(72)}`);
  console.log(`  날짜       : ${date}`);
  console.log(`  S&P500 풀  : ${stats.sp500Pool}종목 (sp500.json)`);
  console.log(`  유니버스   : ${stats.total}종목  [고정 ${stats.fixed} + 랜덤 ${stats.random}]`);
  if (stats.fixed > 0) {
    const my = loadMyTickers();
    const wl = my.watchlist.join(", ") || "없음";
    const hd = my.holdings.join(", ")  || "없음";
    console.log(`    고정 - 워치리스트(${stats.watchlist}): ${wl}`);
    console.log(`    고정 - 보유종목(${stats.holdings}): ${hd}`);
  }
  console.log(`  랜덤 시드  : ${effectiveSeed}  (--seed ${effectiveSeed} 으로 재현 가능)`);
  console.log(`  배치 구성  : ${batches.length}배치 × ${API_PLAN.batchSize}종목, 쿨다운 ${API_PLAN.batchCooldownMs / 1000}초`);
  console.log(`  예상 소요  : 약 ${Math.ceil((batches.length - 1) * API_PLAN.batchCooldownMs / 60_000 + 1)}분`);
  console.log(`  캐시 현황  : ${alreadyCached}종목 캐시됨${forceRefresh ? " (--force-refresh: 무시)" : ""}`);
  console.log(`${"─".repeat(72)}\n`);

  // ── 배치 루프 ─────────────────────────────────────────────
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const batchStart = Date.now();
    const srcTags = batch.map(t => t === "SPY" ? "[시장]SPY" : sources[t] === "random" ? t : `[고정]${t}`).join(" ");
    process.stdout.write(`  [배치 ${bi + 1}/${batches.length}]  ${srcTags}\n`);

    for (let si = 0; si < batch.length; si++) {
      const sym = batch[si];
      const total = bi * API_PLAN.batchSize + si + 1;
      process.stdout.write(
        `\r  진행 ${String(total).padStart(3)}/${scanTickers.length}  [${sym.padEnd(5)}]  API: ${apiCalls}  캐시: ${cacheHits}  통과: ${candidates.length}`
      );

      try {
        const { indicators: ind, fromCache } = await processTicker(sym, apiKey, date, forceRefresh);
        fromCache ? cacheHits++ : apiCalls++;

        if (sym === "SPY") {
          marketRegime = getSpyMarketRegime(ind);
          clearLine();
          console.log(`  시장 필터: ${marketRegime.reason}${marketRegime.gapPct != null ? ` (${marketRegime.gapPct >= 0 ? "+" : ""}${marketRegime.gapPct.toFixed(1)}%)` : ""}`);
          continue;
        }

        const modeResults = evaluateScreenerSnapshot(ind, { allowModeA: marketRegime.allowModeA });
        if (modeResults) {
          const candidate = buildCandidate(sym, ind, modeResults, sources[sym]);
          candidates.push(candidate);
          clearLine();
          printMatch(candidate, fromCache);
        }
      } catch {
        errors++;
      }

      if (si < batch.length - 1) await sleep(API_PLAN.intraBatchDelayMs);
    }

    // 쿨다운 (마지막 배치 제외)
    if (bi < batches.length - 1) {
      const elapsed  = Date.now() - batchStart;
      const remaining = Math.max(0, API_PLAN.batchCooldownMs - elapsed);
      if (remaining > 0) {
        clearLine();
        process.stdout.write(`  ⏱  다음 배치까지 ${Math.ceil(remaining / 1000)}초 대기...\n`);
        await sleep(remaining);
      }
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  clearLine();
  console.log(`\n${"─".repeat(72)}`);
  console.log(`  완료: ${tickers.length}종목 + SPY · API ${apiCalls}콜 · 캐시 ${cacheHits}회 · 오류 ${errors}개 · ${elapsed}초`);
  console.log(`  일별 크레딧 사용: ${apiCalls} / ${API_PLAN.creditsPerDay}`);
  console.log(`${"═".repeat(72)}\n`);

  const rankedA = sortModeACandidates(candidates.filter(candidate => candidate.modeDetails.A));
  const aRank = new Map(rankedA.map((candidate, index) => [candidate.ticker, index]));
  const sortedCandidates = [...candidates].sort((a, b) => {
    const aHasA = aRank.has(a.ticker);
    const bHasA = aRank.has(b.ticker);
    if (aHasA && bHasA) return aRank.get(a.ticker) - aRank.get(b.ticker);
    if (aHasA !== bHasA) return aHasA ? -1 : 1;
    return a.ticker.localeCompare(b.ticker);
  }).map(candidate => ({ ...candidate, marketRegime }));
  return { candidates: sortedCandidates, marketRegime };
}

// ── 후보 객체 ─────────────────────────────────────────────────
function buildCandidate(sym, ind, modeResults, source) {
  return {
    ticker: sym,
    source: source || "random",   // "holding" | "watchlist" | "random"
    modes: Object.keys(modeResults),
    modeDetails: modeResults,
    snapshot: {
      cur:      Math.round(ind.cur * 100) / 100,
      rsi:      Math.round(ind.rsi * 10) / 10,
      volRatio: Math.round(ind.volRatio * 100) / 100,
      fromH52:  Math.round(ind.fromH52 * 10) / 10,
      pos52w:   ind.pos52w,
      ma20:     Math.round(ind.ma20 * 100) / 100,
      ma50:     ind.ma50 ? Math.round(ind.ma50 * 100) / 100 : null,
      atrPct:   Math.round(ind.atrPct * 10) / 10,
      bbPos:    Math.round(ind.bbPos * 100) / 100,
      mfRatio:  Math.round(ind.mfRatio * 1000) / 1000,
      ma20GapPct: Math.round(ind.ma20GapPct * 100) / 100,
    },
  };
}

// ── 실시간 매치 출력 ──────────────────────────────────────────
function printMatch(c, fromCache) {
  const srcTag  = c.source === "holding" ? "[보유]" : c.source === "watchlist" ? "[관심]" : "[랜덤]";
  const cacheTag = fromCache ? "[캐시]" : "[API] ";
  const modes = c.modes.map(id => {
    const d = c.modeDetails[id];
    return `모드${id}(${d.count}/${d.total}) ${d.name}`;
  }).join(" + ");
  const tags = [...new Set(c.modes.flatMap(id => c.modeDetails[id].tags))];
  const s = c.snapshot;
  console.log(`  ✓ ${c.ticker.padEnd(5)} ${srcTag} ${cacheTag}  ${modes}`);
  console.log(`        RSI:${String(s.rsi).padStart(5)}  거래량:${(s.volRatio.toFixed(1) + "x").padStart(5)}  52w:${(s.fromH52.toFixed(1) + "%").padStart(7)}  [${tags.join(", ")}]`);
}

// ── 최종 요약 테이블 ──────────────────────────────────────────
function printSummaryTable(candidates) {
  if (!candidates.length) { console.log("  통과 종목 없음\n"); return; }

  const sorted = [...candidates].sort((a, b) => {
    // 고정 종목 우선, 그 다음 둘 다 통과, A만, B만
    if (a.source !== b.source) return a.source !== "random" ? -1 : 1;
    const rank = x => x.modes.length === 2 ? 0 : x.modes.includes("A") ? 1 : 2;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const maxCount = x => Math.max(...x.modes.map(id => x.modeDetails[id].count));
    return maxCount(b) - maxCount(a);
  });

  console.log(`${"═".repeat(84)}`);
  console.log("  최종 결과 요약");
  console.log(`${"─".repeat(84)}`);
  console.log("  티커   출처   모드      조건     현재가     RSI   거래량   52주위치  태그");
  console.log(`${"─".repeat(84)}`);

  for (const c of sorted) {
    const s = c.snapshot;
    const srcLabel = c.source === "holding" ? "[보유]" : c.source === "watchlist" ? "[관심]" : "[랜덤]";
    const mStr = c.modes.map(id => `${id}:${c.modeDetails[id].count}/${c.modeDetails[id].total}`).join("+").padEnd(9);
    const tags = [...new Set(c.modes.flatMap(id => c.modeDetails[id].tags))].join(", ");
    console.log(
      `  ${c.ticker.padEnd(5)} ${srcLabel}  ${mStr} ` +
      `${"$" + s.cur.toFixed(2)}`.padStart(10) + "  " +
      String(s.rsi.toFixed(1)).padStart(5) + "  " +
      (s.volRatio.toFixed(1) + "x").padStart(6) + "  " +
      (s.fromH52.toFixed(1) + "%").padStart(8) + "  " +
      tags,
    );
  }
  console.log(`${"═".repeat(84)}\n`);

  const mA   = candidates.filter(c => c.modes.includes("A")).length;
  const mB   = candidates.filter(c => c.modes.includes("B")).length;
  const both = candidates.filter(c => c.modes.length === 2).length;
  const fixedPass = candidates.filter(c => c.source !== "random").length;
  const randPass  = candidates.filter(c => c.source === "random").length;
  console.log(`  모드A(추세추종): ${mA}  모드B(역추세반등): ${mB}  둘다: ${both}`);
  console.log(`  고정 통과: ${fixedPass}  랜덤 통과: ${randPass}  합계: ${candidates.length}\n`);
}

// ── saveResults ───────────────────────────────────────────────
async function saveResults(candidates, universe, date, marketRegime) {
  const dir = path.join(__dirname, "results");
  await fs.mkdir(dir, { recursive: true });

  const output = {
    date,
    seed: universe.effectiveSeed,
    universe: universe.stats,
    passed: candidates.length,
    mode_counts: {
      A:    candidates.filter(c => c.modes.includes("A")).length,
      B:    candidates.filter(c => c.modes.includes("B")).length,
      both: candidates.filter(c => c.modes.length === 2).length,
    },
    source_counts: {
      fixed:  candidates.filter(c => c.source !== "random").length,
      watchlist: candidates.filter(c => c.source === "watchlist").length,
      holdings: candidates.filter(c => c.source === "holding").length,
      random: candidates.filter(c => c.source === "random").length,
    },
    // Claude 판단 로직에 그대로 넘길 수 있는 티커 목록
    tickers: candidates.map(c => c.ticker),
    candidates,
    marketRegime,
  };

  const filepath = path.join(dir, `${date}.json`);
  await fs.writeFile(filepath, JSON.stringify(output, null, 2), "utf8");
  return filepath;
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const { apiKey, seed, limit, watchlistArg, holdingsArg, forceRefresh } = parseArgs();
  const date = new Date().toISOString().slice(0, 10);

  // my_tickers.json + CLI override
  const myTickers = loadMyTickers();
  const watchlist = watchlistArg ?? myTickers.watchlist;
  const holdings  = holdingsArg  ?? myTickers.holdings;

  const maxSize = limit ?? SCREENER_CONFIG.universeMaxSize;
  const universe = buildUniverse(watchlist, holdings, maxSize, seed);

  const { candidates, marketRegime } = await runScreener(universe, apiKey, date, forceRefresh);
  printSummaryTable(candidates);

  const filepath = await saveResults(candidates, universe, date, marketRegime);
  console.log(`  저장: ${filepath}`);
  console.log(`  티커: ${candidates.map(c => c.ticker).join(", ") || "없음"}\n`);
}

main().catch(e => { console.error("\n오류:", e.message); process.exit(1); });
