"""
주가 데이터 다운로드 (yfinance) · 로컬 캐시 (Parquet) · 지표 계산
App.jsx computeIndicators() 로직의 vectorized pandas 포팅

⚠ 생존편향: yfinance는 현재 상장된 종목만 제공합니다.
  상폐·합병된 종목은 데이터에 포함되지 않아 실제보다 낙관적 결과가 나올 수 있습니다.
"""
from __future__ import annotations
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
from tqdm import tqdm

CACHE_DIR  = Path(__file__).parent / "cache"
SP500_JSON = Path(__file__).parent.parent / "screener" / "sp500.json"


def load_sp500_tickers() -> list[str]:
    """screener/sp500.json에서 S&P 500 티커 목록 로드 (중복 제거)"""
    with open(SP500_JSON) as f:
        pool = json.load(f)["tickers"]
    return list(dict.fromkeys(t.upper() for t in pool))


def _fetch_one(
    ticker: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame | None:
    try:
        # yfinance의 end는 exclusive이므로 호출부에서 하루 뒤 날짜를 넘긴다.
        df = yf.Ticker(ticker).history(
            start=start_date,
            end=end_date,
            auto_adjust=True,
        )
        if df is None or len(df) < 100:
            return None
        df.index = df.index.tz_localize(None)
        df.index.name = "date"
        return df[["Open", "High", "Low", "Close", "Volume"]]
    except Exception:
        return None


def download_and_cache(
    tickers: list[str],
    start_date: str,
    end_date: str,
    cache_dir: Path = CACHE_DIR,
    force_refresh: bool = False,
    batch_size: int = 25,
    batch_delay: float = 1.0,
    warmup_calendar_days: int = 400,
) -> dict[str, pd.DataFrame]:
    """
    요청 백테스트 기간 + 지표 워밍업 데이터를 Parquet으로 캐시 후 반환.
    기존 캐시가 요청 범위를 덮지 못하면 필요한 전체 범위를 다시 받아 병합한다.

    ⚠ 생존편향: 현재 존재하지 않는 종목은 캐시되지 않습니다.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    raw: dict[str, pd.DataFrame] = {}
    to_dl: list[str] = []
    required_start = (pd.Timestamp(start_date) - pd.Timedelta(days=warmup_calendar_days)).normalize()
    required_end = pd.Timestamp(end_date).normalize()
    fetch_end = (required_end + pd.Timedelta(days=1)).strftime("%Y-%m-%d")

    for t in tickers:
        fp = cache_dir / f"{t}.parquet"
        if not force_refresh and fp.exists():
            try:
                cached = pd.read_parquet(fp).sort_index()
                # 휴장일 차이를 감안해 요청 경계에서 7일 이내면 범위를 충족한 것으로 본다.
                covers_start = cached.index.min() <= required_start + pd.Timedelta(days=7)
                covers_end = cached.index.max() >= required_end - pd.Timedelta(days=7)
                if covers_start and covers_end:
                    raw[t] = cached
                    continue
            except Exception:
                pass
        to_dl.append(t)

    if to_dl:
        print(
            f"  다운로드: {len(to_dl)}개 티커 "
            f"({required_start.date()} ~ {required_end.date()}, 워밍업 포함)"
        )
        for i in range(0, len(to_dl), batch_size):
            batch = to_dl[i : i + batch_size]
            for t in tqdm(batch, desc=f"  배치 {i // batch_size + 1}", leave=False):
                df = _fetch_one(t, required_start.strftime("%Y-%m-%d"), fetch_end)
                if df is not None:
                    fp = cache_dir / f"{t}.parquet"
                    if fp.exists() and not force_refresh:
                        try:
                            old = pd.read_parquet(fp)
                            df = pd.concat([old, df]).sort_index()
                            df = df[~df.index.duplicated(keep="last")]
                        except Exception:
                            pass
                    df.to_parquet(fp)
                    raw[t] = df
            if i + batch_size < len(to_dl):
                time.sleep(batch_delay)

    return raw


# ── 지표 계산 ─────────────────────────────────────────────────────


def _rsi_wilder(close: pd.Series, period: int = 14) -> pd.Series:
    """
    Wilder's RSI — App.jsx calcRSI() 포팅.
    EWM(com=period-1, adjust=False) = Wilder 스무딩 (alpha = 1/period).
    데이터가 부족한 구간은 NaN.
    """
    delta    = close.diff()
    avg_gain = delta.clip(lower=0).ewm(com=period - 1, min_periods=period, adjust=False).mean()
    avg_loss = (-delta).clip(lower=0).ewm(com=period - 1, min_periods=period, adjust=False).mean()
    rs  = avg_gain / avg_loss.replace(0, np.nan)
    rsi = (100 - 100 / (1 + rs)).fillna(100)
    return rsi.where(close.rolling(period).count() >= period, np.nan)


def compute_indicator_series(df: pd.DataFrame) -> pd.DataFrame:
    """
    전체 기간 지표 시리즈 vectorized 계산.
    App.jsx computeIndicators() 로직의 정확한 포팅.

    반환 컬럼:
      close, open            — OHLCV
      ma20, ma50, ma200      — 이동평균 (MA200은 시장 국면 필터용)
      rsi                    — Wilder RSI(14) (App.jsx calcRSI 동일)
      macd_hist              — MACD(12,26,9) 히스토그램
      bb_pos                 — 볼린저 위치 0-1 (App.jsx calcBollinger 동일, ddof=0)
      bb_upper, bb_lower     — 볼린저 상·하단
      vol_ratio              — 거래량/20일평균
      pos52w                 — 52주 위치 0-1 (App.jsx calc52WeekPos 동일)
      from_h52               — 52주 고점 대비 % (음수)
      h52, l52               — 52주 최고·최저
      atr                    — ATR(14)
      mf_ratio               — CLV 기반 수급 (App.jsx detectCapitulation 동일)
      ret_21, ret_63         — 21/63 거래일 수익률 (SPY 상대강도 계산용)
    """
    c  = df["Close"].squeeze()
    h  = df["High"].squeeze()
    lo = df["Low"].squeeze()
    v  = df["Volume"].squeeze()

    # ── MA (App.jsx avg(closes.slice(-N))) ────────────────────────
    ma20 = c.rolling(20, min_periods=20).mean()
    ma50 = c.rolling(50, min_periods=50).mean()
    ma200 = c.rolling(200, min_periods=200).mean()

    # ── RSI(14) Wilder 스무딩 (App.jsx calcRSI 포팅) ──────────────
    rsi = _rsi_wilder(c, 14)

    # ── MACD(12,26,9) EMA (App.jsx calcMACD 포팅) ─────────────────
    e12       = c.ewm(span=12, adjust=False).mean()
    e26       = c.ewm(span=26, adjust=False).mean()
    macd_line = e12 - e26
    macd_sig  = macd_line.ewm(span=9, adjust=False).mean()
    macd_hist = macd_line - macd_sig

    # ── 볼린저(20, 2σ) 모표준편차 (App.jsx calcBollinger ddof=0) ──
    bb_mid   = c.rolling(20, min_periods=20).mean()
    bb_std   = c.rolling(20, min_periods=20).std(ddof=0)
    bb_upper = bb_mid + 2 * bb_std
    bb_lower = bb_mid - 2 * bb_std
    bb_pos   = (c - bb_lower) / (bb_upper - bb_lower)   # 0-1

    # ── 거래량 비율 20일 (App.jsx vols[n-1]/avg(vols.slice(-20))) ──
    avg_vol   = v.rolling(20, min_periods=10).mean()
    vol_ratio = v / avg_vol

    # ── 52주 위치 (App.jsx calc52WeekPos 포팅, 0-1 스케일) ─────────
    h52      = h.rolling(252, min_periods=60).max()
    l52      = lo.rolling(252, min_periods=60).min()
    range52  = (h52 - l52).replace(0, np.nan)
    pos52w   = ((c - l52) / range52).clip(0, 1)   # 0-1
    from_h52 = (c / h52 - 1) * 100                 # % (음수)

    # ── ATR(14) (App.jsx True Range 공식) ────────────────────────
    tr = pd.concat([
        h - lo,
        (h - c.shift(1)).abs(),
        (lo - c.shift(1)).abs(),
    ], axis=1).max(axis=1)
    atr = tr.rolling(14, min_periods=14).mean()

    # ── CLV 기반 수급 10일 (App.jsx detectCapitulation CLV 공식) ──
    # CLV = ((close-low) - (high-close)) / (high-low)  → [-1, +1]
    rng_hl   = (h - lo).replace(0, np.nan)
    clv      = ((c - lo) - (h - c)) / rng_hl
    mf_ratio = (clv * v).rolling(10, min_periods=5).sum() / v.rolling(10, min_periods=5).sum()

    ma20_5d = ma20.shift(5)   # MODE_A "MA20상승" 조건용
    ret_21 = (c / c.shift(21) - 1) * 100
    ret_63 = (c / c.shift(63) - 1) * 100

    return pd.DataFrame({
        "close":     c,
        "open":      df["Open"].squeeze(),
        "ma20":      ma20,
        "ma20_5d":   ma20_5d,
        "ma50":      ma50,
        "ma200":     ma200,
        "rsi":       rsi,
        "macd_hist": macd_hist,
        "bb_pos":    bb_pos,
        "bb_upper":  bb_upper,
        "bb_lower":  bb_lower,
        "vol_ratio": vol_ratio,
        "pos52w":    pos52w,
        "from_h52":  from_h52,
        "h52":       h52,
        "l52":       l52,
        "atr":       atr,
        "mf_ratio":  mf_ratio,
        "ret_21":    ret_21,
        "ret_63":    ret_63,
    }, index=df.index)


def _rolling_last_percentile(series: pd.Series, window: int) -> pd.Series:
    """현재 값을 직전 window개 값 안에서 0~100 백분위로 표현한다."""
    return series.rolling(window, min_periods=window).apply(
        lambda values: float(np.mean(values <= values[-1]) * 100),
        raw=True,
    )


def compute_vix_series(df: pd.DataFrame) -> pd.DataFrame:
    """
    VIX 시장 레짐 연구용 시리즈.

    모든 값은 해당 거래일 종가까지의 데이터만 사용한다. 신호는 종가 확정 후
    만들고 다음 거래일 시가에 체결하므로 look-ahead가 없다.
    """
    result = compute_indicator_series(df)
    close = df["Close"].squeeze()
    prior_10d_high = close.shift(1).rolling(10, min_periods=10).max()
    turn_down = close < close.shift(1)
    peak_turn_10d = turn_down & (close.shift(1) >= prior_10d_high)

    result["vix_change_1d_pct"] = (close / close.shift(1) - 1) * 100
    result["vix_change_5d_pct"] = (close / close.shift(5) - 1) * 100
    result["vix_change_20d_pct"] = (close / close.shift(20) - 1) * 100
    result["vix_percentile_20d"] = _rolling_last_percentile(close, 20)
    result["vix_percentile_60d"] = _rolling_last_percentile(close, 60)
    result["vix_percentile_252d"] = _rolling_last_percentile(close, 252)
    result["vix_drawdown_from_20d_high_pct"] = (
        close / close.rolling(20, min_periods=20).max() - 1
    ) * 100
    result["vix_turn_down"] = turn_down.astype(float)
    result["vix_peak_turn_10d"] = peak_turn_10d.astype(float)
    result["vix_peak_turn_10d_drop5"] = (
        peak_turn_10d & (result["vix_change_1d_pct"] <= -5)
    ).astype(float)
    return result


def build_indicator_cache(
    raw: dict[str, pd.DataFrame],
    cache_dir: Path = CACHE_DIR,
    force_refresh: bool = False,
) -> dict[str, pd.DataFrame]:
    """
    모든 티커에 대해 지표 시리즈 계산.
    결과를 cache/ind_{TICKER}.parquet으로 저장해 다음 실행 시 재계산 스킵.
    raw parquet보다 오래된 경우 자동 재계산.
    """
    indicators: dict[str, pd.DataFrame] = {}
    for ticker, df in raw.items():
        ind_path = cache_dir / f"ind_{ticker}.parquet"
        raw_path = cache_dir / f"{ticker}.parquet"

        # 캐시 유효성: ind 파일이 있고 raw보다 최신이면 로드
        if not force_refresh and ind_path.exists():
            try:
                if raw_path.exists() and ind_path.stat().st_mtime >= raw_path.stat().st_mtime:
                    ind = pd.read_parquet(ind_path)
                    required_columns = {
                        "ma20", "ma20_5d", "ma50", "ma200", "rsi", "mf_ratio",
                        "ret_21", "ret_63",
                    }
                    if ticker == "^VIX":
                        required_columns.update({
                            "vix_change_1d_pct", "vix_change_5d_pct",
                            "vix_change_20d_pct", "vix_percentile_20d",
                            "vix_percentile_60d", "vix_percentile_252d",
                            "vix_drawdown_from_20d_high_pct",
                            "vix_turn_down", "vix_peak_turn_10d",
                            "vix_peak_turn_10d_drop5",
                        })
                    if not ind.empty and required_columns.issubset(ind.columns):
                        indicators[ticker] = ind
                        continue
            except Exception:
                pass

        # 계산 후 저장
        try:
            ind = compute_vix_series(df) if ticker == "^VIX" else compute_indicator_series(df)
            if not ind.empty:
                ind.to_parquet(ind_path)
                indicators[ticker] = ind
        except Exception:
            pass
    return indicators
