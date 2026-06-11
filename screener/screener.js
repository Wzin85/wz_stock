#!/usr/bin/env node
// ── WZ Stock Screener ─────────────────────────────────────────
// 사용법:
//   node screener/screener.js --apikey YOUR_TD_KEY
//   node screener/screener.js --apikey YOUR_TD_KEY --limit 50
//   node screener/screener.js --apikey YOUR_TD_KEY --force-refresh
//   TD_API_KEY=xxx node screener/screener.js

import { UNIVERSE, TOP150 } from "./universe.js";
import { fetchRaw, computeIndicators } from "./indicators.js";
import { MODES, evalMode } from "./filters.js";
import { API_PLAN, SCREENER_CONFIG } from "./config.js";
import { getCached, setCached, countCached } from "./cache.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── CLI 파싱 ─────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) printHelp();

  const get = flag => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : null; };

  const apiKey = get("--apikey") || process.env.TD_API_KEY;
  if (!apiKey) {
    console.error("오류: API 키가 없어요.\n  --apikey YOUR_KEY 또는 TD_API_KEY 환경변수를 사용하세요.\n");
    process.exit(1);
  }

  const limitArg = get("--limit");
  const limit = limitArg ? Math.min(parseInt(limitArg, 10), SCREENER_CONFIG.universeMaxSize) : null;
  const forceRefresh = args.includes("--force-refresh");
  return { apiKey, limit, forceRefresh };
}

function printHelp() {
  console.log(`
WZ Stock Screener

사용법:
  node screener/screener.js --apikey <KEY> [옵션]
  TD_API_KEY=<KEY> node screener/screener.js [옵션]

옵션:
  --apikey <key>     Twelve Data API 키
  --limit  <n>       스캔 종목 수 제한 (최대 ${SCREENER_CONFIG.universeMaxSize}, 테스트용)
  --force-refresh    캐시 무시하고 API 재호출 (크레딧 소모)
  --help             이 도움말

배치 방식:
  ${API_PLAN.batchSize}종목씩 묶어 호출 → ${API_PLAN.batchCooldownMs / 1000}초 대기 → 반복
  하루 크레딧 한도: ${API_PLAN.creditsPerDay} / 기본 유니버스: ${UNIVERSE.length}종목
  캐시: screener/cache/YYYY-MM-DD/ (같은 날 재실행 시 무료)
`);
  process.exit(0);
}

// ── 배치 큐 처리 ─────────────────────────────────────────────
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function clearLine() { process.stdout.write("\r\x1b[2K"); }

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

async function runScreener(tickers, apiKey, date, forceRefresh) {
  const minPass   = SCREENER_CONFIG.minPassCount;
  const batches   = chunk(tickers, API_PLAN.batchSize);
  const candidates = [];
  let apiCalls = 0, cacheHits = 0, errors = 0;
  const startTime = Date.now();

  // 캐시 현황 미리 파악
  const alreadyCached = await countCached(date);

  console.log(`\n${"═".repeat(70)}`);
  console.log("  WZ STOCK SCREENER");
  console.log(`${"═".repeat(70)}`);
  console.log(`  날짜     : ${date}`);
  console.log(`  유니버스 : ${tickers.length}종목 (최대 ${SCREENER_CONFIG.universeMaxSize})`);
  console.log(`  배치 설정: ${API_PLAN.batchSize}종목 / 배치,  ${API_PLAN.batchCooldownMs / 1000}초 쿨다운`);
  console.log(`  총 배치  : ${batches.length}개 → 약 ${Math.ceil((batches.length - 1) * API_PLAN.batchCooldownMs / 60_000)}분`);
  console.log(`  캐시 현황: ${alreadyCached}종목 이미 캐시됨${forceRefresh ? " (--force-refresh: 무시)" : ""}`);
  console.log(`  일별 크레딧: ${API_PLAN.creditsPerDay} (오늘 예상 사용: 최대 ${tickers.length - (forceRefresh ? 0 : alreadyCached)})`);
  console.log(`${"─".repeat(70)}\n`);

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const batchStart = Date.now();
    const scanned = bi * API_PLAN.batchSize;

    process.stdout.write(`  [배치 ${bi + 1}/${batches.length}]  ${batch.join(" ")}\n`);

    for (let si = 0; si < batch.length; si++) {
      const sym = batch[si];
      const total = bi * API_PLAN.batchSize + si + 1;
      process.stdout.write(`\r  진행 ${String(total).padStart(3)}/${tickers.length}  [${sym.padEnd(5)}]  API: ${apiCalls}  캐시: ${cacheHits}  통과: ${candidates.length}`);

      try {
        const { indicators: ind, fromCache } = await processTicker(sym, apiKey, date, forceRefresh);
        fromCache ? cacheHits++ : apiCalls++;

        const modeResults = {};
        for (const mode of MODES) {
          const res = evalMode(ind, mode, minPass);
          if (res) modeResults[mode.id] = { ...res, name: mode.name };
        }

        if (Object.keys(modeResults).length > 0) {
          const candidate = buildCandidate(sym, ind, modeResults);
          candidates.push(candidate);
          clearLine();
          printMatch(candidate, fromCache);
        }
      } catch (e) {
        errors++;
      }

      // 배치 내 마지막 종목이 아니면 짧은 딜레이
      if (si < batch.length - 1) await sleep(API_PLAN.intraBatchDelayMs);
    }

    // 다음 배치 전 쿨다운 (마지막 배치 제외)
    if (bi < batches.length - 1) {
      const elapsed = Date.now() - batchStart;
      const remaining = Math.max(0, API_PLAN.batchCooldownMs - elapsed);
      if (remaining > 0) {
        const secs = Math.ceil(remaining / 1000);
        clearLine();
        process.stdout.write(`  ⏱  다음 배치까지 ${secs}초 대기...\n`);
        await sleep(remaining);
      }
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  clearLine();
  console.log(`\n${"─".repeat(70)}`);
  console.log(`  완료: ${tickers.length}종목 스캔 · API ${apiCalls}콜 · 캐시 ${cacheHits}회 · 오류 ${errors}개 · ${elapsed}초`);
  console.log(`  일별 크레딧 사용: ${apiCalls} / ${API_PLAN.creditsPerDay}`);
  console.log(`${"═".repeat(70)}\n`);

  return candidates;
}

// ── 후보 객체 ─────────────────────────────────────────────────
function buildCandidate(sym, ind, modeResults) {
  const passedModes = Object.keys(modeResults);
  return {
    ticker: sym,
    modes: passedModes,
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
    },
  };
}

