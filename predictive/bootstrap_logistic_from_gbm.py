from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression


FEATURE_ORDER = [
    "offense_id",
    "description",
    "sanction",
    "evidence",
    "status",
    "active",
    "incident_year",
    "incident_month",
    "incident_day",
    "incident_dayofweek",
]


def _encoder_cardinality(encoder_obj) -> int:
    if hasattr(encoder_obj, "classes_"):
        return max(1, len(encoder_obj.classes_))
    if isinstance(encoder_obj, dict):
        return max(1, len(encoder_obj))
    return 1


def build_synthetic_matrix(label_encoders: dict, sample_size: int, random_state: int) -> np.ndarray:
    rng = np.random.default_rng(random_state)

    description_max = _encoder_cardinality(label_encoders.get("description"))
    sanction_max = _encoder_cardinality(label_encoders.get("sanction"))
    evidence_max = _encoder_cardinality(label_encoders.get("evidence"))
    status_max = _encoder_cardinality(label_encoders.get("status"))

    offense_ids = rng.integers(0, 250, size=sample_size)
    descriptions = rng.integers(0, description_max, size=sample_size)
    sanctions = rng.integers(0, sanction_max, size=sample_size)
    evidences = rng.integers(0, evidence_max, size=sample_size)
    statuses = rng.integers(0, status_max, size=sample_size)
    active = rng.integers(0, 2, size=sample_size)
    incident_year = rng.integers(2023, 2027, size=sample_size)
    incident_month = rng.integers(1, 13, size=sample_size)
    incident_day = rng.integers(1, 32, size=sample_size)
    incident_dayofweek = rng.integers(0, 7, size=sample_size)

    matrix = np.column_stack(
        [
            offense_ids,
            descriptions,
            sanctions,
            evidences,
            statuses,
            active,
            incident_year,
            incident_month,
            incident_day,
            incident_dayofweek,
        ]
    ).astype(np.int64)

    return matrix


def bootstrap_logistic(
    gbm_model_path: Path,
    label_encoders_path: Path,
    output_model_path: Path,
    output_report_path: Path,
    sample_size: int,
    random_state: int,
) -> None:
    gbm_model = joblib.load(gbm_model_path)
    label_encoders = joblib.load(label_encoders_path)

    x = build_synthetic_matrix(label_encoders, sample_size=sample_size, random_state=random_state)

    gbm_prob = gbm_model.predict_proba(x)[:, 1]
    y = (gbm_prob >= 0.5).astype(np.int64)

    if np.unique(y).size < 2:
        raise RuntimeError(
            "Bootstrap label generation produced one class only. "
            "Increase sample size or verify the GBM artifact outputs." 
        )

    logistic = LogisticRegression(
        max_iter=1200,
        solver="liblinear",
        class_weight="balanced",
        random_state=random_state,
    )
    logistic.fit(x, y)

    output_model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(logistic, output_model_path)

    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": "bootstrap_distillation_from_gbm",
        "input_gbm_model": str(gbm_model_path),
        "input_label_encoders": str(label_encoders_path),
        "output_logistic_model": str(output_model_path),
        "feature_order": FEATURE_ORDER,
        "sample_size": int(sample_size),
        "random_state": int(random_state),
        "gbm_probability_mean": float(np.mean(gbm_prob)),
        "gbm_probability_std": float(np.std(gbm_prob)),
        "distilled_positive_rate": float(np.mean(y)),
        "note": "Bootstrap model for immediate integration/testing only. Retrain with real labeled data as soon as sufficient records exist.",
    }

    output_report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bootstrap a logistic model by distilling labels from an existing GBM model."
    )
    parser.add_argument("--gbm-model", default="gradient_boosting_model.pkl", help="Path to GBM model artifact.")
    parser.add_argument("--label-encoders", default="label_encoders.pkl", help="Path to label encoders artifact.")
    parser.add_argument("--output-model", default="logistic_repeat_model.pkl", help="Output path for logistic model artifact.")
    parser.add_argument("--output-report", default="bootstrap_logistic_report.json", help="Output path for bootstrap report JSON.")
    parser.add_argument("--sample-size", type=int, default=12000, help="Number of synthetic rows for distillation.")
    parser.add_argument("--random-state", type=int, default=42, help="Random seed.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    bootstrap_logistic(
        gbm_model_path=Path(args.gbm_model).expanduser().resolve(),
        label_encoders_path=Path(args.label_encoders).expanduser().resolve(),
        output_model_path=Path(args.output_model).expanduser().resolve(),
        output_report_path=Path(args.output_report).expanduser().resolve(),
        sample_size=max(2000, int(args.sample_size)),
        random_state=int(args.random_state),
    )

    print("Bootstrap logistic model generated.")
    print(f"Model: {Path(args.output_model).expanduser().resolve()}")
    print(f"Report: {Path(args.output_report).expanduser().resolve()}")


if __name__ == "__main__":
    main()
