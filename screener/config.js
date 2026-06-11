// ── Twelve Data API 플랜 설정 ───────────────────────────────
// 플랜 변경 시 creditsPerMinute만 수정하면 딜레이가 자동 재계산됨
export const API_PLAN = {
  name: "free",         // free | basic | grow | pro
  creditsPerMinute: 8,  // free:8  basic:55  grow:800  pro:unlimited(800+)
};

// 호출 간 딜레이 (ms). 10% 안전 마진 포함.
export const CALL_DELAY_MS = Math.ceil((60_000 / API_PLAN.creditsPerMinute) * 1.1);

// ── 스크리너 설정 ────────────────────────────────────────────
export const SCREENER_CONFIG = {
  outputsize: 260,                  // 52주 계산에 1년치 필요
  interval: "1day",
  minPassCount: 4,                  // 5개 조건 중 이 개수 이상 충족해야 통과
  outputDir: "screener/results",
  apiBaseUrl: "https://api.twelvedata.com",
};
