"""
Analyze recorded entry factors without changing the trading strategy.

Examples:
  py -3 backtest/analyze_factors.py --mode A ^
    backtest/results/trades_20260613_0201.csv ^
    backtest/results/trades_20260613_0202.csv ^
    backtest/results/trades_20260613_0204.csv

The report shows both:
  - executions: every trade from every random-seed iteration
  - unique signals: one row per period/ticker/mode/signal date

Unique-signal statistics reduce the weight of the same setup appearing in
multiple random samples. This is exploratory analysis, not proof of causality.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


FACTOR_BINS_A = {
    "signal_rsi": (
        [-np.inf, 50, 55, 60, 65, 70, np.inf],
        ["<50", "50-55", "55-60", "60-65", "65-70", ">70"],
    ),
    "signal_vol_ratio": (
        [-np.inf, 1.0, 1.3, 1.5, 2.0, np.inf],
        ["<1.0", "1.0-1.3", "1.3-1.5", "1.5-2.0", ">=2.0"],
    ),
    "signal_mf_ratio": (
        [-np.inf, 0.0, 0.2, 0.4, 0.6, np.inf],
        ["<=0", "0-0.2", "0.2-0.4", "0.4-0.6", ">=0.6"],
    ),
    "signal_bb_pos": (
        [-np.inf, 0.5, 0.8, 1.0, np.inf],
        ["<0.5", "0.5-0.8", "0.8-1.0", ">=1.0"],
    ),
    "signal_from_h52": (
        [-np.inf, -20, -10, -5, 0, np.inf],
        ["<-20%", "-20~-10%", "-10~-5%", "-5~0%", ">0%"],
    ),
    "signal_atr_pct": (
        [-np.inf, 1.5, 2.5, 3.5, 5.0, np.inf],
        ["<1.5%", "1.5-2.5%", "2.5-3.5%", "3.5-5.0%", ">=5.0%"],
    ),
    "signal_ma20_gap_pct": (
        [-np.inf, 1.0, 3.0, 5.0, 8.0, np.inf],
        ["<1%", "1-3%", "3-5%", "5-8%", ">=8%"],
    ),
    "signal_ma20_slope_5d_pct": (
        [-np.inf, 0.5, 1.0, 2.0, 3.0, np.inf],
        ["<0.5%", "0.5-1%", "1-2%", "2-3%", ">=3%"],
    ),
    "signal_spy_ma200_gap_pct": (
        [-np.inf, 0.0, 2.0, 5.0, 10.0, np.inf],
        ["<0%", "0-2%", "2-5%", "5-10%", ">=10%"],
    ),
}

FACTOR_BINS_B = {
    "signal_rs_1m": (
        [-np.inf, -20, -10, -5, 0, 5, 10, 20, np.inf],
        ["<-20%", "-20~-10%", "-10~-5%", "-5~0%", "0~5%", "5~10%", "10~20%", ">=20%"],
    ),
    "signal_rs_3m": (
        [-np.inf, -30, -15, -5, 0, 10, 20, 40, np.inf],
        ["<-30%", "-30~-15%", "-15~-5%", "-5~0%", "0~10%", "10~20%", "20~40%", ">=40%"],
    ),
    "signal_rsi": (
        [-np.inf, 25, 30, 35, 40, 45, 50, np.inf],
        ["<25", "25-30", "30-35", "35-40", "40-45", "45-50", ">=50"],
    ),
    "signal_vol_ratio": (
        [-np.inf, 1.0, 1.3, 1.5, 2.0, 3.0, np.inf],
        ["<1.0", "1.0-1.3", "1.3-1.5", "1.5-2.0", "2.0-3.0", ">=3.0"],
    ),
    "signal_mf_ratio": (
        [-np.inf, -0.4, -0.2, 0.0, 0.2, 0.4, np.inf],
        ["<-0.4", "-0.4~-0.2", "-0.2~0", "0~0.2", "0.2~0.4", ">=0.4"],
    ),
    "signal_bb_pos": (
        [-np.inf, -0.2, 0.0, 0.1, 0.2, 0.3, 0.5, np.inf],
        ["<-0.2", "-0.2~0", "0~0.1", "0.1~0.2", "0.2~0.3", "0.3~0.5", ">=0.5"],
    ),
    "signal_from_h52": (
        [-np.inf, -30, -25, -20, -15, -10, -8, 0, np.inf],
        ["<-30%", "-30~-25%", "-25~-20%", "-20~-15%", "-15~-10%", "-10~-8%", "-8~0%", ">0%"],
    ),
    "signal_atr_pct": (
        [-np.inf, 1.5, 2.5, 3.5, 5.0, 7.0, np.inf],
        ["<1.5%", "1.5-2.5%", "2.5-3.5%", "3.5-5.0%", "5.0-7.0%", ">=7.0%"],
    ),
    "signal_ma20_gap_pct": (
        [-np.inf, -10, -5, -3, -1, 0, 3, np.inf],
        ["<-10%", "-10~-5%", "-5~-3%", "-3~-1%", "-1~0%", "0~3%", ">=3%"],
    ),
    "signal_ma20_slope_5d_pct": (
        [-np.inf, -3, -2, -1, 0, 1, 2, np.inf],
        ["<-3%", "-3~-2%", "-2~-1%", "-1~0%", "0~1%", "1~2%", ">=2%"],
    ),
    "signal_spy_ma200_gap_pct": (
        [-np.inf, -10, -5, 0, 2, 5, 10, np.inf],
        ["<-10%", "-10~-5%", "-5~0%", "0~2%", "2~5%", "5~10%", ">=10%"],
    ),
}

FACTOR_NAMES = {
    "signal_rs_1m": "SPY 대비 1개월 상대강도",
    "signal_rs_3m": "SPY 대비 3개월 상대강도",
    "signal_rsi": "RSI",
    "signal_vol_ratio": "거래량 비율",
    "signal_mf_ratio": "10일 거래량가중 CLV",
    "signal_bb_pos": "볼린저밴드 위치",
    "signal_from_h52": "52주 고점 대비 위치",
    "signal_atr_pct": "ATR 변동성",
    "signal_ma20_gap_pct": "종가의 MA20 이격률",
    "signal_ma20_slope_5d_pct": "MA20의 5일 상승률",
    "signal_spy_ma200_gap_pct": "SPY의 MA200 이격률",
}


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WZ backtest entry-factor analysis")
    parser.add_argument("files", nargs="+", help="Instrumented trades CSV files")
    parser.add_argument("--mode", choices=["A", "B"], default="A")
    parser.add_argument(
        "--output",
        default=None,
        help="Optional report path (default: backtest/results/factor_analysis_MODE.txt)",
    )
    return parser.parse_args()


def _load(files: list[str], mode: str, factor_bins: dict) -> pd.DataFrame:
    frames = []
    for file_name in files:
        path = Path(file_name)
        frame = pd.read_csv(path)
        required = {"ticker", "mode", "signal_date", "pnl_pct", *factor_bins.keys()}
        missing = required.difference(frame.columns)
        if missing:
            raise ValueError(f"{path.name}: missing columns: {sorted(missing)}")
        signal_dates = pd.to_datetime(frame["signal_date"], errors="coerce")
        frame["period"] = (
            f"{signal_dates.dt.year.min():.0f}~{signal_dates.dt.year.max():.0f}"
        )
        frames.append(frame)

    data = pd.concat(frames, ignore_index=True)
    data = data[data["mode"] == mode].copy()
    data["signal_date"] = pd.to_datetime(data["signal_date"])
    for factor in factor_bins:
        data[factor] = pd.to_numeric(data[factor], errors="coerce")
    data["pnl_pct"] = pd.to_numeric(data["pnl_pct"], errors="coerce")
    return data.dropna(subset=["pnl_pct"])


def _stats(group: pd.DataFrame) -> dict:
    pnl = group["pnl_pct"]
    return {
        "count": len(group),
        "win_rate": (pnl > 0).mean() * 100,
        "avg_pnl": pnl.mean(),
        "median_pnl": pnl.median(),
        "stop_rate": group["exit_reason"].isin(["stop", "stop_gap"]).mean() * 100,
    }


def _format_stats(label: str, frame: pd.DataFrame) -> str:
    stat = _stats(frame)
    return (
        f"{label:<16} n={stat['count']:>5}  win={stat['win_rate']:>5.1f}%  "
        f"avg={stat['avg_pnl']:>+6.2f}%  med={stat['median_pnl']:>+6.2f}%  "
        f"stop={stat['stop_rate']:>5.1f}%"
    )


def _factor_table(data: pd.DataFrame, factor: str, factor_bins: dict) -> pd.DataFrame:
    bins, labels = factor_bins[factor]
    work = data.dropna(subset=[factor]).copy()
    work["bucket"] = pd.cut(
        work[factor],
        bins=bins,
        labels=labels,
        right=False,
        include_lowest=True,
    )
    rows = []
    for bucket, group in work.groupby("bucket", observed=True):
        total = _stats(group)
        row = {"bucket": str(bucket), **total}
        for period, period_group in group.groupby("period"):
            pstat = _stats(period_group)
            row[f"{period}_n"] = pstat["count"]
            row[f"{period}_avg"] = pstat["avg_pnl"]
            row[f"{period}_win"] = pstat["win_rate"]
        rows.append(row)
    return pd.DataFrame(rows)


def _render_table(table: pd.DataFrame, periods: list[str]) -> list[str]:
    lines = []
    header = (
        f"{'구간':<13} {'건수':>5} {'승률':>7} {'평균':>8} {'중앙값':>8} {'손절률':>7}"
        + "".join(f"  {period:>9} 평균/승률/건수" for period in periods)
    )
    lines.append(header)
    lines.append("-" * len(header))
    for _, row in table.iterrows():
        line = (
            f"{row['bucket']:<13} {int(row['count']):>5} "
            f"{row['win_rate']:>6.1f}% {row['avg_pnl']:>+7.2f}% "
            f"{row['median_pnl']:>+7.2f}% {row['stop_rate']:>6.1f}%"
        )
        for period in periods:
            raw_n = row.get(f"{period}_n", 0)
            n = 0 if pd.isna(raw_n) else int(raw_n)
            avg = row.get(f"{period}_avg", np.nan)
            win = row.get(f"{period}_win", np.nan)
            if n:
                line += f"  {avg:>+5.2f}/{win:>4.1f}/{n:<4}"
            else:
                line += "       n/a      "
        lines.append(line)
    return lines


def _candidate_score(table: pd.DataFrame, periods: list[str]) -> pd.DataFrame:
    """Rank robust-looking buckets; this is a research shortlist, not a rule."""
    rows = []
    for _, row in table.iterrows():
        period_avgs = []
        for period in periods:
            avg = row.get(f"{period}_avg")
            raw_n = row.get(f"{period}_n", 0)
            n = 0 if pd.isna(raw_n) else int(raw_n)
            if pd.notna(avg) and n >= 30:
                period_avgs.append(float(avg))
        positive_periods = sum(avg > 0 for avg in period_avgs)
        rows.append({
            "bucket": row["bucket"],
            "count": int(row["count"]),
            "avg_pnl": float(row["avg_pnl"]),
            "win_rate": float(row["win_rate"]),
            "positive_periods": positive_periods,
            "covered_periods": len(period_avgs),
            "worst_period_avg": min(period_avgs) if period_avgs else np.nan,
        })
    return pd.DataFrame(rows)


def main() -> None:
    args = _args()
    factor_bins = FACTOR_BINS_A if args.mode == "A" else FACTOR_BINS_B
    data = _load(args.files, args.mode, factor_bins)
    periods = list(dict.fromkeys(data["period"].tolist()))
    unique = data.drop_duplicates(["period", "ticker", "mode", "signal_date"]).copy()

    lines = [
        f"WZ 진입 팩터 분석 - MODE {args.mode}",
        "=" * 78,
        "목적",
        "  매수 규칙을 바로 변경하기 전에, 진입 당시 어떤 지표 구간이 실제 손익과",
        "  관계가 있었는지 탐색합니다. 이 표는 인과관계의 증명이 아니라 다음",
        "  단일 변경 백테스트에 넣을 후보를 고르는 자료입니다.",
        "",
        "표 읽는 법",
        "  건수   : 해당 지표 구간에 속한 거래 수입니다.",
        "  승률   : 수익으로 끝난 거래의 비율입니다.",
        "  평균   : 거래당 평균 수익률입니다. 양수일수록 유리했습니다.",
        "  중앙값 : 모든 수익률을 순서대로 놓았을 때 가운데 값입니다.",
        "           일부 대박 거래가 평균을 끌어올렸는지 확인하는 데 사용합니다.",
        "  손절률 : stop 또는 stop_gap으로 끝난 거래의 비율입니다.",
        "  기간별 평균/승률/건수: 여러 독립 기간에서 같은 구간이 반복해서",
        "           작동했는지 확인합니다.",
        "",
        "집계 방식",
        "  전체 체결: 20개 seed의 모든 거래를 합친 결과입니다.",
        "  고유 신호: 같은 기간·종목·신호일이 여러 seed에 반복된 경우 한 번만",
        "           남긴 결과입니다. 특정 신호의 중복 영향을 줄이기 위한 값입니다.",
        "",
        _format_stats("전체 체결", data),
        _format_stats("고유 신호", unique),
        "",
        "기간별 Mode 기준 성과 (전체 체결)",
    ]
    for period, group in data.groupby("period", sort=False):
        lines.append(_format_stats(period, group))

    candidates = []
    for factor in factor_bins:
        factor_name = FACTOR_NAMES.get(factor, factor)
        lines.extend([
            "",
            f"[{factor_name}]  ({factor})",
            "아래 표는 진입 시점의 지표 값을 구간으로 나눠 이후 거래 성과를 비교합니다.",
            "전체 체결",
        ])
        execution_table = _factor_table(data, factor, factor_bins)
        lines.extend(_render_table(execution_table, periods))

        lines.extend(["", "고유 신호"])
        unique_table = _factor_table(unique, factor, factor_bins)
        lines.extend(_render_table(unique_table, periods))

        ranked = _candidate_score(unique_table, periods)
        ranked["factor"] = factor
        candidates.append(ranked)

    shortlist = pd.concat(candidates, ignore_index=True)
    shortlist = shortlist[
        (shortlist["count"] >= 100)
        & (shortlist["covered_periods"] == len(periods))
        & (shortlist["positive_periods"] == len(periods))
        & (shortlist["worst_period_avg"] > 0)
    ].sort_values(["worst_period_avg", "avg_pnl"], ascending=False)

    lines.extend([
        "",
        "기간 공통 후보 구간 (고유 신호 기준)",
        "선정 기준: 전체 100건 이상, 각 기간 30건 이상이며 모든 기간의 평균수익이",
        "모두 양수인 구간입니다. 좋은 조건으로 확정한 것이 아니라, 같은 seed와",
        "기간으로 한 가지씩 검증할 후보 목록입니다.",
        "-" * 78,
    ])
    if shortlist.empty:
        lines.append("모든 기준을 통과한 후보 구간이 없습니다.")
    else:
        for _, row in shortlist.iterrows():
            lines.append(
                f"{FACTOR_NAMES.get(row['factor'], row['factor']):<24} "
                f"{row['bucket']:<13} 건수={int(row['count']):>4} "
                f"평균={row['avg_pnl']:+.2f}% 승률={row['win_rate']:.1f}% "
                f"최약기간 평균={row['worst_period_avg']:+.2f}%"
            )

    lines.extend([
        "",
        "해석 시 주의",
        "  1. 평균수익이 양수여도 중앙값이 음수라면 소수의 큰 수익 거래가 평균을",
        "     끌어올렸을 수 있습니다.",
        "  2. 서로 연관된 지표가 많아 각 행을 독립적인 원인으로 보면 안 됩니다.",
        "  3. 후보 조건은 반드시 기존과 동일한 기간·seed로 다시 백테스트하여",
        "     누적수익, MDD, 거래 수, 기간별 안정성을 함께 비교해야 합니다.",
    ])

    report = "\n".join(lines) + "\n"
    output = (
        Path(args.output)
        if args.output
        else Path(__file__).parent / "results" / f"factor_analysis_mode_{args.mode}.txt"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report, encoding="utf-8")
    print(report)
    print(f"Saved: {output}")


if __name__ == "__main__":
    main()