// ── 실시간 매치 출력 ──────────────────────────────────────────
function printMatch(c, fromCache) {
  const src  = fromCache ? "캐시" : "API";
  const modes = c.modes.map(id => {
    const d = c.modeDetails[id];
    return `모드${id}(${d.count}/${d.detail.length}) ${d.name}`;
  }).join(" + ");
  const tags = [...new Set(c.modes.flatMap(id => c.modeDetails[id].tags))];
  const s = c.snapshot;
  console.log(`  ✓ ${c.ticker.padEnd(5)} [${src}]  ${modes}`);
  console.log(`       RSI:${String(s.rsi).padStart(5)}  거래량:${(s.volRatio.toFixed(1) + "x").padStart(5)}  52w:${(s.fromH52.toFixed(1) + "%").padStart(7)}  [${tags.join(", ")}]`);
}

// ── 최종 요약 테이블 ──────────────────────────────────────────
function printSummaryTable(candidates) {
  if (!candidates.length) { console.log("  통과 종목 없음\n"); return; }

  // 둘 다 통과 → A만 → B만 순, 조건 많은 순
  const sorted = [...candidates].sort((a, b) => {
    const rank = x => x.modes.length === 2 ? 0 : x.modes.includes("A") ? 1 : 2;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const maxCount = x => Math.max(...x.modes.map(id => x.modeDetails[id].count));
    return maxCount(b) - maxCount(a);
  });

  console.log(`${"═".repeat(82)}`);
  console.log("  최종 결과 요약");
  console.log(`${"─".repeat(82)}`);
  console.log("  티커   모드      조건     현재가     RSI   거래량   52주위치  태그");
  console.log(`${"─".repeat(82)}`);

  for (const c of sorted) {
    const s = c.snapshot;
    const mStr = c.modes.map(id => `${id}:${c.modeDetails[id].count}/${c.modeDetails[id].detail.length}`).join("+").padEnd(9);
    const tags = [...new Set(c.modes.flatMap(id => c.modeDetails[id].tags))].join(", ");
    console.log(
      `  ${c.ticker.padEnd(6)} ${mStr} ` +
      `${"$" + s.cur.toFixed(2)}`.padStart(10) + "  " +
      String(s.rsi.toFixed(1)).padStart(5) + "  " +
      (s.volRatio.toFixed(1) + "x").padStart(6) + "  " +
      (s.fromH52.toFixed(1) + "%").padStart(8) + "  " +
      tags,
    );
  }
  console.log(`${"═".repeat(82)}\n`);

  const mA   = candidates.filter(c => c.modes.includes("A")).length;
  const mB   = candidates.filter(c => c.modes.includes("B")).length;
  const both = candidates.filter(c => c.modes.length === 2).length;
  console.log(`  모드A(추세추종): ${mA}  모드B(역추세반등): ${mB}  둘다: ${both}  합계: ${candidates.length}\n`);
}

// ── saveResults ───────────────────────────────────────────────
async function saveResults(candidates, tickers, date) {
  const dir = path.join(__dirname, "results");
  await fs.mkdir(dir, { recursive: true });

  const output = {
    date,
    universe_size: tickers.length,
    passed: candidates.length,
    mode_counts: {
      A:    candidates.filter(c => c.modes.includes("A")).length,
      B:    candidates.filter(c => c.modes.includes("B")).length,
      both: candidates.filter(c => c.modes.length === 2).length,
    },
    // 기존 Claude 판단 로직에 그대로 전달 가능한 티커 배열
    tickers: candidates.map(c => c.ticker),
    candidates,
  };

  const filepath = path.join(dir, `${date}.json`);
  await fs.writeFile(filepath, JSON.stringify(output, null, 2), "utf8");
  return filepath;
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const { apiKey, limit, forceRefresh } = parseArgs();
  const date    = new Date().toISOString().slice(0, 10);
  const tickers = limit ? UNIVERSE.slice(0, limit) : UNIVERSE.slice(0, SCREENER_CONFIG.universeMaxSize);

  const candidates = await runScreener(tickers, apiKey, date, forceRefresh);
  printSummaryTable(candidates);

  const filepath = await saveResults(candidates, tickers, date);
  console.log(`  저장: ${filepath}`);
  console.log(`  티커: ${candidates.map(c => c.ticker).join(", ") || "없음"}\n`);
}

main().catch(e => { console.error("\n오류:", e.message); process.exit(1); });
