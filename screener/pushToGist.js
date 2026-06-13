// GitHub Actions에서 실행: 스크리너 결과 → Gist 업로드
// wz_screener.json 파일을 브라우저 앱이 읽는 형식으로 변환해서 업로드
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.GH_TOKEN;
if (!token) { console.error("GH_TOKEN 환경변수 없음"); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const resultsPath = path.join(__dirname, "results", `${today}.json`);

let raw;
try {
  raw = JSON.parse(readFileSync(resultsPath, "utf-8"));
} catch {
  console.error(`결과 파일 없음: ${resultsPath}`);
  process.exit(1);
}

// CLI 형식 → 브라우저 앱 형식 변환
const candidates = (raw.candidates || []).map(c => ({
  ticker: c.ticker,
  source: c.source,
  price: c.snapshot.cur,
  rsi: c.snapshot.rsi,
  fromH52: c.snapshot.fromH52,
  volRatio: c.snapshot.volRatio,
  mfRatio: c.snapshot.mfRatio,
  ma20GapPct: c.snapshot.ma20GapPct,
  modes: Object.fromEntries(
    Object.entries(c.modeDetails).map(([id, d]) => [
      id,
      {
        name: d.name,
        count: d.count,
        total: d.detail?.length ?? d.total,
        tags: d.tags,
      },
    ])
  ),
}));

const payload = {
  date: today,
  seed: raw.seed,
  candidates,
  stats: raw.universe,
  marketRegime: raw.marketRegime || candidates[0]?.marketRegime || null,
};

async function ghReq(method, endpoint, body) {
  const r = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GitHub ${r.status}: ${txt}`);
  }
  return r.json();
}

// Gist ID 찾기 (description으로 검색)
async function findGistId() {
  let page = 1;
  while (true) {
    const list = await ghReq("GET", `/gists?per_page=100&page=${page}`);
    const found = list.find(g => g.description === "wz-stock app data");
    if (found) return found.id;
    if (list.length < 100) break;
    page++;
  }
  return null;
}

const gistId = await findGistId();
if (!gistId) {
  console.error("Gist를 찾을 수 없어요. 앱에서 GitHub Gist를 먼저 연결해주세요.");
  process.exit(1);
}

await ghReq("PATCH", `/gists/${gistId}`, {
  files: { "wz_screener.json": { content: JSON.stringify(payload) } },
});

const mA = candidates.filter(c => c.modes.A).length;
const mB = candidates.filter(c => c.modes.B).length;
console.log(`✓ Gist 업로드 완료: 총 ${candidates.length}종목 (모드A: ${mA}, 모드B: ${mB})`);
