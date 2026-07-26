#!/usr/bin/env python3
"""Prove the minimum cardinality of an official card-example set cover."""

from __future__ import annotations

import json
import sys

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import lil_matrix


def main() -> None:
    payload = json.load(sys.stdin)
    candidate_ids = payload["candidateIds"]
    coverage = payload["coverage"]
    universe_count = payload["universeCount"]

    if len(candidate_ids) != len(coverage):
        raise ValueError("candidateIds and coverage length differ")
    if len(set(candidate_ids)) != len(candidate_ids):
        raise ValueError("candidateIds are not unique")

    matrix = lil_matrix((universe_count, len(candidate_ids)), dtype=float)
    for column, feature_indices in enumerate(coverage):
        for feature_index in feature_indices:
            if not 0 <= feature_index < universe_count:
                raise ValueError(f"feature index {feature_index} is out of range")
            matrix[feature_index, column] = 1.0

    result = milp(
        np.ones(len(candidate_ids), dtype=float),
        integrality=np.ones(len(candidate_ids), dtype=float),
        bounds=Bounds(
            np.zeros(len(candidate_ids), dtype=float),
            np.ones(len(candidate_ids), dtype=float),
        ),
        constraints=LinearConstraint(
            matrix.tocsr(),
            np.ones(universe_count, dtype=float),
            np.full(universe_count, np.inf, dtype=float),
        ),
        options={"mip_rel_gap": 0.0},
    )
    if not result.success or result.x is None:
        raise RuntimeError(f"set-cover MILP failed: {result.message}")

    cardinality = int(round(float(result.fun)))
    selected = [
        candidate_ids[index]
        for index, value in enumerate(result.x)
        if value > 0.5
    ]
    if len(selected) != cardinality:
        raise RuntimeError("MILP cardinality does not match selected variables")

    json.dump(
        {
            "solver": "scipy.optimize.milp/HiGHS",
            "status": int(result.status),
            "message": result.message,
            "optimalCardinality": cardinality,
            "mipGap": float(result.mip_gap),
            "mipDualBound": float(result.mip_dual_bound),
        },
        sys.stdout,
        separators=(",", ":"),
    )


if __name__ == "__main__":
    main()
