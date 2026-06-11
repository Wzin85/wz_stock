// ── 일별 OHLCV 캐시 ────────────────────────────────────────────
// 하루 1회 받은 raw values를 screener/cache/YYYY-MM-DD/TICKER.json 에 저장
// 같은 날 재실행 시 API 재호출 없이 캐시 반환

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_BASE = path.join(__dirname, "cache");

function cacheFilePath(sym, date) {
  return path.join(CACHE_BASE, date, `${sym}.json`);
}

// 캐시 히트 시 values 배열 반환, 없으면 null
export async function getCached(sym, date) {
  try {
    const raw = await fs.readFile(cacheFilePath(sym, date), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// API 응답 values 배열을 캐시에 저장
export async function setCached(sym, date, values) {
  const file = cacheFilePath(sym, date);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(values), "utf8");
}

// 특정 날짜에 캐시된 종목 수 반환 (진행 상황 표시용)
export async function countCached(date) {
  const dir = path.join(CACHE_BASE, date);
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}
