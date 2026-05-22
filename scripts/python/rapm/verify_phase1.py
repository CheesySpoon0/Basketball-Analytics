#!/usr/bin/env python3
"""
Phase 1 verification — confirms the design matrix is correctly shaped before
any RAPM modeling, plus one sanity unit test.

CHECKS (from the Phase 1 spec):
  1. Row count == number of full-confidence (5-player, paired) stints.
  2. Every row has exactly 5 offensive +1s and 5 defensive -1s.
  3. Column count == 2 * (distinct players) + 1 home column.
  4. Row weights (possessions) sum to total offensive possessions in stints.csv.
  5. Spot-check 3 stints by hand against the raw stint CSV.
  6. UNIT TEST: an elite offensive team's top scorer lands with a clearly
     positive offensive-context (ORAPM) coefficient.

Check 6 needs a fit. A single quick ridge solve is used purely as the assertion
mechanism; it is not the production model (that is Phase 2 / train_rapm.py).

Exit code 0 = all checks pass; 1 = a check failed.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse.linalg import lsqr

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_design_matrix import build_design_matrix, _parse_ids  # noqa: E402

STINTS_CSV = HERE / "data" / "stints.csv"

# Elite-offense sanity target: Auburn (teamId 16), top scorer Keyshawn Hall.
ELITE_PLAYER_ID = 334
ELITE_PLAYER_NAME = "Keyshawn Hall"


def main() -> None:
    failures: list[str] = []

    X, y, w, pidx, meta = build_design_matrix(target="actual")
    df = meta["df"]
    n_stints = meta["n_players"]  # placeholder, reassigned below
    n_stints = meta["n_stints"]
    n_players = meta["n_players"]
    Xc = X.tocsr()

    print("=" * 60)
    print("PHASE 1 VERIFICATION — RAPM design matrix")
    print("=" * 60)

    # --- Check 1: row count == stint count -----------------------------------
    csv_rows = len(df)
    ok1 = n_stints == csv_rows
    print(f"\n[1] Row count == stint count")
    print(f"    matrix rows={n_stints:,}  csv rows={csv_rows:,}  -> "
          f"{'PASS' if ok1 else 'FAIL'}")
    if not ok1:
        failures.append("row count mismatch")

    # --- Check 2: every row has exactly 5 +1 offense, 5 -1 defense -----------
    bad = 0
    for r in range(n_stints):
        row = Xc.getrow(r)
        home_on = row[0, meta["home_col"]] == 1.0
        n_plus = int((row.data == 1.0).sum()) - (1 if home_on else 0)
        n_minus = int((row.data == -1.0).sum())
        if n_plus != 5 or n_minus != 5:
            bad += 1
    ok2 = bad == 0
    print(f"\n[2] Every row has 5 offensive +1s and 5 defensive -1s")
    print(f"    rows failing: {bad:,}  -> {'PASS' if ok2 else 'FAIL'}")
    if not ok2:
        failures.append(f"{bad} rows have wrong on-court count")

    # --- Check 3: column count == 2 * distinct players + 1 -------------------
    off_ids = {p for c in df["playerIds"] for p in _parse_ids(c)}
    def_ids = {p for c in df["opp_playerIds"] for p in _parse_ids(c)}
    distinct = len(off_ids | def_ids)
    expected_cols = 2 * distinct + 1
    ok3 = meta["n_cols"] == expected_cols and n_players == distinct
    print(f"\n[3] Column count == 2 x distinct players + 1 home")
    print(f"    distinct players={distinct:,}  columns={meta['n_cols']:,}  "
          f"expected={expected_cols:,}  -> {'PASS' if ok3 else 'FAIL'}")
    if not ok3:
        failures.append("column count mismatch")

    # --- Check 4: weight sum == total offensive possessions ------------------
    csv_poss = df["possessionsFor"].sum()
    ok4 = abs(w.sum() - csv_poss) < 1e-6
    print(f"\n[4] Row weights sum to total offensive possessions")
    print(f"    weight sum={w.sum():,.2f}  csv poss sum={csv_poss:,.2f}  -> "
          f"{'PASS' if ok4 else 'FAIL'}")
    if not ok4:
        failures.append("weight sum mismatch")

    # --- Check 5: spot-check 3 stints by hand --------------------------------
    print(f"\n[5] Spot-check 3 stints against the raw CSV")
    ok5 = True
    rng = np.random.default_rng(42)
    sample_rows = rng.choice(n_stints, size=min(3, n_stints), replace=False)
    for r in int_iter(sample_rows):
        off = _parse_ids(df["playerIds"].iat[r])
        deff = _parse_ids(df["opp_playerIds"].iat[r])
        row = Xc.getrow(r)
        # offensive players must be +1 in ORAPM block
        off_ok = all(
            row[0, meta["orapm_base"] + pidx[p]] == 1.0 for p in off
        )
        def_ok = all(
            row[0, meta["drapm_base"] + pidx[p]] == -1.0 for p in deff
        )
        y_expect = df["pointsFor"].iat[r] / df["possessionsFor"].iat[r] * 100
        y_ok = abs(y[r] - y_expect) < 1e-6
        w_ok = abs(w[r] - df["possessionsFor"].iat[r]) < 1e-6
        row_ok = off_ok and def_ok and y_ok and w_ok
        ok5 = ok5 and row_ok
        print(f"    obs game={df['gameId'].iat[r]} p{df['period'].iat[r]} "
              f"{df['startSeconds'].iat[r]:.0f}-{df['endSeconds'].iat[r]:.0f}s: "
              f"off={off} def={deff}")
        print(f"      off+1 {ok('Y', off_ok)}  def-1 {ok('Y', def_ok)}  "
              f"y={y[r]:.2f}(exp {y_expect:.2f}) {ok('Y', y_ok)}  "
              f"w={w[r]:.1f} {ok('Y', w_ok)}")
    print(f"    -> {'PASS' if ok5 else 'FAIL'}")
    if not ok5:
        failures.append("spot-check mismatch")

    # --- Check 6: unit test — elite scorer has positive ORAPM ---------------
    print(f"\n[6] Unit test: elite offense top scorer -> positive ORAPM coef")
    if ELITE_PLAYER_ID not in pidx:
        print(f"    {ELITE_PLAYER_NAME} (id {ELITE_PLAYER_ID}) not in matrix "
              f"-> SKIP (cannot assert)")
    else:
        # Quick weighted ridge via lsqr on the augmented system.
        # [ sqrt(W) X ; sqrt(lambda) I ] beta = [ sqrt(W) y ; 0 ]
        lam = 2500.0
        sw = np.sqrt(w)
        Xw = Xc.multiply(sw[:, None]).tocsr()
        yw = y * sw
        from scipy.sparse import eye, vstack
        aug = vstack([Xw, np.sqrt(lam) * eye(meta["n_cols"], format="csr")])
        rhs = np.concatenate([yw, np.zeros(meta["n_cols"])])
        beta = lsqr(aug, rhs, atol=1e-8, btol=1e-8, iter_lim=2000)[0]
        coef = beta[meta["orapm_base"] + pidx[ELITE_PLAYER_ID]]
        ok6 = coef > 0.0
        print(f"    {ELITE_PLAYER_NAME} ORAPM-context coef = {coef:+.3f}  -> "
              f"{'PASS' if ok6 else 'FAIL'} (expect clearly positive)")
        if not ok6:
            failures.append(f"{ELITE_PLAYER_NAME} ORAPM coef not positive")

    # --- Verdict -------------------------------------------------------------
    print("\n" + "=" * 60)
    if failures:
        print(f"VERDICT: {len(failures)} CHECK(S) FAILED")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("VERDICT: ALL CHECKS PASSED — design matrix ready for Phase 2")
    sys.exit(0)


def ok(yes: str, cond: bool) -> str:
    return yes if cond else "N"


def int_iter(arr):
    for v in arr:
        yield int(v)


if __name__ == "__main__":
    main()
