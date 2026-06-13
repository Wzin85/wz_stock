"""
기존 백테스트 거래 CSV에 신호일 기준 SPY 상대강도를 추가한다.

App.jsx와 동일한 정의:
  RS(기간) = 종목 기간수익률 - SPY 기간수익률
  1개월 = 21 거래일, 3개월 = 63 거래일

원본 CSV는 수정하지 않고 파일명 뒤에 ``_rs``를 붙여 저장한다.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


CACHE_DIR = Path(__file__).parent / "cache"


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="백테스트 거래 CSV에 SPY 대비 상대강도 팩터 추가"
    )
    parser.add_argument("files", nargs="+", help="보강할 trades CSV 파일")
    parser.add_argument(
        "--output-dir",
        default=None,
        help="출력 폴더 (기본: 입력 파일과 같은 폴더)",
    )
    return parser.parse_args()


def _load_close(ticker: str, loaded: dict[str, pd.Series]) -> pd.Series | None:
    if ticker in loaded:
        return loaded[ticker]
    path = CACHE_DIR / f"ind_{ticker}.parquet"
    if not path.exists():
        loaded[ticker] = None
        return None
    try:
        frame = pd.read_parquet(path, columns=["close"]).sort_index()
        frame.index = pd.to_datetime(frame.index).tz_localize(None)
        close = frame["close"].dropna()
        loaded[ticker] = close
        return close
    except Exception:
        loaded[ticker] = None
        return None


def _period_return(close: pd.Series, date: pd.Timestamp, period: int) -> float:
    if date not in close.index:
        return float("nan")
    loc = close.index.get_loc(date)
    if not isinstance(loc, (int, np.integer)) or loc < period:
        return float("nan")
    before = float(close.iloc[loc - period])
    current = float(close.iloc[loc])
    if before == 0 or np.isnan(before) or np.isnan(current):
        return float("nan")
    return (current / before - 1) * 100


def enrich_file(path: Path, output_dir: Path | None = None) -> Path:
    data = pd.read_csv(path)
    required = {"ticker", "signal_date"}
    missing = required.difference(data.columns)
    if missing:
        raise ValueError(f"{path.name}: missing columns: {sorted(missing)}")

    loaded: dict[str, pd.Series | None] = {}
    spy_close = _load_close("SPY", loaded)
    if spy_close is None or spy_close.empty:
        raise RuntimeError("SPY indicator cache is missing")

    signal_dates = pd.to_datetime(data["signal_date"], errors="coerce")
    keys = data.assign(signal_date_dt=signal_dates)[
        ["ticker", "signal_date_dt"]
    ].drop_duplicates()

    factors: dict[tuple[str, pd.Timestamp], tuple[float, float]] = {}
    for row in keys.itertuples(index=False):
        ticker = str(row.ticker)
        date = row.signal_date_dt
        if pd.isna(date):
            continue
        stock_close = _load_close(ticker, loaded)
        if stock_close is None or stock_close.empty:
            factors[(ticker, date)] = (float("nan"), float("nan"))
            continue

        rs_values = []
        for period in (21, 63):
            stock_return = _period_return(stock_close, date, period)
            spy_return = _period_return(spy_close, date, period)
            rs_values.append(
                stock_return - spy_return
                if not np.isnan(stock_return) and not np.isnan(spy_return)
                else float("nan")
            )
        factors[(ticker, date)] = tuple(rs_values)

    rs_1m = []
    rs_3m = []
    for ticker, date in zip(data["ticker"].astype(str), signal_dates):
        values = factors.get((ticker, date), (float("nan"), float("nan")))
        rs_1m.append(values[0])
        rs_3m.append(values[1])

    data["signal_rs_1m"] = np.round(rs_1m, 4)
    data["signal_rs_3m"] = np.round(rs_3m, 4)

    target_dir = output_dir or path.parent
    target_dir.mkdir(parents=True, exist_ok=True)
    output = target_dir / f"{path.stem}_rs.csv"
    data.to_csv(output, index=False, encoding="utf-8-sig")

    missing_1m = int(data["signal_rs_1m"].isna().sum())
    missing_3m = int(data["signal_rs_3m"].isna().sum())
    print(
        f"{path.name} -> {output.name} "
        f"(rows={len(data)}, missing 1M={missing_1m}, 3M={missing_3m})"
    )
    return output


def main() -> None:
    args = _args()
    output_dir = Path(args.output_dir) if args.output_dir else None
    for file_name in args.files:
        enrich_file(Path(file_name), output_dir)


if __name__ == "__main__":
    main()
