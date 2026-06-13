"""
기존 v5 Mode B 거래의 조건 조합과 반등 확인 캔들을 분석한다.

전략을 다시 실행하거나 변경하지 않는다. 거래 CSV의 신호일과 로컬 캐시를
결합하여 다음 질문에 답한다.

1. Mode B 5개 조건 중 어떤 4/5 또는 5/5 조합으로 통과했는가?
2. 각 조건을 충족한 거래와 충족하지 않은 거래의 성과 차이는 무엇인가?
3. 신호일에 반등 확인 캔들이 있었던 거래가 더 나았는가?
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


CACHE_DIR = Path(__file__).parent / "cache"
RESULTS_DIR = Path(__file__).parent / "results"

CONDITIONS = [
    ("cond_rsi", "RSI과매도"),
    ("cond_bb", "BB하단근접"),
    ("cond_pullback", "눌림구간"),
    ("cond_volume", "반등거래량"),
    ("cond_ma50", "MA50근접위"),
]

REBOUND_SIGNALS = [
    ("rebound_up_close", "전일 종가 돌파"),
    ("rebound_prev_high", "전일 고가 돌파"),
    ("rebound_higher_low_green", "저점 상승 + 양봉"),
    ("rebound_up_clv", "전일 종가 돌파 + CLV>0.2"),
]


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mode B 조건 조합·반등 캔들 분석")
    parser.add_argument("files", nargs="+", help="기준 v5 trades CSV 파일")
    parser.add_argument(
        "--output",
        default=str(RESULTS_DIR / "mode_B_condition_and_rebound_analysis.txt"),
        help="분석 보고서 경로",
    )
    return parser.parse_args()


def _stats(group: pd.DataFrame) -> dict:
    pnl = group["pnl_pct"]
    return {
        "count": len(group),
        "win_rate": float((pnl > 0).mean() * 100) if len(group) else np.nan,
        "avg_pnl": float(pnl.mean()) if len(group) else np.nan,
        "median_pnl": float(pnl.median()) if len(group) else np.nan,
        "stop_rate": float(
            group["exit_reason"].isin(["stop", "stop_gap"]).mean() * 100
        ) if len(group) else np.nan,
        "timeout_rate": float(
            (group["exit_reason"] == "timeout").mean() * 100
        ) if len(group) else np.nan,
        "avg_days": float(group["days_held"].mean()) if len(group) else np.nan,
    }


def _stat_line(label: str, group: pd.DataFrame) -> str:
    stat = _stats(group)
    if stat["count"] == 0:
        return f"{label:<28} n={0:>5}  표본 없음"
    return (
        f"{label:<28} n={stat['count']:>5}  승률={stat['win_rate']:>5.1f}%  "
        f"평균={stat['avg_pnl']:>+6.2f}%  중앙값={stat['median_pnl']:>+6.2f}%  "
        f"손절={stat['stop_rate']:>5.1f}%  timeout={stat['timeout_rate']:>5.1f}%  "
        f"보유={stat['avg_days']:>4.1f}일"
    )


def _load_cache(
    ticker: str,
    indicator_cache: dict[str, pd.DataFrame | None],
    raw_cache: dict[str, pd.DataFrame | None],
) -> tuple[pd.DataFrame | None, pd.DataFrame | None]:
    if ticker not in indicator_cache:
        ind_path = CACHE_DIR / f"ind_{ticker}.parquet"
        try:
            indicator_cache[ticker] = pd.read_parquet(ind_path).sort_index()
            indicator_cache[ticker].index = pd.to_datetime(
                indicator_cache[ticker].index
            ).tz_localize(None)
        except Exception:
            indicator_cache[ticker] = None

    if ticker not in raw_cache:
        raw_path = CACHE_DIR / f"{ticker}.parquet"
        try:
            raw_cache[ticker] = pd.read_parquet(raw_path).sort_index()
            raw_cache[ticker].index = pd.to_datetime(
                raw_cache[ticker].index
            ).tz_localize(None)
        except Exception:
            raw_cache[ticker] = None

    return indicator_cache[ticker], raw_cache[ticker]


def _signal_features(
    ticker: str,
    date: pd.Timestamp,
    indicator_cache: dict[str, pd.DataFrame | None],
    raw_cache: dict[str, pd.DataFrame | None],
) -> dict:
    ind, raw = _load_cache(ticker, indicator_cache, raw_cache)
    empty = {
        "cond_ma50": np.nan,
        "rebound_up_close": np.nan,
        "rebound_prev_high": np.nan,
        "rebound_higher_low_green": np.nan,
        "rebound_up_clv": np.nan,
        "signal_day_clv": np.nan,
    }
    if ind is None or raw is None or date not in ind.index or date not in raw.index:
        return empty

    ind_row = ind.loc[date]
    current_pos = raw.index.get_loc(date)
    if not isinstance(current_pos, (int, np.integer)) or current_pos < 1:
        return empty

    current = raw.iloc[current_pos]
    previous = raw.iloc[current_pos - 1]
    close = float(current["Close"])
    open_ = float(current["Open"])
    high = float(current["High"])
    low = float(current["Low"])
    prev_close = float(previous["Close"])
    prev_high = float(previous["High"])
    prev_low = float(previous["Low"])

    ma50 = float(ind_row["ma50"]) if pd.notna(ind_row["ma50"]) else np.nan
    day_range = high - low
    clv = ((close - low) - (high - close)) / day_range if day_range > 0 else 0.0

    up_close = close > prev_close
    return {
        "cond_ma50": bool(not np.isnan(ma50) and close >= ma50 * 0.97),
        "rebound_up_close": up_close,
        "rebound_prev_high": close > prev_high,
        "rebound_higher_low_green": low > prev_low and close > open_,
        "rebound_up_clv": up_close and clv > 0.2,
        "signal_day_clv": clv,
    }


def _load(files: list[str]) -> pd.DataFrame:
    frames = []
    for file_name in files:
        path = Path(file_name)
        frame = pd.read_csv(path)
        required = {
            "ticker", "mode", "signal_date", "pnl_pct", "exit_reason",
            "days_held", "signal_rsi", "signal_bb_pos",
            "signal_from_h52", "signal_vol_ratio",
        }
        missing = required.difference(frame.columns)
        if missing:
            raise ValueError(f"{path.name}: missing columns: {sorted(missing)}")
        dates = pd.to_datetime(frame["signal_date"], errors="coerce")
        frame["period"] = f"{dates.dt.year.min():.0f}~{dates.dt.year.max():.0f}"
        frames.append(frame)

    data = pd.concat(frames, ignore_index=True)
    data = data[data["mode"] == "B"].copy()
    data["signal_date"] = pd.to_datetime(data["signal_date"], errors="coerce")
    data["pnl_pct"] = pd.to_numeric(data["pnl_pct"], errors="coerce")
    data["days_held"] = pd.to_numeric(data["days_held"], errors="coerce")

    data["cond_rsi"] = pd.to_numeric(data["signal_rsi"], errors="coerce") <= 35
    data["cond_bb"] = pd.to_numeric(data["signal_bb_pos"], errors="coerce") < 0.2
    from_h52 = pd.to_numeric(data["signal_from_h52"], errors="coerce")
    data["cond_pullback"] = from_h52.between(-25, -8, inclusive="both")
    data["cond_volume"] = (
        pd.to_numeric(data["signal_vol_ratio"], errors="coerce") >= 1.5
    )

    indicator_cache: dict[str, pd.DataFrame | None] = {}
    raw_cache: dict[str, pd.DataFrame | None] = {}
    unique_keys = data[["ticker", "signal_date"]].drop_duplicates()
    feature_map = {}
    for row in unique_keys.itertuples(index=False):
        feature_map[(str(row.ticker), row.signal_date)] = _signal_features(
            str(row.ticker), row.signal_date, indicator_cache, raw_cache
        )

    feature_rows = [
        feature_map.get((str(ticker), date), {})
        for ticker, date in zip(data["ticker"], data["signal_date"])
    ]
    features = pd.DataFrame(feature_rows, index=data.index)
    for column in features.columns:
        data[column] = features[column]

    condition_columns = [column for column, _ in CONDITIONS]
    data = data.dropna(subset=["pnl_pct", "cond_ma50"])
    data["pass_count"] = data[condition_columns].astype(bool).sum(axis=1)

    label_map = dict(CONDITIONS)
    def combination(row: pd.Series) -> str:
        passed = [label_map[column] for column in condition_columns if bool(row[column])]
        return "+".join(passed)

    def missing_condition(row: pd.Series) -> str:
        missing = [label_map[column] for column in condition_columns if not bool(row[column])]
        return "5/5 전부충족" if not missing else "미충족: " + ", ".join(missing)

    data["combination"] = data.apply(combination, axis=1)
    data["missing_condition"] = data.apply(missing_condition, axis=1)
    return data


def _comparison_lines(
    data: pd.DataFrame,
    column: str,
    label: str,
    periods: list[str],
) -> list[str]:
    lines = [f"[{label}]", _stat_line("충족", data[data[column] == True])]
    lines.append(_stat_line("미충족", data[data[column] == False]))
    lines.append("  기간별 충족 거래:")
    for period in periods:
        subset = data[(data["period"] == period) & (data[column] == True)]
        lines.append("    " + _stat_line(period, subset).strip())
    return lines


def main() -> None:
    args = _args()
    data = _load(args.files)
    periods = list(dict.fromkeys(data["period"].tolist()))
    unique = data.drop_duplicates(
        ["period", "ticker", "mode", "signal_date"]
    ).copy()

    lines = [
        "WZ Mode B 조건 조합 및 반등 확인 캔들 분석",
        "=" * 90,
        "",
        "목적",
        "  기존 v5 전략을 변경하지 않고, Mode B 거래가 어떤 4/5 또는 5/5",
        "  조건 조합으로 통과했는지와 신호일 반등 캔들의 유효성을 분석합니다.",
        "",
        "표 읽는 법",
        "  승률     : 수익으로 종료된 거래 비율",
        "  평균     : 거래당 평균 수익률",
        "  중앙값   : 극단적인 대박 거래 영향을 줄여 본 가운데 수익률",
        "  손절     : stop 또는 stop_gap 청산 비율",
        "  timeout  : 20거래일 동안 목표·손절·룰깨짐 없이 종료된 비율",
        "  보유     : 평균 보유 거래일",
        "",
        "집계 방식",
        "  전체 체결은 모든 seed 거래를 포함합니다.",
        "  고유 신호는 같은 기간·종목·신호일을 한 번만 남겨 중복 영향을 줄입니다.",
        "",
        _stat_line("Mode B 전체 체결", data),
        _stat_line("Mode B 고유 신호", unique),
        "",
        "1. 통과 조건 개수",
        "-" * 90,
    ]

    for frame_name, frame in [("전체 체결", data), ("고유 신호", unique)]:
        lines.append(frame_name)
        for count in sorted(frame["pass_count"].unique(), reverse=True):
            lines.append(_stat_line(f"{int(count)}/5 충족", frame[frame["pass_count"] == count]))
        lines.append("")

    lines.extend([
        "2. 4/5에서 빠진 조건별 성과",
        "  이 표는 5개 중 정확히 4개로 통과한 거래에서 어떤 조건을 놓쳤는지 봅니다.",
        "  특정 조건을 놓친 거래가 반복적으로 나쁘다면 그 조건의 필수화를 검토할 수 있습니다.",
        "-" * 90,
    ])
    four_of_five = data[data["pass_count"] == 4]
    unique_four = unique[unique["pass_count"] == 4]
    missing_order = ["미충족: " + label for _, label in CONDITIONS]
    for missing in ["5/5 전부충족", *missing_order]:
        source = data if missing == "5/5 전부충족" else four_of_five
        unique_source = unique if missing == "5/5 전부충족" else unique_four
        lines.append(_stat_line(missing + " (전체)", source[source["missing_condition"] == missing]))
        lines.append(_stat_line(missing + " (고유)", unique_source[unique_source["missing_condition"] == missing]))
        period_parts = []
        for period in periods:
            group = unique_source[
                (unique_source["period"] == period)
                & (unique_source["missing_condition"] == missing)
            ]
            stat = _stats(group)
            if stat["count"]:
                period_parts.append(
                    f"{period} n={stat['count']} avg={stat['avg_pnl']:+.2f}% "
                    f"win={stat['win_rate']:.1f}%"
                )
            else:
                period_parts.append(f"{period} n=0")
        lines.append("  " + " | ".join(period_parts))
        lines.append("")

    lines.extend([
        "3. 각 조건 충족 여부 비교 (고유 신호)",
        "  다른 조건과 서로 연관되어 있으므로 인과관계가 아니라 기여도 후보로 해석합니다.",
        "-" * 90,
    ])
    for column, label in CONDITIONS:
        lines.extend(_comparison_lines(unique, column, label, periods))
        lines.append("")

    lines.extend([
        "4. 반등 확인 캔들 비교 (고유 신호)",
        "  반등 신호 정의:",
        "    전일 종가 돌파          : 신호일 종가 > 전일 종가",
        "    전일 고가 돌파          : 신호일 종가 > 전일 고가",
        "    저점 상승 + 양봉        : 신호일 저가 > 전일 저가 AND 종가 > 시가",
        "    전일 종가 돌파 + CLV>0.2: 가격 상승과 당일 고가권 마감을 함께 요구",
        "-" * 90,
    ])
    for column, label in REBOUND_SIGNALS:
        valid = unique.dropna(subset=[column])
        lines.extend(_comparison_lines(valid, column, label, periods))
        lines.append("")

    lines.extend([
        "5. 조건 조합별 고유 신호 상위 표",
        "  거래 수가 많은 조합부터 표시합니다.",
        "-" * 90,
    ])
    combination_counts = unique.groupby("combination").size().sort_values(ascending=False)
    for combination in combination_counts[combination_counts >= 20].index:
        group = unique[unique["combination"] == combination]
        lines.append(_stat_line(combination, group))

    lines.extend([
        "",
        "해석 원칙",
        "  1. 표본이 작은 조합의 높은 승률은 신뢰하지 않습니다.",
        "  2. 전체 평균뿐 아니라 네 기간에서 방향이 반복되는지 확인합니다.",
        "  3. 유력 후보가 나오더라도 전략에는 바로 반영하지 않고 동일 seed로",
        "     단일 변경 백테스트를 수행합니다.",
        "  4. 백테스트는 과거 성과이며 생존편향이 남아 있습니다.",
    ])

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\nSaved: {output}")


if __name__ == "__main__":
    main()
