#!/usr/bin/env python3
"""
Phase 1b/1c — build the two-block RAPM design matrix from stints.csv.

This is pure data reshaping. No model is fit here. train_rapm.py (Phase 2)
imports build_design_matrix() and runs ridge on the output.

DESIGN (EvanMiya-style two-block matrix — the recommended v1):
  - One row per stint.
  - Column layout: 2 * n_players + 1
        [ ORAPM block: one column per player  ]
        [ DRAPM block: one column per player  ]
        [ home-court intercept column         ]
  - For a stint row:
        the 5 OFFENSIVE players  -> +1 in their ORAPM column
        the 5 DEFENSIVE players  -> -1 in their DRAPM column
        home column = +1 if the offensive team is home, else 0
  - Target y = offensive points per 100 possessions (off_ppp * 100).
  - Row weight = offensive possessions.

  A player's ORAPM is the coefficient on his ORAPM column: points/100 the
  offense scores with him on it. A player's DRAPM is the coefficient on his
  DRAPM column. Because defenders enter as -1 against an offense-points target,
  a defender who SUPPRESSES scoring gets a positive raw coefficient already
  (-1 column * negative effect on points). train_rapm.py reads DRAPM directly;
  see that file for the stored-sign convention (good D = positive DRAPM).

DUAL TARGET:
  build_design_matrix(target='actual') uses real points; target='xefg' uses
  xeFG expected points. X is identical across targets — only y changes.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
STINTS_CSV = HERE / "data" / "stints.csv"


def _parse_ids(cell: str) -> list[int]:
    return [int(x) for x in str(cell).split(",") if x != ""]


def build_design_matrix(target: str = "actual", csv_path: Path | None = None):
    """Return (X, y, weights, player_index, meta).

    X            : scipy.sparse.csr_matrix, shape (n_stints, 2*n_players + 1)
    y            : np.ndarray, offensive points per 100 possessions
    weights      : np.ndarray, offensive possessions per stint
    player_index : dict[int playerId -> int column offset within a block]
    meta         : dict with n_players, home_col index, off/def possession
                   counts per player, and the source DataFrame.
    """
    if target not in ("actual", "xefg"):
        raise ValueError(f"target must be 'actual' or 'xefg', got {target!r}")

    path = csv_path or STINTS_CSV
    if not path.exists():
        raise SystemExit(f"Missing {path} — run extract_stints.py first.")

    df = pd.read_csv(path)
    n_stints = len(df)
    if n_stints == 0:
        raise SystemExit("stints.csv is empty.")

    off_lineups = [_parse_ids(c) for c in df["playerIds"]]
    def_lineups = [_parse_ids(c) for c in df["opp_playerIds"]]

    # --- Player index: every player who appears on either side ---------------
    all_ids = sorted(
        {p for line in off_lineups for p in line}
        | {p for line in def_lineups for p in line}
    )
    player_index = {pid: i for i, pid in enumerate(all_ids)}
    n_players = len(all_ids)

    # Column layout: [0, n_players) ORAPM | [n_players, 2n) DRAPM | 2n home
    orapm_base = 0
    drapm_base = n_players
    home_col = 2 * n_players
    n_cols = 2 * n_players + 1

    # --- Build sparse COO triplets -------------------------------------------
    # Each stint contributes 5 ORAPM entries (+1), 5 DRAPM entries (-1), and
    # optionally 1 home entry (+1) -> up to 11 nonzeros per row.
    rows: list[int] = []
    cols: list[int] = []
    vals: list[float] = []

    off_poss_used = np.zeros(n_players)
    def_poss_used = np.zeros(n_players)

    for r in range(n_stints):
        opp_for = df["possessionsFor"].iat[r]
        opp_against = df["possessionsAgainst"].iat[r]
        for pid in off_lineups[r]:
            ci = orapm_base + player_index[pid]
            rows.append(r); cols.append(ci); vals.append(1.0)
            off_poss_used[player_index[pid]] += opp_for
        for pid in def_lineups[r]:
            ci = drapm_base + player_index[pid]
            rows.append(r); cols.append(ci); vals.append(-1.0)
            def_poss_used[player_index[pid]] += opp_against
        if int(df["is_home"].iat[r]) == 1:
            rows.append(r); cols.append(home_col); vals.append(1.0)

    X = sparse.coo_matrix(
        (vals, (rows, cols)), shape=(n_stints, n_cols)
    ).tocsr()

    # --- Target + weights ----------------------------------------------------
    if target == "actual":
        y = (df["off_ppp"] * 100.0).to_numpy()
    else:
        y = (df["xoff_ppp"] * 100.0).to_numpy()
    weights = df["possessionsFor"].to_numpy(dtype=float)

    meta = {
        "n_players": n_players,
        "n_stints": n_stints,
        "orapm_base": orapm_base,
        "drapm_base": drapm_base,
        "home_col": home_col,
        "n_cols": n_cols,
        "off_poss_used": off_poss_used,
        "def_poss_used": def_poss_used,
        "all_ids": all_ids,
        "df": df,
    }
    return X, y, weights, player_index, meta


def _summary() -> None:
    """Run as a script: build the matrix and print Phase 1 verification."""
    X, y, w, pidx, meta = build_design_matrix(target="actual")
    n_stints = meta["n_stints"]
    n_players = meta["n_players"]

    print("=== Phase 1 design matrix ===")
    print(f"  rows (stints):     {n_stints:,}")
    print(f"  distinct players:  {n_players:,}")
    print(f"  columns:           {meta['n_cols']:,}  "
          f"(= 2 x {n_players:,} + 1 home)")
    print(f"  nonzeros:          {X.nnz:,}")
    print(f"  weight sum (poss): {w.sum():,.0f}")
    print(f"  y mean (pts/100):  {y.mean():.2f}")

    # Per-row structure check: exactly 5 +1s and 5 -1s.
    Xc = X.tocsr()
    bad_rows = 0
    for r in range(n_stints):
        row = Xc.getrow(r)
        plus = (row.data == 1.0).sum()
        minus = (row.data == -1.0).sum()
        # +1 count is 5 ORAPM (+ possibly 1 home, also +1)
        home_on = row[0, meta["home_col"]] == 1.0
        off_plus = plus - (1 if home_on else 0)
        if off_plus != 5 or minus != 5:
            bad_rows += 1
    print(f"  rows failing 5-off / 5-def check: {bad_rows}")


if __name__ == "__main__":
    _summary()
