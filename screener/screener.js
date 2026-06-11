#!/usr/bin/env node
// ── WZ Stock Screener ─────────────────────────────────────────
// 사용법:
//   node screener/screener.js --apikey YOUR_TD_KEY
//   node screener/screener.js --apikey YOUR_TD_KEY --limit 50
//   TD_API_KEY=xxx node screener/screener.js
//
// 출력:
//   - 콘솔: 실시간 통과 종목 + 최종 요약 테이블
//   - 파일: screener/results/YYYY-MM-DD.json

import { UNIVERSE } from "./universe.js";
import { fetchIndicators } from "./indicators.js";
import { MODES, evalMode } from "./filters.js";
import { API_PLAN, CALL_DELAY_MS, SCREENER_CONFIG } from "./config.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI 파싱 ─────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
WZ Stock Screener

사용법:
  node screener/screener.js --apikey <TWELVE_DATA_KEY> [옵션]
  TD_API_KEY=<key> node screener/screener.js [옵션]

옵션:
  --apikey <key>   Twelve Data API 키 (또는 TD_API_KEY 환경변수)
  --limit  <n>     스캔할 종목 수 제한 (테스트용, 기본: 전체)
  --help           이 도움말 출력

예시:
  node screener/screener.js --apikey abc123
  node screener/screener.js --apikey abc123 --limit 30
