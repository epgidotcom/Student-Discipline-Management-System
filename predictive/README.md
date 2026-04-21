# Predictive Service (GBM + Logistic)

This folder supports:
- live inference via FastAPI (`/infer`)
- model artifacts for both Gradient Boosting and Logistic Regression
- bootstrap logistic generation when no labeled training data is available yet

## 1) Build models now (no labeled dataset yet)

Current reality: the new SDMS database has no violations yet, so supervised logistic training cannot run from real labels.

Use this bootstrap flow now:

1. Keep baseline Gradient Boosting artifact:
- `gradient_boosting_model.pkl`
- `label_encoders.pkl`
- `feature_columns.pkl`

2. Generate a bootstrap Logistic model distilled from GBM behavior:

```bash
python bootstrap_logistic_from_gbm.py \
  --gbm-model gradient_boosting_model.pkl \
  --label-encoders label_encoders.pkl \
  --output-model logistic_repeat_model.pkl \
  --output-report bootstrap_logistic_report.json
```

This is for immediate integration/testing only. Retrain with real labeled data once sufficient history exists.

## 2) Train models from real labeled data (recommended production path)

Required feature columns:
- offense_id
- description
- sanction
- evidence
- status
- active
- incident_year
- incident_month
- incident_day
- incident_dayofweek

Required target column:
- repeat_violation_target (0/1)

Train Logistic Regression:

```bash
python train_logistic_model.py \
  --input-csv <path-to-training.csv> \
  --target-column repeat_violation_target \
  --output-dir artifacts/logistic_v1 \
  --model-name logistic_repeat_model
```

Train Gradient Boosting:

```bash
python train_gradient_boosting_model.py \
  --input-csv <path-to-training.csv> \
  --target-column repeat_violation_target \
  --output-dir artifacts/gbm_v1 \
  --model-name gradient_boosting_model
```

## 3) Run as ensemble

Example (PowerShell):

```powershell
$env:MODEL_1_PATH = "./gradient_boosting_model.pkl"
$env:MODEL_2_PATH = "./logistic_repeat_model.pkl"
$env:MODEL_3_PATH = ""
$env:LABEL_ENCODERS_PATH = "./label_encoders.pkl"
$env:FEATURE_COLUMNS_PATH = "./feature_columns.pkl"
$env:MODEL_WEIGHTS = "0.7,0.3"
$env:MODEL_VERSION = "ensemble-gbm-logistic-v1"
uvicorn app:app --host 0.0.0.0 --port 8000
```

## 4) Rollout guidance

1. Start shadow-style with `MODEL_WEIGHTS=1.0,0.0`.
2. Validate live outputs and persistence in backend prediction tables.
3. Move to blended weights like `0.8,0.2`.
4. Retrain both models using real SDMS labels and promote.
