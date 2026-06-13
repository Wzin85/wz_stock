"""
기존 거래 CSV에 신호일 VIX 팩터를 결합한다.

VIX는 거래 선택에 사용되지 않으므로 백테스트를 다시 실행하지 않고도
기존 거래 결과를 그대로 보존하며 시장 레짐 분석용 컬럼을 추가할 수 있다.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from data import build_indicator_cache, download_and_cache


VIX_COLUMNS = {
    "close": "signal_vix_close",
    "vix_change_1d_pct": "signal_vix_change_1d_pct",
    "vix_change_5d_pct": "signal_vix_change_5d_pct",
    "vix_change_20d_pct": "signal_vix_change_20d_pct",
    "vix_percentile_20d": "signal_vix_percentile_20d",
    "vix_percentile_60d": "signal_vix_percentile_60d",
    "vix_percentile_252d": "signal_vix_percentile_252d",
    "vix_drawdown_from_20d_high_pct": "signal_vix_drawdown_from_20d_high_pct",
    "vix_turn_down": "signal_vix_turn_down",
    "vix_peak_turn_10d": "signal_vix_peak_turn_10d",
    "vix_peak_turn_10d_drop5": "signal_vix_peak_turn_10d_drop5",
}


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add VIX factors to trade CSV files")
    parser.add_argument("files", nargs="+", help="기존 거래 CSV 파일")
    parser.add_argument(
        "--suffix",
        default="_vix",
        help="출력 파일 접미사 (기본: _vix)",
    )
    parser.add_argument("--force-refresh", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = _args()
    inputs = [Path(name) for name in args.files]
    frames = [pd.read_csv(path) for path in inputs]
    dates = pd.concat(
        [pd.to_datetime(frame["signal_date"], errors="coerce") for frame in frames],
        ignore_index=True,
    ).dropna()
    if dates.empty:
        raise ValueError("유효한 signal_date가 없습니다.")

    start = dates.min().strftime("%Y-%m-%d")
    end = dates.max().strftime("%Y-%m-%d")
    raw = download_and_cache(
        ["^VIX"],
        start_date=start,
        end_date=end,
        force_refresh=args.force_refresh,
    )
    indicators = build_indicator_cache(raw, force_refresh=args.force_refresh)
    if "^VIX" not in indicators:
        raise RuntimeError("^VIX 데이터를 준비하지 못했습니다.")

    vix = indicators["^VIX"][list(VIX_COLUMNS)].rename(columns=VIX_COLUMNS)
    vix.index = pd.to_datetime(vix.index).normalize()

    for path, frame in zip(inputs, frames):
        signal_dates = pd.to_datetime(frame["signal_date"], errors="coerce").dt.normalize()
        joined = vix.reindex(signal_dates)
        joined.index = frame.index
        for column in joined:
            frame[column] = joined[column]

        output = path.with_name(f"{path.stem}{args.suffix}{path.suffix}")
        frame.to_csv(output, index=False)
        missing = int(frame["signal_vix_close"].isna().sum())
        print(f"{output.name}: {len(frame)}건, VIX 누락 {missing}건")


if __name__ == "__main__":
    main()
