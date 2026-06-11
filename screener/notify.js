// GitHub Actions에서 실행: 스크리너 결과를 Slack으로 알림
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webhookUrl = process.env.SLACK_WEBHOOK;
const jobStatus  = process.env.JOB_STATUS || "success";

if (!webhookUrl) { console.log("SLACK_WEBHOOK 없음 - 알림 스킵"); process.exit(0); }

// ── 실패 알림 ────────────────────────────────────────────────
if (jobStatus === "failure") {
  await send({ text: ":x: *WZ Stock Screener 실패*\nGitHub Actions 로그를 확인해주세요." });
  process.exit(0);
}

// ── 결과 읽기 ────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const resultsPath = path.join(__dirname, "results", `${today}.json`);

let raw;
try { raw = JSON.parse(readFileSync(resultsPath, "utf-8")); }
catch {
  await send({ text: `:warning: *WZ Stock Screener* (${today})\n결과 파일을 찾을 수 없어요.` });
  process.exit(0);
}

const candidates = raw.candidates || [];
const modeA = candidates.filter(c => c.modes.includes("A"));
const modeB = candidates.filter(c => c.modes.includes("B"));

// ── 메시지 구성 ──────────────────────────────────────────────
const lines = [];
lines.push(`*📊 WZ Stock Screener · ${today}*`);

if (candidates.length === 0) {
  lines.push("오늘 조건을 충족한 종목이 없어요.");
} else {
  lines.push(`총 *${candidates.length}종목* 발굴  (유니버스 ${raw.universe?.total ?? "?"}종목 중)`);
  lines.push("");

  if (modeA.length > 0) {
    lines.push(`:large_green_circle: *모드A 추세추종 (${modeA.length}종목)*`);
    for (const c of modeA) {
      const d = c.modeDetails?.A;
      const src = c.source === "fixed" ? "📌" : "";
      lines.push(`  • ${src}*${c.ticker}*  ${d?.count}/${d?.total}  _${d?.tags?.join(", ")}_`);
    }
    lines.push("");
  }

  if (modeB.length > 0) {
    lines.push(`:large_yellow_circle: *모드B 역추세반등 (${modeB.length}종목)*`);
    for (const c of modeB) {
      const d = c.modeDetails?.B;
      const src = c.source === "fixed" ? "📌" : "";
      lines.push(`  • ${src}*${c.ticker}*  ${d?.count}/${d?.total}  _${d?.tags?.join(", ")}_`);
    }
  }
}

await send({ text: lines.join("\n") });

// ── 전송 ─────────────────────────────────────────────────────
async function send(body) {
  const r = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.ok) {
    console.log("Slack 알림 전송 완료");
  } else {
    console.error(`Slack 전송 실패: ${r.status} ${await r.text()}`);
  }
}
