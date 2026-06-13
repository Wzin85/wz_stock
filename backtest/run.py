"""
WZ Stock Backtester — 메인 실행 스크립트

사용법:
  cd backtest
  pip install -r requirements.txt
  python run.py                            # 기본: 20회 반복, 5년, 150종목
  python run.py --start 202303             # 2023년 3월부터 오늘까지
  python run.py --start 202001 --end 202412
  python run.py --start 202001 --end 202412 --seeds 2061901983,523367762
  python run.py --start 2023-03-15 --end 2025-12-31  # 전체 날짜도 가능
  python run.py --iters 10 --period 3y
  python run.py --seed 42 --force-refresh

출력:
  results/trades_YYYYMMDD_HHMM.csv    — 전체 거래 기록
  results/backtest_YYYYMMDD_HHMM.png  — 수익곡선 그래프

⚠ 주의: 백테스팅 결과는 과거 성과이며 미래 수익을 보장하지 않습니다.
⚠ 생존편향: yfinance는 현재 상장된 종목만 제공합니다.
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, str(Path(__file__).parent))

from data import build_indicator_cache, download_and_cache, load_sp500_tickers
from engine import (
    BACKTEST_VERSION,
    INITIAL_CASH,
    MARKET_FILTER_VERSION,
    MODE_A_VIX_FILTER_VERSION,
    RESEARCH_DATA_VERSION,
    SELECTION_VERSIONS,
    TRAILING_ACTIVATE_ATR_DEFAULT,
    TRAILING_DISTANCE_ATR_DEFAULT,
    TRAILING_STOP_VERSION,
    run_backtest,
)
from screener import SCREENER_VERSION

import json

RESULTS_DIR = Path(__file__).parent / "results"

# 직전 실험: Mode A v2(6개 중 5개), SPY MA200 시장 필터 적용
# report_20260613_0040.txt 및 동일 6개 seed 기준.
MARKET_FILTER_BASELINE = {
    "label": "Backtest v3 / Mode A v2 / SPY MA200",
    "period": {"start": "2020-01-01", "end": "2024-12-31"},
    "seeds": [2061901983, 523367762, 1444286626, 1470519575, 2147200268, 1336994505],
    "metrics": {
        "total_return": 34.86,
        "win_rate": 48.1,
        "mdd": -22.97,
        "pnl_ratio": 1.41,
        "year_2022_return": -10.71,
    },
    "mode_stats": {
        "A": {"win_rate": 42.7, "trades": 1144},
        "B": {"win_rate": 54.7, "trades": 944},
    },
}


class _Tee:
    """print() 출력을 터미널과 파일에 동시에 씀"""
    def __init__(self, path: Path):
        self._file = open(path, "w", encoding="utf-8")
        self._stdout = sys.stdout
        sys.stdout = self

    def write(self, data: str) -> None:
        try:
            self._stdout.write(data)
        except UnicodeEncodeError:
            encoding = self._stdout.encoding or "cp949"
            safe = data.encode(encoding, errors="replace").decode(encoding)
            self._stdout.write(safe)
        self._file.write(data)

    def flush(self) -> None:
        self._stdout.flush()
        self._file.flush()

    def close(self) -> None:
        sys.stdout = self._stdout
        self._file.close()


# ── CLI 인수 ─────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="WZ Stock MODE_A/B 백테스터",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    p.add_argument("--iters",         type=int,  default=20,   help="반복 횟수 (기본: 20)")
    p.add_argument("--universe-size", type=int,  default=150,  help="반복당 랜덤 샘플 종목 수 (기본: 150)")
    p.add_argument("--period",        type=str,  default="5y", help="데이터 기간 (기본: 5y) - --start 지정 시 자동 계산")
    p.add_argument("--start",         type=str,  default=None,
                   help="백테스트 시작일\n  YYYYMM     예: 202303 => 2023-03-01\n  YYYY-MM-DD 예: 2023-03-15")
    p.add_argument("--end",           type=str,  default=None,
                   help="백테스트 종료일\n  YYYYMM     예: 202412 => 2024-12-31\n  YYYY-MM-DD 예: 2024-12-15")
    p.add_argument("--seed",          type=int,  default=None, help="전체 시드 (재현용)")
    p.add_argument("--seeds",         type=str,  default=None,
                   help="반복별 seed 목록 (쉼표 구분). 지정하면 --iters/--seed보다 우선")
    p.add_argument("--force-refresh", action="store_true",     help="캐시 무시, 재다운로드")
    p.add_argument(
        "--selection",
        choices=sorted(SELECTION_VERSIONS),
        default="ma20-gap",
        help=(
            "candidate selection: original, ma20-gap, ma20-gap-clv, "
            "ma20-gap-rs1m, ma20-gap-ma50, or "
            "ma20-gap-vix-a-priority (default: ma20-gap)"
        ),
    )
    p.add_argument(
        "--mode-b-atr-max",
        type=float,
        default=None,
        metavar="PCT",
        help="Mode B 신규 진입 ATR%% 상한 실험 (예: 5 = ATR 5%% 이상 제외)",
    )
    p.add_argument(
        "--mode-a-vix-min-percentile",
        type=float,
        default=None,
        metavar="PCT",
        help=(
            "Mode A 신규 진입 VIX 252일 최소 백분위 실험 "
            "(예: 60 = 백분위 60 이상에서만 Mode A 허용)"
        ),
    )
    trailing_group = p.add_mutually_exclusive_group()
    trailing_group.add_argument(
        "--trailing-stop",
        dest="trailing_stop",
        action="store_true",
        help=(
            "종가 기준 트레일링 스탑 사용 (v6 기본값)"
        ),
    )
    trailing_group.add_argument(
        "--no-trailing-stop",
        dest="trailing_stop",
        action="store_false",
        help="트레일링을 끄고 기존 v5 청산 규칙 재현",
    )
    p.set_defaults(trailing_stop=True)
    p.add_argument(
        "--trailing-activate-atr",
        type=float,
        default=TRAILING_ACTIVATE_ATR_DEFAULT,
        metavar="ATR",
        help="트레일링 활성화 상승폭 (기본: 1.0 ATR)",
    )
    p.add_argument(
        "--trailing-distance-atr",
        type=float,
        default=TRAILING_DISTANCE_ATR_DEFAULT,
        metavar="ATR",
        help="최고 종가 아래 트레일링 간격 (기본: 2.0 ATR)",
    )
    return p.parse_args()


def _parse_date(s: str, end_of_month: bool = False) -> str:
    """
    날짜 문자열 정규화.
      YYYYMM     → 월 첫날 (end_of_month=False) 또는 월 말일 (True)
      YYYY-MM-DD → 그대로 반환
    """
    import calendar
    s = s.strip()
    if len(s) == 6 and s.isdigit():
        year, month = int(s[:4]), int(s[4:6])
        if not (1 <= month <= 12):
            raise ValueError(f"월 오류: {month} (01~12)")
        if year < 2000 or year > datetime.today().year + 1:
            raise ValueError(f"연도 오류: {year}")
        if end_of_month:
            last = calendar.monthrange(year, month)[1]
            return f"{year:04d}-{month:02d}-{last:02d}"
        return f"{year:04d}-{month:02d}-01"
    # YYYY-MM-DD 형식 확인
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return s
    except ValueError:
        raise ValueError(f"날짜 형식 오류: '{s}' — YYYYMM 또는 YYYY-MM-DD 형식으로 입력하세요")


# ── 성과 지표 계산 ────────────────────────────────────────────────

def _calc_metrics(trades: list[dict], equity: pd.Series) -> dict:
    if not trades or equity.empty or len(equity) < 2:
        return {}

    pnls   = [t["pnl_pct"] for t in trades]
    wins   = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    win_rate  = len(wins) / len(pnls) * 100 if pnls else 0.0
    avg_win   = float(np.mean(wins))   if wins   else 0.0
    avg_loss  = float(np.mean(losses)) if losses else 0.0
    pnl_ratio = abs(avg_win / avg_loss) if avg_loss != 0 else float("inf")

    peak  = equity.cummax()
    mdd   = float(((equity - peak) / peak * 100).min())
    total = (float(equity.iloc[-1]) / float(equity.iloc[0]) - 1) * 100

    return {
        "total_trades": len(trades),
        "win_rate":     round(win_rate, 2),
        "avg_win_pct":  round(avg_win, 2),
        "avg_loss_pct": round(avg_loss, 2),
        "pnl_ratio":    round(pnl_ratio, 2),
        "total_return": round(total, 2),
        "mdd":          round(mdd, 2),
        "final_equity": round(float(equity.iloc[-1]), 2),
    }


def _yearly_breakdown(trades: list[dict], equity: pd.Series) -> pd.DataFrame:
    if equity.empty:
        return pd.DataFrame()
    equity.index = pd.to_datetime(equity.index)
    rows = []
    for year in sorted(equity.index.year.unique()):
        ye = equity[equity.index.year == year]
        if len(ye) < 2:
            continue
        ret    = (ye.iloc[-1] / ye.iloc[0] - 1) * 100
        yt     = [t for t in trades if pd.to_datetime(t["exit_date"]).year == year]
        wr     = len([t for t in yt if t["pnl_pct"] > 0]) / len(yt) * 100 if yt else 0.0
        rows.append({
            "year":       year,
            "return_pct": round(ret, 2),
            "trades":     len(yt),
            "win_rate":   round(wr, 1),
        })
    return pd.DataFrame(rows)


def _mean_yearly_returns(equity_curves: list[pd.Series]) -> dict[int, float]:
    """각 반복의 연도별 수익률을 구한 뒤 연도별 평균을 반환."""
    buckets: dict[int, list[float]] = {}
    for equity in equity_curves:
        if equity.empty:
            continue
        eq = equity.copy()
        eq.index = pd.to_datetime(eq.index)
        for year in sorted(eq.index.year.unique()):
            ye = eq[eq.index.year == year]
            if len(ye) < 2:
                continue
            ret = (float(ye.iloc[-1]) / float(ye.iloc[0]) - 1) * 100
            buckets.setdefault(int(year), []).append(ret)
    return {year: round(float(np.mean(values)), 2) for year, values in buckets.items()}


SUMMARY_FILE = RESULTS_DIR / "summary_latest.json"


def _save_summary(
    metrics: dict,
    mode_stats: dict,
    yearly_returns: dict[int, float],
    run_metadata: dict,
) -> None:
    """현재 실행 결과를 JSON으로 저장 (다음 실행 시 비교용)"""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    data = {
        "backtest_version": BACKTEST_VERSION,
        "market_filter": MARKET_FILTER_VERSION,
        "selection": run_metadata.get("selection"),
        "run": run_metadata,
        "metrics": metrics,
        "mode_stats": mode_stats,
        "yearly_returns": {str(k): v for k, v in yearly_returns.items()},
    }
    SUMMARY_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _load_prev_summary() -> dict | None:
    if SUMMARY_FILE.exists():
        try:
            return json.loads(SUMMARY_FILE.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _print_comparison(prev: dict, curr_metrics: dict, curr_mode_stats: dict) -> None:
    pm = prev.get("metrics", {})
    ps = prev.get("mode_stats", {})

    def diff(new, old, fmt="+.2f"):
        if old is None or new is None:
            return ""
        d = new - old
        return f"  ({d:{fmt}}pp)" if fmt.endswith("f") else f"  ({d:+.0f})"

    print("\n  ── Comparison: Before vs After ─────────────────────────")
    print(f"  {'Metric':<20} {'Before':>10} {'After':>10}  {'Change':>10}")
    print(f"  {'-'*54}")

    rows = [
        ("Total Return",   pm.get("total_return"), curr_metrics.get("total_return"), "+.1f"),
        ("Win Rate (All)", pm.get("win_rate"),      curr_metrics.get("win_rate"),     "+.1f"),
        ("MDD",            pm.get("mdd"),           curr_metrics.get("mdd"),          "+.1f"),
        ("PnL Ratio",      pm.get("pnl_ratio"),     curr_metrics.get("pnl_ratio"),    "+.2f"),
    ]
    for label, bef, aft, fmt in rows:
        unit = "%" if label != "PnL Ratio" else ""
        bef_s = f"{bef:{fmt}}{unit}" if bef is not None else "  n/a"
        aft_s = f"{aft:{fmt}}{unit}" if aft is not None else "  n/a"
        chg   = diff(aft, bef, fmt) if (bef is not None and aft is not None) else ""
        print(f"  {label:<20} {bef_s:>10} {aft_s:>10}  {chg}")

    print(f"  {'-'*54}")
    for mode in ["A", "B"]:
        pb = ps.get(mode, {})
        cb = curr_mode_stats.get(mode, {})
        bwr  = pb.get("win_rate")
        awr  = cb.get("win_rate")
        btrd = pb.get("trades", 0)
        atrd = cb.get("trades", 0)
        bwr_s = f"{bwr:+.1f}%" if bwr is not None else "n/a"
        awr_s = f"{awr:+.1f}%" if awr is not None else "n/a"
        chg   = diff(awr, bwr, "+.1f") if (bwr is not None and awr is not None) else ""
        print(f"  Mode {mode} Win Rate     {bwr_s:>10} {awr_s:>10}  {chg}  ({btrd}→{atrd} trades)")


def _print_market_filter_comparison(
    curr_metrics: dict,
    curr_mode_stats: dict,
    yearly_returns: dict[int, float],
    run_metadata: dict,
) -> None:
    """이번 단일 변경(SPY MA200 필터)을 직전 고정 기준과 비교."""
    baseline_period = MARKET_FILTER_BASELINE["period"]
    baseline_seeds = MARKET_FILTER_BASELINE["seeds"]
    if (
        run_metadata.get("start") != baseline_period["start"]
        or run_metadata.get("end") != baseline_period["end"]
        or run_metadata.get("seeds") != baseline_seeds
    ):
        print("\n  -- Controlled comparison skipped: period/seeds differ from baseline")
        return

    bm = MARKET_FILTER_BASELINE["metrics"]
    bs = MARKET_FILTER_BASELINE["mode_stats"]
    current_2022 = yearly_returns.get(2022)

    def delta(after, before, digits=2):
        if after is None or before is None:
            return "n/a"
        return f"{after - before:+.{digits}f}"

    print("\n  -- Mode A v3: Controlled Comparison --------------------")
    print(f"  Baseline: {MARKET_FILTER_BASELINE['label']}")
    print(f"  {'Metric':<22} {'Before':>10} {'After':>10} {'Change':>11}")
    print(f"  {'-' * 56}")
    print(
        f"  {'Total Return':<22} {bm['total_return']:>+9.2f}% "
        f"{curr_metrics.get('total_return', 0):>+9.2f}% "
        f"{delta(curr_metrics.get('total_return'), bm['total_return']):>9}pp"
    )
    print(
        f"  {'MDD':<22} {bm['mdd']:>+9.2f}% "
        f"{curr_metrics.get('mdd', 0):>+9.2f}% "
        f"{delta(curr_metrics.get('mdd'), bm['mdd']):>9}pp"
    )
    print(
        f"  {'Win Rate':<22} {bm['win_rate']:>9.1f}% "
        f"{curr_metrics.get('win_rate', 0):>9.1f}% "
        f"{delta(curr_metrics.get('win_rate'), bm['win_rate'], 1):>9}pp"
    )
    print(
        f"  {'PnL Ratio':<22} {bm['pnl_ratio']:>10.2f} "
        f"{curr_metrics.get('pnl_ratio', 0):>10.2f} "
        f"{delta(curr_metrics.get('pnl_ratio'), bm['pnl_ratio']):>11}"
    )
    if current_2022 is not None:
        print(
            f"  {'2022 Avg Return':<22} {bm['year_2022_return']:>+9.2f}% "
            f"{current_2022:>+9.2f}% "
            f"{delta(current_2022, bm['year_2022_return']):>9}pp"
        )
    print(f"  {'-' * 56}")
    for mode in ("A", "B"):
        before = bs[mode]["trades"]
        after = curr_mode_stats.get(mode, {}).get("trades", 0)
        print(
            f"  Mode {mode} Trades{'':<8} {before:>10} {after:>10} "
            f"{after - before:>+11}"
        )


def _get_spy_curve(start: str, end: str) -> pd.Series:
    try:
        spy = yf.Ticker("SPY").history(start=start, end=end, auto_adjust=True)
        if spy.empty:
            return pd.Series(dtype=float)
        spy.index = spy.index.tz_localize(None)
        c = spy["Close"].squeeze()
        return INITIAL_CASH * c / float(c.iloc[0])
    except Exception:
        return pd.Series(dtype=float)


# ── 그래프 ───────────────────────────────────────────────────────

def _plot(
    equity_curves: list[pd.Series],
    spy_curve:     pd.Series,
    out_path:      Path,
    n_iters:       int,
) -> None:
    BG   = "#070d18"
    GRID = "#182434"
    TEXT = "#607d9f"
    STRAT_COLOR = "#00e5a0"
    SPY_COLOR   = "#ff8c42"
    DD_COLOR    = "#ff4757"

    # 공통 인덱스로 정렬·보간
    all_dates = sorted(set().union(*[set(s.index) for s in equity_curves]))
    matrix    = pd.concat(
        [s.reindex(all_dates).ffill() for s in equity_curves], axis=1
    )
    mean_eq = matrix.mean(axis=1)
    std_eq  = matrix.std(axis=1)

    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(14, 9),
        gridspec_kw={"height_ratios": [3, 1]},
        facecolor=BG,
    )

    # 개별 반복 (반투명)
    for col in matrix.columns:
        ax1.plot(matrix.index, matrix[col], alpha=0.10, linewidth=0.6, color=STRAT_COLOR)

    # 평균 ± σ
    ax1.fill_between(
        mean_eq.index, mean_eq - std_eq, mean_eq + std_eq,
        alpha=0.15, color=STRAT_COLOR,
    )
    ax1.plot(mean_eq.index, mean_eq, linewidth=2.0, color=STRAT_COLOR,
             label=f"Strategy Avg (n={n_iters})")

    # SPY 비교
    if not spy_curve.empty:
        spy_al = spy_curve.reindex(all_dates).ffill()
        ax1.plot(spy_al.index, spy_al, linewidth=1.5, color=SPY_COLOR,
                 linestyle="--", label="SPY Buy & Hold")

    ax1.axhline(INITIAL_CASH, color=GRID, linewidth=0.8, linestyle=":")
    ax1.set_title("WZ Stock MODE_A/B Backtest", fontsize=13, pad=10, color="#dce8f5")
    ax1.set_ylabel("Portfolio Value ($)", color=TEXT)
    ax1.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"${x:,.0f}"))
    ax1.legend(loc="upper left", facecolor=GRID, edgecolor=GRID, labelcolor=TEXT)
    ax1.set_facecolor(BG)
    ax1.tick_params(colors=TEXT, labelsize=8)
    for s in ax1.spines.values():
        s.set_edgecolor(GRID)
    ax1.grid(alpha=0.12, color=GRID)

    # 드로다운
    peak   = mean_eq.cummax()
    dd_pct = (mean_eq - peak) / peak * 100
    ax2.fill_between(dd_pct.index, dd_pct, 0, alpha=0.55, color=DD_COLOR)
    ax2.plot(dd_pct.index, dd_pct, linewidth=0.8, color=DD_COLOR)
    ax2.set_ylabel("Drawdown (%)", color=TEXT)
    ax2.set_facecolor(BG)
    ax2.tick_params(colors=TEXT, labelsize=8)
    for s in ax2.spines.values():
        s.set_edgecolor(GRID)
    ax2.grid(alpha=0.12, color=GRID)

    plt.tight_layout(h_pad=0.5)
    plt.savefig(out_path, dpi=150, bbox_inches="tight", facecolor=BG)
    plt.close()
    print(f"  그래프 저장: {out_path.name}")


# ── 메인 ─────────────────────────────────────────────────────────

def main() -> None:
    args  = _parse_args()
    if args.mode_b_atr_max is not None and args.mode_b_atr_max <= 0:
        raise ValueError("--mode-b-atr-max는 0보다 커야 합니다")
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    tag   = datetime.today().strftime("%Y%m%d_%H%M")
    tee   = _Tee(RESULTS_DIR / f"report_{tag}.txt")

    today    = datetime.today().strftime("%Y-%m-%d")

    # ── 날짜 파싱: YYYYMM 또는 YYYY-MM-DD 모두 허용 ─────────────
    end_date   = _parse_date(args.end,   end_of_month=True)  if args.end   else today
    start_date = _parse_date(args.start, end_of_month=False) if args.start else None

    if start_date:
        # --start 지정 시 다운로드 기간을 워밍업 포함 자동 계산 (MA50 + 여유 ~180일)
        days_needed = (pd.Timestamp(end_date) - pd.Timestamp(start_date)).days + 180
        years = max(1, int(np.ceil(days_needed / 365)))
        args.period = f"{years}y"
    else:
        years      = int(args.period.replace("y", "")) if args.period.endswith("y") else 5
        start_date = str(pd.Timestamp(end_date) - pd.DateOffset(years=years))[:10]

    sep = "═" * 62
    print(f"\n{sep}")
    print("  WZ STOCK BACKTESTER  (MODE_A 추세추종 / MODE_B 역추세반등)")
    print(sep)
    selection_version = SELECTION_VERSIONS[args.selection]
    print(
        f"  Backtest [{BACKTEST_VERSION}]  market-filter={MARKET_FILTER_VERSION}  "
        f"selection={selection_version}"
    )
    print(f"  Research data: {RESEARCH_DATA_VERSION}")
    atr_filter_label = (
        f"ATR < {args.mode_b_atr_max:g}%"
        if args.mode_b_atr_max is not None
        else "off"
    )
    print(f"  Mode B ATR filter: {atr_filter_label}")
    vix_filter_label = (
        (
            f"{MODE_A_VIX_FILTER_VERSION} "
            f"(VIX 252d percentile >= {args.mode_a_vix_min_percentile:g})"
        )
        if args.mode_a_vix_min_percentile is not None
        else "off"
    )
    print(f"  Mode A VIX filter: {vix_filter_label}")
    if args.trailing_activate_atr <= 0 or args.trailing_distance_atr <= 0:
        raise ValueError("트레일링 ATR 값은 0보다 커야 합니다")
    trailing_label = (
        (
            f"{TRAILING_STOP_VERSION} "
            f"(activate={args.trailing_activate_atr:g}, "
            f"distance={args.trailing_distance_atr:g})"
        )
        if args.trailing_stop
        else "off"
    )
    print(f"  Trailing stop: {trailing_label}")
    for mode, info in SCREENER_VERSION.items():
        conds = ", ".join(info["conditions"])
        print(f"  Mode {mode} [{info['ver']}]  pass={info['min_pass']}  {conds}")
    print(f"{'─' * 62}")
    print(f"  기간        : {start_date} ~ {end_date}")
    iteration_seeds = None
    if args.seeds:
        try:
            iteration_seeds = [int(x.strip()) for x in args.seeds.split(",") if x.strip()]
        except ValueError as exc:
            raise ValueError("--seeds는 정수 seed를 쉼표로 구분해야 합니다") from exc
        if not iteration_seeds:
            raise ValueError("--seeds에 최소 하나의 seed가 필요합니다")
        args.iters = len(iteration_seeds)

    print(f"  반복        : {args.iters}회 × 랜덤 {args.universe_size}종목")
    if iteration_seeds:
        print(f"  반복 seeds  : {','.join(str(x) for x in iteration_seeds)}")
    print(f"  초기자금    : ${INITIAL_CASH:,.0f}  |  최대 포지션 5개  |  수수료 0.1%")
    print(f"  ⚠ 생존편향 주의: yfinance는 현재 상장 종목만 제공합니다.")
    print(f"{'─' * 62}\n")

    # ── 1. 데이터 로드 & 지표 계산 ──────────────────────────────
    sp500 = load_sp500_tickers()
    print(f"  S&P 500 풀: {len(sp500)}종목")

    # ^VIX는 전략 조건이 아니라 진입 시점 시장 레짐을 기록하기 위한 연구 데이터다.
    all_tickers = list(dict.fromkeys(["SPY", "^VIX"] + sp500))
    raw = download_and_cache(
        all_tickers,
        start_date=start_date,
        end_date=end_date,
        force_refresh=args.force_refresh,
    )
    print(f"  캐시: {len(raw)}개 완료")

    print("  지표 계산 중...", end=" ", flush=True)
    all_indicators = build_indicator_cache(raw, force_refresh=args.force_refresh)
    valid = [t for t in sp500 if t in all_indicators]
    print(f"{len(valid)}개 완료\n")

    universe_size = min(args.universe_size, len(valid))

    # SPY 비교 곡선
    spy_curve = _get_spy_curve(start_date, end_date)
    if not spy_curve.empty:
        spy_ret = (float(spy_curve.iloc[-1]) / INITIAL_CASH - 1) * 100
    else:
        spy_ret = float("nan")

    # ── 2. N회 반복 백테스트 ────────────────────────────────────
    rng_master     = random.Random(args.seed)
    all_trades:    list[list[dict]] = []
    all_equity:    list[pd.Series]  = []
    actual_seeds:  list[int] = []

    for i in range(args.iters):
        seed_i  = iteration_seeds[i] if iteration_seeds else rng_master.randint(0, 2**31 - 1)
        actual_seeds.append(seed_i)
        sample  = random.Random(seed_i).sample(valid, universe_size)
        print(f"  [{i+1:2d}/{args.iters}] seed={seed_i}", end="  ", flush=True)

        trades, equity = run_backtest(
            sample,
            all_indicators,
            start_date,
            end_date,
            selection=args.selection,
            mode_b_atr_max_pct=args.mode_b_atr_max,
            mode_a_vix_min_percentile=args.mode_a_vix_min_percentile,
            trailing_stop=args.trailing_stop,
            trailing_activate_atr=args.trailing_activate_atr,
            trailing_distance_atr=args.trailing_distance_atr,
        )
        for trade in trades:
            trade["iteration"] = i + 1
            trade["seed"] = seed_i
        all_trades.append(trades)
        all_equity.append(equity)

        m = _calc_metrics(trades, equity)
        print(
            f"{m.get('total_trades', 0):3d}건  "
            f"수익 {m.get('total_return', 0):+6.1f}%  "
            f"승률 {m.get('win_rate', 0):5.1f}%  "
            f"MDD {m.get('mdd', 0):6.1f}%"
        )

    run_metadata = {
        "start": start_date,
        "end": end_date,
        "universe_size": universe_size,
        "seeds": actual_seeds,
        "selection": selection_version,
        "research_data": RESEARCH_DATA_VERSION,
        "mode_b_atr_max_pct": args.mode_b_atr_max,
        "mode_a_vix_min_percentile": args.mode_a_vix_min_percentile,
        "trailing_stop": (
            {
                "version": TRAILING_STOP_VERSION,
                "activate_atr": args.trailing_activate_atr,
                "distance_atr": args.trailing_distance_atr,
            }
            if args.trailing_stop
            else None
        ),
    }

    print(f"\n{'─' * 62}")

    # ── 3. 집계 & 출력 ──────────────────────────────────────────
    prev_summary = _load_prev_summary()

    flat_trades  = [t for run in all_trades for t in run]
    metrics_list = [_calc_metrics(tr, eq) for tr, eq in zip(all_trades, all_equity) if tr]

    def _ms(key: str) -> tuple[float, float]:
        vals = [m[key] for m in metrics_list if key in m]
        return (float(np.mean(vals)), float(np.std(vals))) if vals else (0.0, 0.0)

    print("\n  ── 전략 성과 (N회 평균 ± 표준편차) ──────────────────────")
    for key, label, fmt in [
        ("total_return", "누적 수익률",   "{mu:+.2f}% ± {sd:.2f}%"),
        ("win_rate",     "승률",          "{mu:.1f}% ± {sd:.1f}%"),
        ("pnl_ratio",    "평균 손익비",   "{mu:.2f} ± {sd:.2f}"),
        ("mdd",          "최대 드로다운", "{mu:.2f}% ± {sd:.2f}%"),
        ("total_trades", "총 거래 수",    "{mu:.0f} ± {sd:.0f}"),
    ]:
        mu, sd = _ms(key)
        print(f"    {label:<14} : {fmt.format(mu=mu, sd=sd)}")

    print(f"\n  SPY 단순보유 수익률   : {spy_ret:+.2f}%" if not np.isnan(spy_ret) else "")
    strat_mu, _ = _ms("total_return")
    if not np.isnan(spy_ret):
        print(f"  전략 초과 수익       : {strat_mu - spy_ret:+.2f}%p")

    # 모드별 통계
    curr_mode_stats: dict = {}
    print()
    for mode, name in [("A", "추세추종"), ("B", "역추세반등")]:
        mt = [t for t in flat_trades if t["mode"] == mode]
        if mt:
            wr_ = sum(1 for t in mt if t["pnl_pct"] > 0) / len(mt) * 100
            avg = float(np.mean([t["pnl_pct"] for t in mt]))
            curr_mode_stats[mode] = {"win_rate": round(wr_, 2), "trades": len(mt), "avg_pnl": round(avg, 2)}
            print(f"  Mode {mode} ({name}): {len(mt)}건  승률 {wr_:.1f}%  평균 {avg:+.2f}%")

    yearly_returns = _mean_yearly_returns(all_equity)

    # 청산 사유
    reasons: dict[str, int] = {}
    for t in flat_trades:
        reasons[t["exit_reason"]] = reasons.get(t["exit_reason"], 0) + 1
    print(f"\n  청산 사유: {dict(sorted(reasons.items(), key=lambda x: -x[1]))}")

    # 이전 결과 비교
    curr_avg_metrics = {k: round(_ms(k)[0], 2) for k in ("total_return", "win_rate", "mdd", "pnl_ratio")}
    _print_market_filter_comparison(
        curr_avg_metrics,
        curr_mode_stats,
        yearly_returns,
        run_metadata,
    )

    if prev_summary and prev_summary.get("run") == run_metadata:
        _print_comparison(prev_summary, curr_avg_metrics, curr_mode_stats)
    else:
        print("\n  (동일 기간·동일 seed의 이전 실행 결과 없음)")

    # 이번 결과 저장
    _save_summary(curr_avg_metrics, curr_mode_stats, yearly_returns, run_metadata)

    # 연도별 — 수익 최고·최저 회차
    if metrics_list and all_trades and all_equity:
        best_i  = max(range(len(metrics_list)), key=lambda i: metrics_list[i].get("total_return", -999))
        worst_i = min(range(len(metrics_list)), key=lambda i: metrics_list[i].get("total_return",  999))
        for label, idx in [("Best", best_i), ("Worst", worst_i)]:
            yb = _yearly_breakdown(all_trades[idx], all_equity[idx])
            if not yb.empty:
                ret = metrics_list[idx]["total_return"]
                print(f"\n  ── Yearly Breakdown  [{label}  iter {idx+1}  total {ret:+.1f}%] ──")
                print(yb.to_string(index=False))

    # ── 4. 저장 ─────────────────────────────────────────────────
    if flat_trades:
        csv_path = RESULTS_DIR / f"trades_{tag}.csv"
        pd.DataFrame(flat_trades).to_csv(csv_path, index=False)
        print(f"\n  trades : {csv_path.name}")

    if all_equity:
        plot_path = RESULTS_DIR / f"backtest_{tag}.png"
        _plot(all_equity, spy_curve, plot_path, args.iters)

    print(f"  report : report_{tag}.txt")
    print(f"\n  WARNING: past performance does not guarantee future results.")
    print(f"  WARNING: survivorship bias - delisted stocks are excluded.\n")

    tee.close()


if __name__ == "__main__":
    main()
