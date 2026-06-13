"""
백테스팅 엔진 (look-ahead 없음)

일별 루프 순서:
  1. 전날 신호의 매수 큐 → 오늘 시가(open)로 체결
  2. 기존 포지션 청산 체크 (종가 기준, 갭다운은 시가 기준)
  3. 새로운 신호 스캔 → 다음날 매수 큐에 등록
  4. 포트폴리오 가치 기록

청산 조건 (App.jsx 분석 기본값 기준 표준화):
  - 손절: entry - 2×ATR (ATR은 신호일 기준)
  - 목표: entry + 4×ATR (손익비 2:1)
  - 룰깨짐: Mode A → 종가 < MA50 (정배열 붕괴)
             Mode B → RSI > 60 (과매도 해소/반등 실패)
  - 타임아웃: 20 거래일 초과
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from screener import screen_snapshot

INITIAL_CASH  = 5_000.0
MAX_POSITIONS = 5
COMMISSION    = 0.001   # 매수·매도 각 0.1% (슬리피지 포함)
MAX_HOLD_DAYS = 20
STOP_ATR_MULT = 2.0     # 손절 = entry - 2×ATR
TARGET_RR     = 2.0     # 목표 손익비 (손실 대비 수익 배수)
# v6 adopts the validated close-based trailing stop. Experimental selection
# modes remain opt-in until they pass multi-period validation.
BACKTEST_VERSION = "v6"
MARKET_FILTER_VERSION = "SPY_MA200_v1"
RESEARCH_DATA_VERSION = "VIX_FACTORS_v1"
MODE_A_VIX_FILTER_VERSION = "MODE_A_VIX252_P60_HARD_FILTER_v1"
TRAILING_STOP_VERSION = "CLOSE_TRAILING_ACTIVATE_1ATR_DISTANCE_2ATR_v1"
TRAILING_ACTIVATE_ATR_DEFAULT = 1.0
TRAILING_DISTANCE_ATR_DEFAULT = 2.0
SELECTION_VERSIONS = {
    "original": "ORIGINAL_TICKER_ORDER_v1",
    "ma20-gap": "MODE_A_MA20_GAP_4PCT_v1",
    "ma20-gap-clv": "MODE_A_MA20_GAP_4PCT__MODE_B_CLV_NEG0P3_v1",
    "ma20-gap-rs1m": "MODE_A_MA20_GAP_4PCT__MODE_B_RS1M_NEG7P5_v1",
    "ma20-gap-ma50": "MODE_A_MA20_GAP_4PCT__MODE_B_MA50_PASS_FIRST_v1",
    "ma20-gap-vix-a-priority": (
        "MODE_A_MA20_GAP_4PCT__VIX252_P60_MODE_A_PRIORITY_v1"
    ),
}


@dataclass
class _Position:
    ticker:      str
    mode:        str
    entry_date:  pd.Timestamp
    entry_price: float
    stop:        float
    target:      float
    shares:      float
    entry_atr:   float
    highest_close: float
    trailing_active: bool = False
    signal_data: dict = field(default_factory=dict)
    days_held:   int = field(default=0)


def _to_row_dict(row: pd.Series) -> dict:
    """pandas Series → screener.screen_snapshot 입력용 dict (NaN은 float nan 유지)"""
    return {k: float(v) if pd.notna(v) else float("nan") for k, v in row.items()}


def run_backtest(
    tickers: list[str],
    all_indicators: dict[str, pd.DataFrame],
    start_date: str,
    end_date: str,
    selection: str = "original",
    mode_b_atr_max_pct: float | None = None,
    mode_a_vix_min_percentile: float | None = None,
    trailing_stop: bool = True,
    trailing_activate_atr: float = TRAILING_ACTIVATE_ATR_DEFAULT,
    trailing_distance_atr: float = TRAILING_DISTANCE_ATR_DEFAULT,
) -> tuple[list[dict], pd.Series]:
    """
    단일 백테스트 실행.

    Args:
        tickers:        이번 반복에서 스캔할 종목 리스트
        all_indicators: {ticker: 지표 DataFrame} (전체 티커 사전)
        start_date:     백테스트 시작일 'YYYY-MM-DD'
        end_date:       백테스트 종료일 'YYYY-MM-DD'
        mode_b_atr_max_pct:
            지정 시 Mode B 신규 신호 중 ATR/종가 비율이 이 값 이상인 후보 제외.
            None이면 기존 Mode B 규칙을 그대로 사용한다.
        mode_a_vix_min_percentile:
            지정 시 VIX 252일 백분위가 이 값 이상일 때만 Mode A 신규 진입.
            Mode B에는 적용하지 않으며, Mode A가 차단된 종목도 Mode B 조건을
            충족하면 Mode B 후보로 남는다.
        trailing_stop:
            True이면 종가가 진입가 + trailing_activate_atr * ATR에 도달한 뒤
            최고 종가 - trailing_distance_atr * ATR로 손절가를 올린다.
            오늘 종가로 계산한 손절가는 다음 거래일부터 적용하며,
            손절가는 절대 낮아지지 않는다.

    Returns:
        trades:       거래 기록 리스트
        equity_curve: 일별 포트폴리오 가치 pd.Series
    """
    # 거래 캘린더: SPY 또는 첫 번째 유효 티커 기준
    anchor = "SPY" if "SPY" in all_indicators else tickers[0]
    ind_anchor = all_indicators[anchor]
    dates = ind_anchor.loc[start_date:end_date].index
    if len(dates) < 10:
        return [], pd.Series(dtype=float)

    cash: float = INITIAL_CASH
    positions: list[_Position] = []
    buy_queue: list[dict] = []    # [{ticker, mode, stop_dist, target_dist}]
    trades:    list[dict] = []
    equity_curve: dict = {}

    def _portfolio_value(date: pd.Timestamp) -> float:
        pv = cash
        for pos in positions:
            ind = all_indicators.get(pos.ticker)
            if ind is not None and date in ind.index:
                pv += pos.shares * float(ind.at[date, "close"])
            else:
                pv += pos.shares * pos.entry_price
        return pv

    for date in dates:
        # ── 1. 매수 큐 처리: 전날 신호 → 오늘 시가 체결 ────────
        slots_free = MAX_POSITIONS - len(positions)
        for order in list(buy_queue):
            if slots_free <= 0:
                break
            ticker = order["ticker"]
            if any(p.ticker == ticker for p in positions):
                continue

            ind = all_indicators.get(ticker)
            if ind is None or date not in ind.index:
                continue
            open_price = float(ind.at[date, "open"])
            if np.isnan(open_price) or open_price <= 0:
                continue

            # 균등 배분: 현재 포트 가치의 1/MAX_POSITIONS
            alloc   = _portfolio_value(date) / MAX_POSITIONS
            shares  = (alloc / open_price) * (1 - COMMISSION)
            cost    = shares * open_price * (1 + COMMISSION)
            if cost > cash + 0.01:
                continue

            cash -= shares * open_price * (1 + COMMISSION)
            stop_price   = open_price - order["stop_dist"]
            target_price = open_price + order["target_dist"]
            positions.append(_Position(
                ticker=ticker, mode=order["mode"],
                entry_date=date, entry_price=open_price,
                stop=stop_price, target=target_price, shares=shares,
                entry_atr=order["stop_dist"] / STOP_ATR_MULT,
                highest_close=open_price,
                signal_data=order["signal_data"],
            ))
            slots_free -= 1

        buy_queue.clear()

        # ── 2. 청산 체크 ────────────────────────────────────────
        for pos in list(positions):
            ind = all_indicators.get(pos.ticker)
            if ind is None or date not in ind.index:
                pos.days_held += 1
                continue

            row   = ind.loc[date]
            close = float(row["close"])
            open_ = float(row["open"]) if pd.notna(row["open"]) else close
            pos.days_held += 1

            exit_price:  float | None = None
            exit_reason: str   | None = None
            active_stop_is_trailing = pos.trailing_active

            if not np.isnan(open_) and open_ <= pos.stop:
                # 갭다운 손절: 시가가 이미 손절가 아래
                exit_price  = open_
                exit_reason = (
                    "trailing_stop_gap" if active_stop_is_trailing else "stop_gap"
                )
            elif close <= pos.stop:
                exit_price  = pos.stop
                exit_reason = (
                    "trailing_stop" if active_stop_is_trailing else "stop"
                )
            elif close >= pos.target:
                exit_price  = pos.target
                exit_reason = "target"
            elif pos.days_held >= MAX_HOLD_DAYS:
                exit_price  = close
                exit_reason = "timeout"
            else:
                # 룰깨짐 청산
                rsi  = float(row["rsi"])  if pd.notna(row["rsi"])  else 50.0
                ma50 = float(row["ma50"]) if pd.notna(row["ma50"]) else float("nan")
                if pos.mode == "A" and not np.isnan(ma50) and close < ma50:
                    exit_price  = close
                    exit_reason = "rule_break"
                elif pos.mode == "B" and rsi > 60:
                    exit_price  = close
                    exit_reason = "rule_break"

            if exit_price is None and trailing_stop:
                # Today's close updates tomorrow's stop. This avoids using the
                # same close both to raise the stop and to trigger an exit.
                pos.highest_close = max(pos.highest_close, close)
                activation_price = (
                    pos.entry_price + trailing_activate_atr * pos.entry_atr
                )
                if pos.highest_close >= activation_price:
                    next_stop = (
                        pos.highest_close - trailing_distance_atr * pos.entry_atr
                    )
                    if next_stop > pos.stop:
                        pos.stop = next_stop
                        pos.trailing_active = True

            if exit_price is not None:
                cash += pos.shares * exit_price * (1 - COMMISSION)
                pnl_pct = (exit_price / pos.entry_price - 1) * 100
                trades.append({
                    "ticker":      pos.ticker,
                    "mode":        pos.mode,
                    "entry_date":  pos.entry_date.date(),
                    "exit_date":   date.date(),
                    "entry_price": round(pos.entry_price, 4),
                    "exit_price":  round(exit_price, 4),
                    "pnl_pct":     round(pnl_pct, 4),
                    "exit_reason": exit_reason,
                    "days_held":   pos.days_held,
                    **pos.signal_data,
                })
                positions.remove(pos)

        # ── 3. 신호 스캔 (슬롯 여유 있을 때만) ──────────────────
        if len(positions) < MAX_POSITIONS:
            spy_bear_market = True
            if "SPY" in all_indicators and date in all_indicators["SPY"].index:
                spy_row = all_indicators["SPY"].loc[date]
                spy_close = float(spy_row["close"])
                spy_ma200 = float(spy_row["ma200"]) if pd.notna(spy_row["ma200"]) else float("nan")
                # MA200 워밍업 전에는 Mode A 신규 진입을 보수적으로 차단한다.
                spy_bear_market = np.isnan(spy_ma200) or spy_close < spy_ma200

            daily_vix_percentile = float("nan")
            if "^VIX" in all_indicators and date in all_indicators["^VIX"].index:
                raw_vix_percentile = all_indicators["^VIX"].at[
                    date, "vix_percentile_252d"
                ]
                if pd.notna(raw_vix_percentile):
                    daily_vix_percentile = float(raw_vix_percentile)

            held = {p.ticker for p in positions}
            candidates: list[dict] = []
            for ticker in tickers:
                if ticker in held:
                    continue
                ind = all_indicators.get(ticker)
                if ind is None or date not in ind.index:
                    continue

                row      = ind.loc[date]
                row_dict = _to_row_dict(row)
                mode_a, mode_b = screen_snapshot(row_dict)

                # 신호일 종가로 확정된 SPY 국면만 사용한다. 다음 날 시가 체결이므로
                # 당일 이후 데이터는 참조하지 않아 look-ahead가 없다.
                if spy_bear_market:
                    mode_a = None
                if mode_a is not None and mode_a_vix_min_percentile is not None:
                    # VIX 워밍업 또는 데이터 누락 시 Mode A를 보수적으로 차단한다.
                    if (
                        np.isnan(daily_vix_percentile)
                        or daily_vix_percentile < mode_a_vix_min_percentile
                    ):
                        mode_a = None

                mode = "A" if mode_a else ("B" if mode_b else None)
                if mode is None:
                    continue

                atr = row_dict.get("atr", float("nan"))
                if np.isnan(atr) or atr <= 0:
                    continue
                atr_pct = (
                    (atr / row_dict["close"]) * 100
                    if row_dict.get("close") and not np.isnan(row_dict["close"])
                    else float("nan")
                )
                if (
                    mode == "B"
                    and mode_b_atr_max_pct is not None
                    and not np.isnan(atr_pct)
                    and atr_pct >= mode_b_atr_max_pct
                ):
                    continue

                stop_dist   = STOP_ATR_MULT * atr
                target_dist = stop_dist * TARGET_RR
                ma20_gap = (
                    (row_dict["close"] / row_dict["ma20"] - 1) * 100
                    if row_dict.get("ma20") and not np.isnan(row_dict["ma20"])
                    else float("nan")
                )
                spy_distance = float("nan")
                rs_1m = float("nan")
                rs_3m = float("nan")
                if "SPY" in all_indicators and date in all_indicators["SPY"].index:
                    spy_row = all_indicators["SPY"].loc[date]
                    spy_close = float(spy_row["close"])
                    spy_ma200 = float(spy_row["ma200"]) if pd.notna(spy_row["ma200"]) else float("nan")
                    if not np.isnan(spy_ma200) and spy_ma200 != 0:
                        spy_distance = (spy_close / spy_ma200 - 1) * 100
                    stock_ret_21 = row_dict.get("ret_21", float("nan"))
                    stock_ret_63 = row_dict.get("ret_63", float("nan"))
                    spy_ret_21 = float(spy_row["ret_21"]) if pd.notna(spy_row["ret_21"]) else float("nan")
                    spy_ret_63 = float(spy_row["ret_63"]) if pd.notna(spy_row["ret_63"]) else float("nan")
                    if not np.isnan(stock_ret_21) and not np.isnan(spy_ret_21):
                        rs_1m = stock_ret_21 - spy_ret_21
                    if not np.isnan(stock_ret_63) and not np.isnan(spy_ret_63):
                        rs_3m = stock_ret_63 - spy_ret_63

                vix_signal = {
                    "signal_vix_close": float("nan"),
                    "signal_vix_change_1d_pct": float("nan"),
                    "signal_vix_change_5d_pct": float("nan"),
                    "signal_vix_change_20d_pct": float("nan"),
                    "signal_vix_percentile_20d": float("nan"),
                    "signal_vix_percentile_60d": float("nan"),
                    "signal_vix_percentile_252d": float("nan"),
                    "signal_vix_drawdown_from_20d_high_pct": float("nan"),
                    "signal_vix_turn_down": False,
                    "signal_vix_peak_turn_10d": False,
                    "signal_vix_peak_turn_10d_drop5": False,
                }
                if "^VIX" in all_indicators and date in all_indicators["^VIX"].index:
                    vix_row = all_indicators["^VIX"].loc[date]

                    def _vix_number(column: str) -> float:
                        value = vix_row.get(column, float("nan"))
                        return round(float(value), 4) if pd.notna(value) else float("nan")

                    def _vix_flag(column: str) -> bool:
                        value = vix_row.get(column, 0)
                        return bool(value) if pd.notna(value) else False

                    vix_signal = {
                        "signal_vix_close": _vix_number("close"),
                        "signal_vix_change_1d_pct": _vix_number("vix_change_1d_pct"),
                        "signal_vix_change_5d_pct": _vix_number("vix_change_5d_pct"),
                        "signal_vix_change_20d_pct": _vix_number("vix_change_20d_pct"),
                        "signal_vix_percentile_20d": _vix_number("vix_percentile_20d"),
                        "signal_vix_percentile_60d": _vix_number("vix_percentile_60d"),
                        "signal_vix_percentile_252d": _vix_number("vix_percentile_252d"),
                        "signal_vix_drawdown_from_20d_high_pct": _vix_number(
                            "vix_drawdown_from_20d_high_pct"
                        ),
                        "signal_vix_turn_down": _vix_flag("vix_turn_down"),
                        "signal_vix_peak_turn_10d": _vix_flag("vix_peak_turn_10d"),
                        "signal_vix_peak_turn_10d_drop5": _vix_flag(
                            "vix_peak_turn_10d_drop5"
                        ),
                    }

                candidates.append({
                    "ticker":      ticker,
                    "mode":        mode,
                    "stop_dist":   stop_dist,
                    "target_dist": target_dist,
                    "selection_score_a": (
                        abs(ma20_gap - 4.0) if mode == "A" else float("nan")
                    ),
                    "selection_score_b": (
                        abs(row_dict.get("mf_ratio", float("nan")) - (-0.3))
                        if mode == "B" else float("nan")
                    ),
                    "selection_score_b_rs1m": (
                        abs(rs_1m - (-7.5))
                        if mode == "B" and not np.isnan(rs_1m)
                        else float("inf")
                    ),
                    "selection_score_b_ma50": (
                        0
                        if (
                            mode == "B"
                            and not np.isnan(row_dict.get("ma50", float("nan")))
                            and row_dict["close"] >= row_dict["ma50"] * 0.97
                        )
                        else 1
                    ),
                    "signal_data": {
                        "signal_date":        date.date(),
                        "signal_rsi":         round(row_dict.get("rsi", float("nan")), 4),
                        "signal_vol_ratio":   round(row_dict.get("vol_ratio", float("nan")), 4),
                        "signal_mf_ratio":    round(row_dict.get("mf_ratio", float("nan")), 4),
                        "signal_bb_pos":      round(row_dict.get("bb_pos", float("nan")), 4),
                        "signal_from_h52":    round(row_dict.get("from_h52", float("nan")), 4),
                        "signal_atr_pct":     round(atr_pct, 4),
                        "signal_ma20_gap_pct": round(ma20_gap, 4),
                        "signal_ma20_slope_5d_pct": round(
                            (row_dict["ma20"] / row_dict["ma20_5d"] - 1) * 100
                            if row_dict.get("ma20_5d") and not np.isnan(row_dict["ma20_5d"])
                            else float("nan"),
                            4,
                        ),
                        "signal_spy_ma200_gap_pct": round(spy_distance, 4),
                        "signal_rs_1m":         round(rs_1m, 4),
                        "signal_rs_3m":         round(rs_3m, 4),
                        "signal_mode_b_ma50_pass": (
                            mode == "B"
                            and not np.isnan(row_dict.get("ma50", float("nan")))
                            and row_dict["close"] >= row_dict["ma50"] * 0.97
                        ),
                        **vix_signal,
                    },
                })

            slots_to_queue = MAX_POSITIONS - len(positions)
            if selection in {
                "ma20-gap", "ma20-gap-clv", "ma20-gap-rs1m",
                "ma20-gap-ma50", "ma20-gap-vix-a-priority",
            }:
                # Keep the original A/B slot pattern. Only replace the Mode A
                # subsequence with candidates closest to a 4% MA20 gap.
                ranked_a = iter(sorted(
                    (candidate for candidate in candidates if candidate["mode"] == "A"),
                    key=lambda candidate: candidate["selection_score_a"],
                ))
                candidates = [
                    next(ranked_a) if candidate["mode"] == "A" else candidate
                    for candidate in candidates
                ]
                if selection == "ma20-gap-clv":
                    # Preserve the A/B slot pattern again, replacing only the
                    # Mode B subsequence with candidates closest to CLV -0.3.
                    ranked_b = iter(sorted(
                        (candidate for candidate in candidates if candidate["mode"] == "B"),
                        key=lambda candidate: candidate["selection_score_b"],
                    ))
                    candidates = [
                        next(ranked_b) if candidate["mode"] == "B" else candidate
                        for candidate in candidates
                    ]
                elif selection == "ma20-gap-rs1m":
                    # Preserve the A/B slot pattern, replacing only Mode B
                    # candidates by proximity to the exploratory RS -7.5% zone.
                    ranked_b = iter(sorted(
                        (candidate for candidate in candidates if candidate["mode"] == "B"),
                        key=lambda candidate: candidate["selection_score_b_rs1m"],
                    ))
                    candidates = [
                        next(ranked_b) if candidate["mode"] == "B" else candidate
                        for candidate in candidates
                    ]
                elif selection == "ma20-gap-ma50":
                    # Stable sort: MA50-pass Mode B candidates come first.
                    # If they are insufficient, original Mode B candidates
                    # remain as fallback, so no slot is intentionally idled.
                    ranked_b = iter(sorted(
                        (candidate for candidate in candidates if candidate["mode"] == "B"),
                        key=lambda candidate: candidate["selection_score_b_ma50"],
                    ))
                    candidates = [
                        next(ranked_b) if candidate["mode"] == "B" else candidate
                        for candidate in candidates
                    ]
                elif (
                    selection == "ma20-gap-vix-a-priority"
                    and not np.isnan(daily_vix_percentile)
                    and daily_vix_percentile >= 60
                ):
                    # VIX is identical for all stocks on a given date. Use it
                    # to prioritize Mode A as a group, then fill with Mode B.
                    candidates = sorted(
                        candidates,
                        key=lambda candidate: 0 if candidate["mode"] == "A" else 1,
                    )
            elif selection != "original":
                raise ValueError(f"Unknown selection mode: {selection}")

            buy_queue.extend(candidates[:slots_to_queue])

        # ── 4. 포트폴리오 가치 기록 ──────────────────────────────
        equity_curve[date] = _portfolio_value(date)

    # 기간 종료: 잔여 포지션 시가평가 후 기록
    for pos in positions:
        last_date  = dates[-1]
        ind        = all_indicators.get(pos.ticker)
        last_price = pos.entry_price
        if ind is not None and last_date in ind.index:
            last_price = float(ind.at[last_date, "close"])
        pnl_pct = (last_price / pos.entry_price - 1) * 100
        trades.append({
            "ticker":      pos.ticker,
            "mode":        pos.mode,
            "entry_date":  pos.entry_date.date(),
            "exit_date":   last_date.date(),
            "entry_price": round(pos.entry_price, 4),
            "exit_price":  round(last_price, 4),
            "pnl_pct":     round(pnl_pct, 4),
            "exit_reason": "end_of_period",
            "days_held":   pos.days_held,
            **pos.signal_data,
        })

    return trades, pd.Series(equity_curve)
