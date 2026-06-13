"""
MODE_A (추세추종) / MODE_B (역추세반등) 스크리닝 조건
"""
from __future__ import annotations

# ── 버전 정보 ─────────────────────────────────────────────────────
# 조건이나 MIN_PASS 변경 시 반드시 업데이트
SCREENER_VERSION = {
    "A": {
        "ver":      "v3",
        "min_pass": "필수4 + 수급1/2",
        "conditions": ["정배열(필수)", "MA20위(필수)", "MA20상승(필수)", "RSI모멘텀(필수)", "수급유입 또는 강한마감"],
    },
    "B": {
        "ver":      "v1",
        "min_pass": "4/5",
        "conditions": ["RSI과매도", "BB하단근접", "눌림구간", "반등거래량", "MA50근접위"],
    },
}

MIN_PASS_B = 4  # 5개 중 4개 (원본 유지)

# ── MODE_A v3: 필수 추세 4개 + 수급 확인 1개 ──────────────────────
MODE_A_REQUIRED = [
    ("정배열",   lambda r: r["ma20"] > r["ma50"]),
    ("MA20위",  lambda r: r["close"] > r["ma20"]),
    ("MA20상승", lambda r: r["ma20"] > r["ma20_5d"]),
    ("RSI모멘텀", lambda r: 50 <= r["rsi"] <= 70),
]

MODE_A_CONFIRMATION = [
    ("수급유입", lambda r: r["vol_ratio"] >= 1.3),
    # CLV = ((종가-저가)-(고가-종가)) / (고가-저가), App.jsx 동일 공식
    ("강한마감", lambda r: r["mf_ratio"] > 0.2),
]

# ── MODE_B: 역추세반등 — 원본 유지 ──────────────────────────────
MODE_B_CONDITIONS = [
    ("RSI과매도",  lambda r: r["rsi"] <= 35),
    ("BB하단근접", lambda r: r["bb_pos"] < 0.2),
    ("눌림구간",   lambda r: -25 <= r["from_h52"] <= -8),
    ("반등거래량", lambda r: r["vol_ratio"] >= 1.5),
    ("MA50근접위", lambda r: r["close"] >= r["ma50"] * 0.97),
]
# NaN 비교는 Python에서 항상 False → 별도 NaN 가드 불필요


def _eval_mode(row: dict, conditions: list, min_pass: int) -> dict | None:
    results = []
    for label, fn in conditions:
        try:
            passed = bool(fn(row))
        except Exception:
            passed = False
        results.append((label, passed))

    count = sum(1 for _, p in results if p)
    if count < min_pass:
        return None

    return {
        "count": count,
        "total": len(conditions),
        "tags":  [lbl for lbl, p in results if p],
    }


def _eval_mode_a(row: dict) -> dict | None:
    """필수 추세 조건은 전부, 수급 확인 조건은 하나 이상 충족해야 통과."""
    required = []
    confirmations = []

    for label, fn in MODE_A_REQUIRED:
        try:
            passed = bool(fn(row))
        except Exception:
            passed = False
        required.append((label, passed))

    for label, fn in MODE_A_CONFIRMATION:
        try:
            passed = bool(fn(row))
        except Exception:
            passed = False
        confirmations.append((label, passed))

    if not all(passed for _, passed in required):
        return None
    if not any(passed for _, passed in confirmations):
        return None

    results = required + confirmations
    return {
        "count": sum(1 for _, passed in results if passed),
        "total": len(results),
        "tags": [label for label, passed in results if passed],
    }


def screen_snapshot(row: dict) -> tuple[dict | None, dict | None]:
    """
    단일 시점 지표 딕셔너리 → (mode_a_result, mode_b_result).
    통과 시 {count, total, tags}, 미통과 시 None.
    """
    return (
        _eval_mode_a(row),
        _eval_mode(row, MODE_B_CONDITIONS, MIN_PASS_B),
    )
