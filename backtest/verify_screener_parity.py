"""Python/JavaScript 스크리너 판정 일치 검증.

동일한 Twelve Data 형식 OHLCV를 Python과 브라우저/서버 공통 JavaScript
모듈에 넣고 지표, Mode A/B 판정, SPY MA200 필터가 일치하는지 확인한다.
실데이터 JSON 디렉터리를 지정하지 않으면 seed 기반 합성 OHLCV를 사용한다.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JS_EVALUATOR = ROOT / "screener" / "evaluateSnapshot.js"


def avg(values):
    return sum(values) / len(values)


def calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return 50.0
    gains = losses = 0.0
    for i in range(1, period + 1):
        change = closes[i] - closes[i - 1]
        if change >= 0:
            gains += change
        else:
            losses -= change
    avg_gain = gains / period
    avg_loss = losses / period
    for i in range(period + 1, len(closes)):
        change = closes[i] - closes[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(change, 0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-change, 0)) / period
    return 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)


def compute_snapshot(values):
    data = list(reversed(values))
    closes = [float(row["close"]) for row in data]
    highs = [float(row["high"]) for row in data]
    lows = [float(row["low"]) for row in data]
    volumes = [float(row["volume"]) for row in data]
    n = len(closes)
    if n < 55:
        raise ValueError("데이터 부족 (최소 55거래일)")

    close = closes[-1]
    ma20 = avg(closes[-20:])
    ma20_5d = avg(closes[-25:-5])
    ma50 = avg(closes[-50:])
    bb_window = closes[-20:]
    bb_mean = avg(bb_window)
    bb_std = math.sqrt(avg([(value - bb_mean) ** 2 for value in bb_window]))
    bb_upper, bb_lower = bb_mean + 2 * bb_std, bb_mean - 2 * bb_std
    bb_pos = (close - bb_lower) / (bb_upper - bb_lower) if bb_upper > bb_lower else 0.5
    avg_volume20 = avg(volumes[-20:])

    tr_sum = 0.0
    for i in range(n - 14, n):
        tr_sum += max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
    atr = tr_sum / 14

    lookback = min(252, n)
    high52, low52 = max(highs[-lookback:]), min(lows[-lookback:])
    range52 = high52 - low52

    weighted_clv = total_volume = 0.0
    for i in range(max(0, n - 10), n):
        day_range = highs[i] - lows[i]
        clv = 0.0 if day_range == 0 else ((closes[i] - lows[i]) - (highs[i] - closes[i])) / day_range
        weighted_clv += clv * volumes[i]
        total_volume += volumes[i]

    return {
        "close": close,
        "rsi": calc_rsi(closes),
        "ma20": ma20,
        "ma20_5d": ma20_5d,
        "ma50": ma50,
        "ma200": avg(closes[-200:]) if n >= 200 else None,
        "bb_pos": bb_pos,
        "vol_ratio": volumes[-1] / avg_volume20 if avg_volume20 > 0 else 1,
        "pos52w": (close - low52) / range52 if range52 > 0 else 0.5,
        "from_h52": (close / high52 - 1) * 100 if high52 > 0 else 0,
        "mf_ratio": weighted_clv / total_volume if total_volume > 0 else 0,
        "atr": atr,
        "atr_pct": atr / close * 100 if close > 0 else 0,
        "ma20_gap_pct": (close / ma20 - 1) * 100 if ma20 > 0 else math.nan,
        "data_date": data[-1].get("datetime"),
    }


def evaluate_modes(row, allow_mode_a=True):
    required_a = [
        ("ma_aligned", row["ma20"] > row["ma50"]),
        ("above_ma20", row["close"] > row["ma20"]),
        ("ma20_rising", row["ma20"] > row["ma20_5d"]),
        ("rsi_momentum", 50 <= row["rsi"] <= 70),
    ]
    confirmation_a = [
        ("vol_inflow", row["vol_ratio"] >= 1.3),
        ("strong_close", row["mf_ratio"] > 0.2),
    ]
    mode_b = [
        ("rsi_oversold", row["rsi"] <= 35),
        ("bb_lower", row["bb_pos"] < 0.2),
        ("pullback_zone", -25 <= row["from_h52"] <= -8),
        ("vol_spike", row["vol_ratio"] >= 1.5),
        ("above_ma50", row["close"] >= row["ma50"] * 0.97),
    ]
    modes = []
    if allow_mode_a and all(value for _, value in required_a) and any(value for _, value in confirmation_a):
        modes.append("A")
    if sum(value for _, value in mode_b) >= 4:
        modes.append("B")
    return modes


def generate_values(seed, profile, count=260):
    rng = random.Random(seed)
    price = 70 + profile * 8
    rows = []
    for day in range(count):
        drift = 0.0005 + profile * 0.00012
        shock = rng.gauss(0, 0.012 + profile * 0.001)
        open_price = price * (1 + rng.gauss(0, 0.003))
        close = max(2, price * (1 + drift + shock))
        spread = abs(rng.gauss(0.012, 0.004))
        high = max(open_price, close) * (1 + spread)
        low = min(open_price, close) * (1 - spread)
        volume = int((1_000_000 + profile * 120_000) * (0.7 + rng.random() * 0.7))
        if day == count - 1 and profile % 3 == 0:
            volume = int(volume * 1.8)
            close = high * 0.97
        rows.append({
            "datetime": f"day-{day:03d}",
            "open": f"{open_price:.8f}",
            "high": f"{high:.8f}",
            "low": f"{low:.8f}",
            "close": f"{close:.8f}",
            "volume": str(volume),
        })
        price = close
    return list(reversed(rows))


def load_samples(cache_dir, seed, sample):
    if cache_dir:
        directory = Path(cache_dir)
        files = sorted(path for path in directory.glob("*.json") if path.stem.upper() != "SPY")
        spy_file = directory / "SPY.json"
        if files and spy_file.exists():
            rng = random.Random(seed)
            chosen = rng.sample(files, min(sample, len(files)))
            spy_values = json.loads(spy_file.read_text(encoding="utf-8"))
            return [(path.stem, json.loads(path.read_text(encoding="utf-8"))) for path in chosen], spy_values

    samples = [(f"SYN{index + 1}", generate_values(seed + index * 997, index)) for index in range(sample)]
    spy_values = generate_values(seed + 999_983, 1)
    return samples, spy_values


def run_js(values, spy_values):
    completed = subprocess.run(
        ["node", str(JS_EVALUATOR)],
        input=json.dumps({"values": values, "spyValues": spy_values}),
        text=True,
        encoding="utf-8",
        capture_output=True,
        cwd=ROOT,
        check=True,
    )
    return json.loads(completed.stdout)


def main():
    parser = argparse.ArgumentParser(description="Python/JS 스크리너 판정 일치 검증")
    parser.add_argument("--cache-dir", help="Twelve Data 형식 TICKER.json과 SPY.json이 있는 폴더")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--sample", type=int, default=12)
    args = parser.parse_args()

    samples, spy_values = load_samples(args.cache_dir, args.seed, args.sample)
    spy = compute_snapshot(spy_values)
    allow_mode_a = spy["ma200"] is not None and spy["close"] >= spy["ma200"]
    numeric_fields = [
        "close", "rsi", "ma20", "ma20_5d", "ma50", "ma200", "bb_pos",
        "vol_ratio", "pos52w", "from_h52", "mf_ratio", "atr", "atr_pct", "ma20_gap_pct",
    ]
    failures = []

    for ticker, values in samples:
        py_snapshot = compute_snapshot(values)
        py_modes = evaluate_modes(py_snapshot, allow_mode_a)
        js = run_js(values, spy_values)
        js_modes = sorted((js["modes"] or {}).keys())
        for field in numeric_fields:
            py_value, js_value = py_snapshot[field], js["snapshot"][field]
            if py_value is None and js_value is None:
                continue
            if not math.isclose(py_value, js_value, rel_tol=1e-10, abs_tol=1e-10):
                failures.append(f"{ticker} {field}: Python={py_value} JS={js_value}")
        if sorted(py_modes) != js_modes:
            failures.append(f"{ticker} modes: Python={py_modes} JS={js_modes}")
        if allow_mode_a != js["marketRegime"]["allowModeA"]:
            failures.append(f"{ticker} SPY regime mismatch")

    source = args.cache_dir if args.cache_dir else "seed 기반 합성 OHLCV"
    print(f"검증 데이터: {source}")
    print(f"seed={args.seed}, 표본={len(samples)}, SPY Mode A 허용={allow_mode_a}")
    if failures:
        print(f"불일치 {len(failures)}건")
        for failure in failures[:20]:
            print(f"  - {failure}")
        raise SystemExit(1)
    print("결과: Python/JavaScript 지표 및 Mode A/B 판정 일치")


if __name__ == "__main__":
    main()
