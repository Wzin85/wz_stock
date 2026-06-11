// ── 모드 A / B 조건 정의 ─────────────────────────────────────
// 각 fn(ind)은 indicators.js의 computeIndicators 반환값을 받음

export const MODE_A = {
  id: "A",
  name: "추세추종",
  desc: "강한 상승 추세에 올라타는 종목",
  conditions: [
    {
      id: "ma_aligned",
      label: "정배열",
      desc: "MA20 > MA50",
      fn: ind => ind.ma20 != null && ind.ma50 != null && ind.ma20 > ind.ma50,
    },
    {
      id: "above_ma20",
      label: "MA20위",
      desc: "현재가 > MA20",
      fn: ind => ind.cur > ind.ma20,
    },
    {
      id: "near_52w_high",
      label: "신고가근접",
      desc: "52주 고점 대비 -10% 이내",
      fn: ind => ind.fromH52 >= -10,
    },
    {
      id: "vol_inflow",
      label: "수급유입",
      desc: "거래량 20일 평균 대비 1.3배 이상",
      fn: ind => ind.volRatio >= 1.3,
    },
    {
      id: "rsi_momentum",
      label: "RSI모멘텀",
      desc: "RSI 50~70 (상승 모멘텀, 과열 전)",
      fn: ind => ind.rsi >= 50 && ind.rsi <= 70,
    },
  ],
};

export const MODE_B = {
  id: "B",
  name: "역추세반등",
  desc: "과매도 후 반등 노리는 눌림목 종목",
  conditions: [
    {
      id: "rsi_oversold",
      label: "RSI과매도",
      desc: "RSI(14) 35 이하",
      fn: ind => ind.rsi <= 35,
    },
    {
      id: "bb_lower",
      label: "BB하단근접",
      desc: "볼린저밴드 하단 근접/이탈 (bbPos < 0.2)",
      fn: ind => ind.bbPos < 0.2,
    },
    {
      id: "pullback_zone",
      label: "눌림구간",
      desc: "52주 고점 대비 -25% ~ -8% (추락 종목 제외)",
      fn: ind => ind.fromH52 >= -25 && ind.fromH52 <= -8,
    },
    {
      id: "vol_spike",
      label: "반등거래량",
      desc: "거래량 20일 평균 대비 1.5배 이상",
      fn: ind => ind.volRatio >= 1.5,
    },
    {
      id: "above_ma50",
      label: "MA50근접위",
      desc: "현재가 >= MA50의 97% (중기 추세 유효)",
      fn: ind => ind.ma50 != null && ind.cur >= ind.ma50 * 0.97,
    },
  ],
};

export const MODES = [MODE_A, MODE_B];

// 모드 평가: 조건 충족 개수가 minPass 이상이면 통과
export function evalMode(ind, mode, minPass) {
  const results = mode.conditions.map(c => ({ id: c.id, label: c.label, passed: c.fn(ind) }));
  const passCount = results.filter(r => r.passed).length;
  if (passCount < minPass) return null;
  return {
    passed: true,
    count: passCount,
    total: mode.conditions.length,
    tags: results.filter(r => r.passed).map(r => r.label),
    detail: results,
  };
}
