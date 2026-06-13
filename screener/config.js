// ── Twelve Data API 플랜 설정 ───────────────────────────────
// 플랜 변경 시 이 블록만 수정하면 딜레이·배치 크기가 자동 반영됨
export const API_PLAN = {
  name: "free",
  creditsPerMinute: 8,    // free:8  basic:55  grow:800
  creditsPerDay: 800,     // free:800  basic:800  grow:∞
  batchSize: 8,           // 배치당 종목 수 (= 분당 크레딧 한도와 동일)
  intraBatchDelayMs: 400, // 배치 내 호출 간 간격 (너무 빠른 연속 호출 방지)
  batchCooldownMs: 63_000,// 배치 사이 대기 ms (60s + 3s 여유)
};

// ── 스크리너 설정 ────────────────────────────────────────────
export const SCREENER_CONFIG = {
  outputsize: 260,          // 52주 계산에 1년치 필요
  interval: "1day",
  universeMaxSize: 150,     // 하루 800 크레딧 여유분 고려한 최대 스캔 수
  apiBaseUrl: "https://api.twelvedata.com",
  retryMaxAttempts: 3,      // 429 발생 시 최대 재시도 횟수
  retryWaitMs: 63_000,      // 429 발생 시 대기 ms
};
