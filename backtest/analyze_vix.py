"""
진입 시점 VIX와 이후 거래 성과의 관계를 분석한다.

VIX는 이 단계에서 매매 필터로 사용하지 않는다. 절대 수준, 상대적 백분위,
변화율과 공포 정점 후 하락 신호가 Mode A/B 성과와 어떤 관계가 있는지
탐색하는 도구다.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


RESULTS_DIR = Path(__file__).parent / "results"

FACTORS = {
    "signal_vix_close": (
        "VIX 절대 수준",
        [-np.inf, 15, 20, 25, 30, 40, np.inf],
        ["<15", "15~20", "20~25", "25~30", "30~40", ">=40"],
    ),
    "signal_vix_percentile_20d": (
        "VIX 20일 백분위",
        [-np.inf, 20, 40, 60, 80, np.inf],
        ["0~20", "20~40", "40~60", "60~80", "80~100"],
    ),
    "signal_vix_percentile_60d": (
        "VIX 60일 백분위",
        [-np.inf, 20, 40, 60, 80, np.inf],
        ["0~20", "20~40", "40~60", "60~80", "80~100"],
    ),
    "signal_vix_percentile_252d": (
        "VIX 252일 백분위",
        [-np.inf, 20, 40, 60, 80, np.inf],
        ["0~20", "20~40", "40~60", "60~80", "80~100"],
    ),
    "signal_vix_change_5d_pct": (
        "VIX 5일 변화율",
        [-np.inf, -20, -10, 0, 10, 25, np.inf],
        ["<-20%", "-20~-10%", "-10~0%", "0~10%", "10~25%", ">=25%"],
    ),
    "signal_vix_change_20d_pct": (
        "VIX 20일 변화율",
        [-np.inf, -30, -15, 0, 15, 30, np.inf],
        ["<-30%", "-30~-15%", "-15~0%", "0~15%", "15~30%", ">=30%"],
    ),
    "signal_vix_drawdown_from_20d_high_pct": (
        "VIX 20일 고점 대비 하락률",
        [-np.inf, -30, -20, -10, -5, 0.001],
        ["<-30%", "-30~-20%", "-20~-10%", "-10~-5%", "-5~0%"],
    ),
}

FLAGS = {
    "signal_vix_turn_down": "VIX 전일 대비 하락",
    "signal_vix_peak_turn_10d": "전일 10일 고점 후 첫 하락",
    "signal_vix_peak_turn_10d_drop5": "전일 10일 고점 후 5% 이상 하락",
}


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WZ VIX entry-factor analysis")
    parser.add_argument("files", nargs="+", help="VIX 계측 거래 CSV")
    parser.add_argument(
        "--output",
        default=str(RESULTS_DIR / "factor_analysis_vix.txt"),
        help="보고서 저장 경로",
    )
    return parser.parse_args()


def _load(files: list[str]) -> pd.DataFrame:
    frames = []
    required = {
        "ticker", "mode", "signal_date", "pnl_pct", "exit_reason",
        *FACTORS.keys(), *FLAGS.keys(),
    }
    for file_name in files:
        path = Path(file_name)
        frame = pd.read_csv(path)
        missing = required.difference(frame.columns)
        if missing:
            raise ValueError(f"{path.name}: missing columns: {sorted(missing)}")
        dates = pd.to_datetime(frame["signal_date"], errors="coerce")
        frame["period"] = f"{dates.dt.year.min():.0f}~{dates.dt.year.max():.0f}"
        frames.append(frame)

    data = pd.concat(frames, ignore_index=True)
    data["signal_date"] = pd.to_datetime(data["signal_date"], errors="coerce")
    data["pnl_pct"] = pd.to_numeric(data["pnl_pct"], errors="coerce")
    for factor in FACTORS:
        data[factor] = pd.to_numeric(data[factor], errors="coerce")
    for flag in FLAGS:
        data[flag] = data[flag].astype(str).str.lower().isin({"true", "1", "1.0"})
    return data.dropna(subset=["signal_date", "pnl_pct"])


def _stats(frame: pd.DataFrame) -> dict:
    pnl = frame["pnl_pct"]
    return {
        "n": len(frame),
        "win": (pnl > 0).mean() * 100 if len(frame) else np.nan,
        "avg": pnl.mean(),
        "median": pnl.median(),
        "timeout": (frame["exit_reason"] == "timeout").mean() * 100,
        "stop": frame["exit_reason"].isin(["stop", "stop_gap"]).mean() * 100,
    }


def _stat_line(label: str, frame: pd.DataFrame) -> str:
    stat = _stats(frame)
    return (
        f"{label:<18} n={stat['n']:>5}  승률={stat['win']:>5.1f}%  "
        f"평균={stat['avg']:>+6.2f}%  중앙값={stat['median']:>+6.2f}%  "
        f"timeout={stat['timeout']:>5.1f}%  손절={stat['stop']:>5.1f}%"
    )


def _factor_lines(data: pd.DataFrame, factor: str, periods: list[str]) -> list[str]:
    title, bins, labels = FACTORS[factor]
    work = data.dropna(subset=[factor]).copy()
    work["bucket"] = pd.cut(
        work[factor], bins=bins, labels=labels, right=False, include_lowest=True
    )
    lines = ["", f"[{title}] ({factor})"]
    for bucket, group in work.groupby("bucket", observed=True):
        lines.append(_stat_line(str(bucket), group))
        for period in periods:
            period_group = group[group["period"] == period]
            if len(period_group):
                lines.append("  " + _stat_line(period, period_group))
    return lines


def _flag_lines(data: pd.DataFrame, flag: str, periods: list[str]) -> list[str]:
    lines = ["", f"[{FLAGS[flag]}] ({flag})"]
    for value, label in [(True, "해당"), (False, "비해당")]:
        group = data[data[flag] == value]
        lines.append(_stat_line(label, group))
        for period in periods:
            period_group = group[group["period"] == period]
            if len(period_group):
                lines.append("  " + _stat_line(period, period_group))
    return lines


def main() -> None:
    args = _parse_args()
    data = _load(args.files)
    periods = list(dict.fromkeys(data["period"].tolist()))

    lines = [
        "WZ VIX 진입 팩터 분석",
        "=" * 86,
        "",
        "목적",
        "  VIX를 매매 조건으로 바로 사용하지 않고, 진입 당시의 공포 수준과 변화가",
        "  이후 거래 성과에 어떤 관계가 있었는지 탐색한다.",
        "",
        "지표 설명",
        "  절대 수준 : 신호일 VIX 종가다.",
        "  백분위    : 현재 VIX가 직전 20/60/252거래일 범위에서 어느 위치인지 나타낸다.",
        "              80~100이면 해당 기간 기준으로 공포 수준이 높은 편이다.",
        "  고점 후 하락: 전일 VIX가 직전 10일 최고 수준이고 오늘 처음 하락했는지 본다.",
        "              신호일 종가까지만 사용하므로 미래참조가 없다.",
        "",
        "표 읽는 법",
        "  평균과 중앙값이 함께 양수이고 여러 기간에서 반복될수록 다음 검증 후보로",
        "  볼 수 있다. 표본이 작거나 한 기간에만 좋은 구간은 채택하지 않는다.",
        "",
    ]

    for mode in ("A", "B"):
        mode_data = data[data["mode"] == mode].copy()
        unique = mode_data.drop_duplicates(
            ["period", "ticker", "mode", "signal_date"]
        )
        lines.extend([
            "",
            "#" * 86,
            f"MODE {mode}",
            _stat_line("전체 체결", mode_data),
            _stat_line("고유 신호", unique),
        ])
        for factor in FACTORS:
            lines.extend(_factor_lines(unique, factor, periods))
        for flag in FLAGS:
            lines.extend(_flag_lines(unique, flag, periods))

    lines.extend([
        "",
        "해석 시 주의",
        "  1. 이 결과는 상관관계 분석이며 VIX가 수익의 원인이라는 뜻이 아니다.",
        "  2. 유망 구간이 나오면 같은 기간·seed에서 한 가지 규칙만 바꿔 재검증한다.",
        "  3. 현재 S&P 500 구성종목을 과거로 소급하므로 생존편향이 남아 있다.",
        "  4. 백테스트 결과는 과거 성과이며 미래 수익을 보장하지 않는다.",
    ])

    report = "\n".join(lines) + "\n"
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report, encoding="utf-8")
    print(report)
    print(f"Saved: {output}")


if __name__ == "__main__":
    main()
