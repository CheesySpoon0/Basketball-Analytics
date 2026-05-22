#!/usr/bin/env python3
"""Diagnostic for Phase 2 check 4 — why does RAPM_xefg vs RAPM_actual = 0.30?

Investigates:
  (1) ORAPM and DRAPM between-target correlation separately. xeFG only alters
      OFFENSIVE points, so DRAPM_actual vs DRAPM_xefg SHOULD stay high (~0.8+).
      If DRAPM moves as much as ORAPM, that signals O/D leakage in the fit.
  (2) Net / ORAPM / DRAPM between-target correlations restricted to players
      with 500+ combined possessions, plus possession-weighted versions,
      alongside the all-player numbers.
  (3) Top 25 net RAPM by each target side by side + overlap count.
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
for env_path in [HERE / ".env", REPO_ROOT / ".env"]:
    if env_path.exists():
        load_dotenv(env_path)
        break


def _strip(url: str) -> str:
    p = urlparse(url)
    kept = [(k, v) for k, v in parse_qsl(p.query) if k.lower() != "pgbouncer"]
    return urlunparse(p._replace(query=urlencode(kept)))


def wcorr(x, y, w):
    """Possession-weighted Pearson correlation."""
    x, y, w = np.asarray(x), np.asarray(y), np.asarray(w)
    mx = np.average(x, weights=w)
    my = np.average(y, weights=w)
    cov = np.average((x - mx) * (y - my), weights=w)
    vx = np.average((x - mx) ** 2, weights=w)
    vy = np.average((y - my) ** 2, weights=w)
    return cov / np.sqrt(vx * vy)


def main() -> None:
    d = json.loads((HERE / "output" / "rapm_phase2.json").read_text())
    df = pd.DataFrame(d["players"])
    df["total_poss"] = df["off_poss_used"] + df["def_poss_used"]
    df["rapm_actual"] = df["orapm_actual"] + df["drapm_actual"]
    df["rapm_xefg"] = df["orapm_xefg"] + df["drapm_xefg"]

    print("=" * 68)
    print("CHECK 4 DIAGNOSIS — RAPM_xefg vs RAPM_actual")
    print("=" * 68)

    # --- (1) component correlations, all players ----------------------------
    print("\n(1) Between-target correlation by component (ALL 5,426 players)")
    for comp in ["orapm", "drapm", "rapm"]:
        r = np.corrcoef(df[f"{comp}_actual"], df[f"{comp}_xefg"])[0, 1]
        print(f"    {comp.upper():6s} actual vs xefg:  r = {r:.3f}")
    print("    Expectation: xeFG changes only OFFENSIVE points, so DRAPM")
    print("    should stay HIGH (~0.8+). If DRAPM ~= ORAPM, that is O/D leakage.")

    # --- (2) restricted + weighted ------------------------------------------
    hi = df[df["total_poss"] >= 500].copy()
    print(f"\n(2) Restricted to {len(hi):,} players with 500+ combined poss")
    print(f"    {'component':8s}  {'all (unwt)':>12s}  {'500+ (unwt)':>12s}  "
          f"{'500+ (wtd)':>12s}")
    for comp in ["orapm", "drapm", "rapm"]:
        r_all = np.corrcoef(df[f"{comp}_actual"], df[f"{comp}_xefg"])[0, 1]
        r_hi = np.corrcoef(hi[f"{comp}_actual"], hi[f"{comp}_xefg"])[0, 1]
        r_w = wcorr(hi[f"{comp}_actual"], hi[f"{comp}_xefg"], hi["total_poss"])
        print(f"    {comp.upper():8s}  {r_all:12.3f}  {r_hi:12.3f}  {r_w:12.3f}")
    print(f"\n    std RAPM_actual (500+): {hi['rapm_actual'].std():.3f}   "
          f"std RAPM_xefg (500+): {hi['rapm_xefg'].std():.3f}")

    # --- (3) top 25 net side by side ----------------------------------------
    url = os.environ["DATABASE_URL"]
    season = int(os.environ.get("RAPM_SEASON", "2026"))
    with psycopg2.connect(_strip(url)) as conn:
        meta = pd.read_sql(
            'SELECT p.id AS "playerId", p.name, t.school AS team '
            "FROM players p "
            'LEFT JOIN player_season_stats ps ON ps."playerId"=p.id '
            "AND ps.season=%(s)s "
            'LEFT JOIN teams t ON t.id=ps."teamId" '
            "WHERE p.id = ANY(%(ids)s)",
            conn, params={"ids": df["playerId"].tolist(), "s": season},
        )
    df = df.merge(meta, on="playerId", how="left")
    df["name"] = df["name"].fillna(df["playerId"].astype(str))

    top_a = df.sort_values("rapm_actual", ascending=False).head(25)
    top_x = df.sort_values("rapm_xefg", ascending=False).head(25)
    set_a = set(top_a["playerId"])
    set_x = set(top_x["playerId"])
    overlap = set_a & set_x

    print(f"\n(3) Top 25 net RAPM — actual vs xefg (overlap: {len(overlap)}/25)")
    print(f"    {'#':>2}  {'ACTUAL':<30}{'XEFG':<30}")
    a_list = top_a[["name", "rapm_actual"]].values
    x_list = top_x[["name", "rapm_xefg"]].values
    for i in range(25):
        an, av = a_list[i]
        xn, xv = x_list[i]
        a_mark = "*" if top_a.iloc[i]["playerId"] in set_x else " "
        x_mark = "*" if top_x.iloc[i]["playerId"] in set_a else " "
        print(f"    {i+1:>2}  {a_mark}{an[:24]:<25}{av:+5.2f}  "
              f"{x_mark}{xn[:24]:<25}{xv:+5.2f}")
    print("    (* = player also in the other target's top 25)")


if __name__ == "__main__":
    main()
