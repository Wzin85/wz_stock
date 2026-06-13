"""Run close-based trailing-stop sensitivity tests with one data load."""
from __future__ import annotations

import argparse
import random
from pathlib import Path

import numpy as np
import pandas as pd

from data import build_indicator_cache, download_and_cache, load_sp500_tickers
from engine import INITIAL_CASH, run_backtest


VARIANTS = [
    ("base", False, 1.0, 2.0),
    ("activate_0.75", True, 0.75, 2.0),
    ("adopted_1.0_2.0", True, 1.0, 2.0),
    ("activate_1.25", True, 1.25, 2.0),
    ("distance_1.5", True, 1.0, 1.5),
    ("distance_2.5", True, 1.0, 2.5),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Trailing-stop sensitivity test")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--seeds", required=True)
    parser.add_argument("--universe-size", type=int, default=150)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def metrics(trades: list[dict], equity: pd.Series) -> dict:
    if equity.empty:
        return {}
    pnls = np.array([float(t["pnl_pct"]) for t in trades])
    wins = pnls[pnls > 0]
    losses = pnls[pnls < 0]
    avg_win = float(wins.mean()) if len(wins) else 0.0
    avg_loss = float(losses.mean()) if len(losses) else 0.0
    peak = equity.cummax()
    mdd = float(((equity / peak) - 1).min() * 100)
    return {
        "return": float((equity.iloc[-1] / INITIAL_CASH - 1) * 100),
        "mdd": mdd,
        "win_rate": float((pnls > 0).mean() * 100) if len(pnls) else 0.0,
        "pnl_ratio": abs(avg_win / avg_loss) if avg_loss else 0.0,
        "trades": len(trades),
        "timeout": sum(t["exit_reason"] == "timeout" for t in trades),
    }


def main() -> None:
    args = parse_args()
    seeds = [int(value) for value in args.seeds.split(",") if value.strip()]
    sp500 = load_sp500_tickers()
    raw = download_and_cache(
        list(dict.fromkeys(["SPY", "^VIX"] + sp500)),
        start_date=args.start,
        end_date=args.end,
    )
    indicators = build_indicator_cache(raw)
    valid = [ticker for ticker in sp500 if ticker in indicators]
    size = min(args.universe_size, len(valid))
    samples = {
        seed: random.Random(seed).sample(valid, size)
        for seed in seeds
    }

    rows: list[dict] = []
    per_seed: dict[str, list[float]] = {}
    for name, enabled, activate, distance in VARIANTS:
        run_metrics = []
        for seed in seeds:
            trades, equity = run_backtest(
                samples[seed],
                indicators,
                args.start,
                args.end,
                selection="ma20-gap",
                trailing_stop=enabled,
                trailing_activate_atr=activate,
                trailing_distance_atr=distance,
            )
            run_metrics.append(metrics(trades, equity))
        per_seed[name] = [item["return"] for item in run_metrics]
        rows.append({
            "name": name,
            "activate": activate if enabled else None,
            "distance": distance if enabled else None,
            "return": float(np.mean([m["return"] for m in run_metrics])),
            "return_sd": float(np.std([m["return"] for m in run_metrics])),
            "mdd": float(np.mean([m["mdd"] for m in run_metrics])),
            "win_rate": float(np.mean([m["win_rate"] for m in run_metrics])),
            "pnl_ratio": float(np.mean([m["pnl_ratio"] for m in run_metrics])),
            "trades": float(np.mean([m["trades"] for m in run_metrics])),
            "timeout_pct": (
                100
                * sum(m["timeout"] for m in run_metrics)
                / sum(m["trades"] for m in run_metrics)
            ),
        })

    base_returns = per_seed["base"]
    for row in rows:
        returns = per_seed[row["name"]]
        deltas = [value - base for value, base in zip(returns, base_returns)]
        row["seed_wins"] = sum(delta > 0.05 for delta in deltas)
        row["seed_losses"] = sum(delta < -0.05 for delta in deltas)
        row["median_delta"] = float(np.median(deltas))

    lines = [
        f"Trailing sensitivity: {args.start} ~ {args.end}",
        "=" * 94,
        (
            "variant             return    sd      MDD    win    ratio  "
            "trades timeout  seed W/L  median Δ"
        ),
    ]
    for row in rows:
        lines.append(
            f"{row['name']:<19} {row['return']:+7.2f}% {row['return_sd']:6.2f} "
            f"{row['mdd']:7.2f}% {row['win_rate']:6.2f}% "
            f"{row['pnl_ratio']:6.2f} {row['trades']:7.1f} "
            f"{row['timeout_pct']:6.2f}% "
            f"{row['seed_wins']:2d}/{row['seed_losses']:<2d} "
            f"{row['median_delta']:+8.2f}%p"
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\nSaved: {args.output}")


if __name__ == "__main__":
    main()