`);
    process.exit(0);
  }
  const apiKey = get("--apikey") || process.env.TD_API_KEY;
  if (!apiKey) {
    console.error("오류: API 키가 없어요. --apikey YOUR_KEY 또는 TD_API_KEY 환경변수로 전달해주세요.\n");
    process.exit(1);
  }
  const limitArg = get("--limit");
  const limit = limitArg ? parseInt(limitArg, 10) : null;
  return { apiKey, limit };
}

// ── 유틸 ─────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function clearLine() {
  process.stdout.write("\r\x1b[2K");
}

// ── fetchUniverse ─────────────────────────────────────────────
function fetchUniverse(limit) {
  const tickers = UNIVERSE;
  return limit ? tickers.slice(0, limit) : tickers;
}

// ── runScreener ───────────────────────────────────────────────
async function runScreener(tickers, apiKey) {
  const minPass = SCREENER_CONFIG.minPassCount;
  const candidates = [];
  let errors = 0;
  const startTime = Date.now();

  console.log(`\n${"═".repeat(68)}`);
  console.log(" WZ STOCK SCREENER");
  console.log(`${"═".repeat(68)}`);
  console.log(` 플랜    : ${API_PLAN.name} (${API_PLAN.creditsPerMinute} 크레딧/분)`);
  console.log(` 딜레이  : ${CALL_DELAY_MS}ms/종목`);
  console.log(` 유니버스: ${tickers.length}종목`);
  console.log(` 예상시간: 약 ${Math.ceil(tickers.length * CALL_DELAY_MS / 60_000)}분`);
  console.log(` 통과기준: 모드당 ${minPass}/${SCREENER_CONFIG.minPassCount + 1}개 이상 조건 충족`);
  console.log(`${"─".repeat(68)}\n`);

  for (let i = 0; i < tickers.length; i++) {
    const sym = tickers[i];
    const pct = Math.round(((i + 1) / tickers.length) * 100);
    process.stdout.write(`\r 진행 ${String(i + 1).padStart(3)}/${tickers.length} (${String(pct).padStart(3)}%)  [${sym.padEnd(6)}]  통과: ${candidates.length}  오류: ${errors}`);

    try {
      const ind = await fetchIndicators(sym, apiKey);
      const modeResults = {};

      for (const mode of MODES) {
        const res = evalMode(ind, mode, minPass);
        if (res) modeResults[mode.id] = { ...res, name: mode.name };
      }

      const passedModes = Object.keys(modeResults);
      if (passedModes.length > 0) {
        const candidate = buildCandidate(sym, ind, modeResults, passedModes);
        candidates.push(candidate);
        clearLine();
        printMatch(candidate);
      }
    } catch (e) {
      errors++;
    }

    if (i < tickers.length - 1) await sleep(CALL_DELAY_MS);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  clearLine();
  console.log(`\n${"─".repeat(68)}`);
  console.log(` 완료: ${tickers.length}종목 스캔 · ${candidates.length}종목 통과 · ${errors}오류 · ${elapsed}초 소요`);
  console.log(`${"═".repeat(68)}\n`);

  return candidates;
}

// ── 후보 객체 생성 ────────────────────────────────────────────
function buildCandidate(sym, ind, modeResults, passedModes) {
  return {
    ticker: sym,
    modes: passedModes,
    modeDetails: modeResults,
    // Claude 판단 로직에 넘길 때 사용할 핵심 스냅샷
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
function printMatch(c) {
  const modeStr = c.modes
    .map(id => {
      const d = c.modeDetails[id];
      return `모드${id}(${d.count}/${d.detail.length}) ${d.name}`;
    })
    .join(" + ");
  const tags = [...new Set(c.modes.flatMap(id => c.modeDetails[id].tags))];
  const s = c.snapshot;
  console.log(` ✓ ${c.ticker.padEnd(6)} │ ${modeStr}`);
  console.log(`        RSI:${String(s.rsi).padStart(5)}  거래량:${String(s.volRatio + "x").padStart(5)}  52w:${String(s.fromH52 + "%").padStart(7)}  [${tags.join(", ")}]`);
}

// ── 최종 요약 테이블 ──────────────────────────────────────────
function printSummaryTable(candidates) {
  if (!candidates.length) {
    console.log(" 통과 종목 없음\n");
    return;
  }

  const header = " 티커   모드      조건     현재가    RSI   거래량   52주위치  태그";
  console.log(`${"═".repeat(80)}`);
  console.log(" 최종 결과 요약");
  console.log(`${"─".repeat(80)}`);
  console.log(header);
  console.log(`${"─".repeat(80)}`);

  // 모드A 우선, 그 다음 B, 둘 다면 맨 앞
  const sorted = [...candidates].sort((a, b) => {
    const aB = a.modes.length === 2 ? 0 : a.modes.includes("A") ? 1 : 2;
    const bB = b.modes.length === 2 ? 0 : b.modes.includes("A") ? 1 : 2;
    if (aB !== bB) return aB - bB;
    // 같은 모드면 충족 조건 많은 순
    const aMax = Math.max(...a.modes.map(id => a.modeDetails[id].count));
    const bMax = Math.max(...b.modes.map(id => b.modeDetails[id].count));
    return bMax - aMax;
  });

  for (const c of sorted) {
    const s = c.snapshot;
    const modeStr = c.modes.map(id => {
      const d = c.modeDetails[id];
      return `${id}:${d.count}/${d.detail.length}`;
    }).join("+").padEnd(8);
    const tags = [...new Set(c.modes.flatMap(id => c.modeDetails[id].tags))].join(", ");
    console.log(
      ` ${c.ticker.padEnd(6)} ` +
      `${modeStr} ` +
      `${"$" + s.cur.toFixed(2).padStart(8)}  ` +
      `${String(s.rsi.toFixed(1)).padStart(5)}  ` +
      `${String(s.volRatio.toFixed(1) + "x").padStart(6)}  ` +
      `${String(s.fromH52.toFixed(1) + "%").padStart(8)}  ` +
      tags,
    );
  }
  console.log(`${"═".repeat(80)}\n`);

  // 모드별 집계
  const modeA = candidates.filter(c => c.modes.includes("A")).length;
  const modeB = candidates.filter(c => c.modes.includes("B")).length;
  const both  = candidates.filter(c => c.modes.length === 2).length;
  console.log(` 모드A(추세추종): ${modeA}종목  모드B(역추세반등): ${modeB}종목  둘다: ${both}종목\n`);
}

// ── saveResults ───────────────────────────────────────────────
async function saveResults(candidates, totalScanned) {
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(__dirname, "results");
  await fs.mkdir(dir, { recursive: true });

  const output = {
    date,
    universe_size: totalScanned,
    passed: candidates.length,
    mode_counts: {
      A:    candidates.filter(c => c.modes.includes("A")).length,
      B:    candidates.filter(c => c.modes.includes("B")).length,
      both: candidates.filter(c => c.modes.length === 2).length,
    },
    // 추후 Claude 판단 로직에서 이 배열을 tickers로 그대로 사용 가능
    tickers: candidates.map(c => c.ticker),
    candidates,
  };

  const filepath = path.join(dir, `${date}.json`);
  await fs.writeFile(filepath, JSON.stringify(output, null, 2), "utf8");
  return filepath;
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const { apiKey, limit } = parseArgs();
  const tickers = fetchUniverse(limit);
  const candidates = await runScreener(tickers, apiKey);
  printSummaryTable(candidates);
  const filepath = await saveResults(candidates, tickers.length);
  console.log(` 저장 완료: ${filepath}`);
  console.log(` 티커 목록: ${candidates.map(c => c.ticker).join(", ") || "없음"}\n`);
}

main().catch(e => {
  console.error("\n오류:", e.message);
  process.exit(1);
});
