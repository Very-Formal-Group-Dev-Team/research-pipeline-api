from __future__ import annotations

import argparse
import re
import string
import zipfile
from pathlib import Path
from typing import Any, Iterable

import joblib
import nltk
import numpy as np
import pandas as pd
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from sklearn.metrics import accuracy_score, classification_report, hamming_loss
from sklearn.preprocessing import MultiLabelBinarizer
from tqdm import tqdm

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL_PATH = BASE_DIR.parent / "keyword_model" / "model.pkl"
DEFAULT_VECTORIZER_PATH = BASE_DIR.parent / "keyword_model" / "vectorizer.pkl"

TESTING_CSV_CANDIDATES = [
	"archivum-dataset-testing.csv",
	"archivum-data-testing.csv",
]

CHECKING_CSV_CANDIDATES = [
	"archivum-dataset-checking.csv",
	"archivum-data-checking.csv",
]

DEFAULT_RESULT_PATH = BASE_DIR / "archivum-dataset-result.csv"

# Keep this limit aligned with the training subset size.
TRAINING_DATA_LIMIT = 100_000
PREDICTION_THRESHOLD = 0.5


def _ensure_nltk_resources() -> None:
	resources = [
		("corpora/stopwords", "stopwords"),
		("tokenizers/punkt", "punkt"),
		("tokenizers/punkt_tab", "punkt_tab"),
	]
	for resource_path, name in resources:
		try:
			nltk.data.find(resource_path)
		except (LookupError, zipfile.BadZipFile, OSError):
			for data_path in nltk.data.path:
				archive = Path(data_path) / f"{resource_path}.zip"
				if archive.is_file():
					archive.unlink()
			nltk.download(name, quiet=True)
			nltk.data.find(resource_path)


_ensure_nltk_resources()
STOP_WORDS = set(stopwords.words("english"))
PUNCT_TABLE = str.maketrans("", "", string.punctuation)


def clean_text(text: str) -> str:
	text = (text or "").lower()
	text = text.translate(PUNCT_TABLE)
	text = re.sub(r"\s+", " ", text).strip()
	tokens = word_tokenize(text)
	filtered = [token for token in tokens if token not in STOP_WORDS and token.isalpha()]
	return " ".join(filtered)


def parse_categories(value: Any) -> list[str]:
	if value is None or (isinstance(value, float) and np.isnan(value)):
		return []
	return [token for token in str(value).split() if token]


def normalize_title(value: Any) -> str:
	return " ".join(str(value or "").split()).strip().lower()


def require_columns(df: pd.DataFrame, columns: Iterable[str], source_name: str) -> None:
	missing = [column for column in columns if column not in df.columns]
	if missing:
		raise ValueError(f"Missing required column(s) in {source_name}: {', '.join(missing)}")


def read_csv_with_required_columns(path: Path, required_columns: list[str]) -> pd.DataFrame:
	try:
		return pd.read_csv(path, usecols=required_columns, dtype=str, keep_default_na=False)
	except ValueError as error:
		raise ValueError(
			f"Unable to read required columns from {path}: {', '.join(required_columns)}"
		) from error


def resolve_input_file(base_dir: Path, candidates: list[str], explicit_path: Path | None) -> Path:
	if explicit_path is not None:
		if explicit_path.exists():
			return explicit_path
		raise FileNotFoundError(f"Input file not found: {explicit_path}")

	for candidate in candidates:
		path = base_dir / candidate
		if path.exists():
			return path

	candidate_list = ", ".join(candidates)
	raise FileNotFoundError(f"No input file found. Tried: {candidate_list}")


def build_probability_matrix(model: Any, features: Any) -> np.ndarray:
	probabilities = model.predict_proba(features)
	if isinstance(probabilities, list):
		columns: list[np.ndarray] = []
		for entry in probabilities:
			values = np.asarray(entry)
			if values.ndim == 2 and values.shape[1] >= 2:
				columns.append(values[:, 1])
			else:
				columns.append(values.ravel())
		return np.column_stack(columns)

	matrix = np.asarray(probabilities)
	if matrix.ndim == 1:
		matrix = matrix.reshape(-1, 1)
	return matrix


def get_class_labels(model: Any, probability_width: int) -> list[str]:
	classes = getattr(model, "classes_", None)
	if classes is None:
		raise RuntimeError("Trained model does not expose classes_.")

	labels = [str(item) for item in list(classes)]
	if len(labels) != probability_width:
		raise RuntimeError(
			"Mismatch between class labels and probability output width: "
			f"{len(labels)} labels vs {probability_width} columns"
		)
	return labels


def truncate_to_limit(df: pd.DataFrame, row_limit: int | None, source_name: str) -> pd.DataFrame:
	if row_limit is None or row_limit <= 0:
		return df
	if len(df) > row_limit:
		print(f"[info] {source_name}: truncating from {len(df)} to first {row_limit} rows.")
		return df.head(row_limit).copy()
	return df


def run_prediction_phase(
	testing_csv_path: Path,
	model: Any,
	vectorizer: Any,
	threshold: float,
	row_limit: int | None,
	result_path: Path,
) -> tuple[pd.DataFrame, list[set[str]], list[str]]:
	testing_df = read_csv_with_required_columns(testing_csv_path, ["title", "abstract"])
	testing_df = truncate_to_limit(testing_df, row_limit, "testing file")
	require_columns(testing_df, ["title", "abstract"], str(testing_csv_path))

	combined_texts = (
		testing_df["title"].fillna("").astype(str).str.strip()
		+ " "
		+ testing_df["abstract"].fillna("").astype(str).str.strip()
	).str.strip()

	cleaned_texts = [
		clean_text(text)
		for text in tqdm(
			combined_texts.tolist(),
			total=len(combined_texts),
			desc="Phase 1: Cleaning text",
			unit="row",
		)
	]

	features = vectorizer.transform(cleaned_texts)
	probability_matrix = build_probability_matrix(model, features)
	class_labels = get_class_labels(model, probability_matrix.shape[1])

	predicted_categories: list[str] = []
	confidence_values: list[str] = []
	predicted_sets: list[set[str]] = []

	threshold_mask = probability_matrix >= threshold
	for row_index in tqdm(
		range(len(testing_df)),
		total=len(testing_df),
		desc="Phase 1: Predicting labels",
		unit="row",
	):
		row_scores = probability_matrix[row_index]
		selected_positions = np.where(threshold_mask[row_index])[0]

		if selected_positions.size == 0:
			predicted_labels: list[str] = []
			score_parts: list[str] = []
		else:
			predicted_labels = [class_labels[position] for position in selected_positions]
			score_parts = [
				f"{class_labels[position]}:{row_scores[position]:.4f}"
				for position in selected_positions
			]

		predicted_sets.append(set(predicted_labels))
		predicted_categories.append(" ".join(predicted_labels))
		confidence_values.append("; ".join(score_parts))

	result_df = testing_df[["title", "abstract"]].copy()
	result_df["predicted_category"] = predicted_categories
	result_df["confidence"] = confidence_values

	result_df.to_csv(result_path, index=False)
	print(f"[phase 1] wrote blind prediction results: {result_path}")

	return result_df, predicted_sets, class_labels


def run_verification_phase(
	result_df: pd.DataFrame,
	predicted_sets: list[set[str]],
	class_labels: list[str],
	checking_csv_path: Path,
	result_path: Path,
	row_limit: int | None,
) -> tuple[pd.DataFrame, dict[str, float], pd.DataFrame]:
	checking_df = read_csv_with_required_columns(checking_csv_path, ["title", "abstract", "categories"])
	checking_df = truncate_to_limit(checking_df, row_limit, "checking file")
	require_columns(checking_df, ["title", "abstract", "categories"], str(checking_csv_path))

	check = checking_df[["title", "categories"]].copy()
	check["_actual_set"] = check["categories"].apply(lambda value: set(parse_categories(value)))
	check["_title_key"] = check["title"].apply(normalize_title)
	check["_title_occurrence"] = check.groupby("_title_key").cumcount()
	check["_row_id"] = np.arange(len(check))

	merged = result_df.copy()
	merged["_predicted_set"] = predicted_sets
	merged["_title_key"] = merged["title"].apply(normalize_title)
	merged["_title_occurrence"] = merged.groupby("_title_key").cumcount()
	merged["_row_id"] = np.arange(len(merged))

	merged = merged.merge(
		check[["_title_key", "_title_occurrence", "_row_id", "categories", "_actual_set"]],
		on=["_title_key", "_title_occurrence"],
		how="left",
		suffixes=("", "_check"),
		validate="one_to_one",
	)

	missing_actual = merged["_actual_set"].isna()
	if missing_actual.any():
		fallback = merged.loc[missing_actual, ["_row_id"]].merge(
			check[["_row_id", "categories", "_actual_set"]],
			on="_row_id",
			how="left",
		)
		merged.loc[missing_actual, "categories"] = fallback["categories"].values
		merged.loc[missing_actual, "_actual_set"] = fallback["_actual_set"].values

	merged["_actual_set"] = merged["_actual_set"].apply(
		lambda value: value if isinstance(value, set) else set()
	)
	merged["actual_category"] = merged["categories"].fillna("").astype(str)

	class_set = set(class_labels)
	merged["_unknown_actual_set"] = merged["_actual_set"].apply(
		lambda labels: sorted(labels - class_set)
	)
	merged["unseen_actual_categories"] = merged["_unknown_actual_set"].apply(" ".join)
	merged["has_unseen_actual_categories"] = merged["_unknown_actual_set"].apply(
		lambda labels: bool(labels)
	)

	merged["is_exact_match"] = merged.apply(
		lambda row: row["_predicted_set"] == row["_actual_set"], axis=1
	)
	merged["is_partial_match"] = merged.apply(
		lambda row: len(row["_predicted_set"] & row["_actual_set"]) > 0,
		axis=1,
	)

	actual_known_sets = merged["_actual_set"].apply(lambda labels: sorted(labels & class_set)).tolist()
	predicted_list_sets = merged["_predicted_set"].apply(lambda labels: sorted(labels)).tolist()

	mlb = MultiLabelBinarizer(classes=class_labels)
	mlb.fit([class_labels])
	y_true = mlb.transform(actual_known_sets)
	y_pred = mlb.transform(predicted_list_sets)

	subset_accuracy_value = float(accuracy_score(y_true, y_pred))
	hamming_loss_value = float(hamming_loss(y_true, y_pred))

	report = classification_report(
		y_true,
		y_pred,
		target_names=class_labels,
		output_dict=True,
		zero_division=0,
	)

	per_category_rows: list[dict[str, float | str]] = []
	for category_name in class_labels:
		category_metrics = report.get(category_name, {})
		per_category_rows.append(
			{
				"category": category_name,
				"precision": float(category_metrics.get("precision", 0.0)),
				"recall": float(category_metrics.get("recall", 0.0)),
				"f1": float(category_metrics.get("f1-score", 0.0)),
				"support": float(category_metrics.get("support", 0.0)),
			}
		)

	per_category_df = pd.DataFrame(per_category_rows)
	worst_f1_df = per_category_df.sort_values(["f1", "support", "category"]).head(10)

	exact_match_rate_value = float(merged["is_exact_match"].mean())
	partial_match_rate_value = float(merged["is_partial_match"].mean())

	merged["overall_exact_match_rate"] = exact_match_rate_value
	merged["overall_partial_match_rate"] = partial_match_rate_value
	merged["overall_subset_accuracy"] = subset_accuracy_value
	merged["overall_hamming_loss"] = hamming_loss_value

	output_columns = [
		"title",
		"abstract",
		"predicted_category",
		"confidence",
		"actual_category",
		"is_exact_match",
		"is_partial_match",
		"unseen_actual_categories",
		"has_unseen_actual_categories",
		"overall_exact_match_rate",
		"overall_partial_match_rate",
		"overall_subset_accuracy",
		"overall_hamming_loss",
	]

	merged[output_columns].to_csv(result_path, index=False)
	print(f"[phase 2] wrote enriched verification results: {result_path}")

	overall_metrics = {
		"exact_match_rate": exact_match_rate_value,
		"partial_match_rate": partial_match_rate_value,
		"subset_accuracy": subset_accuracy_value,
		"hamming_loss": hamming_loss_value,
	}

	return merged[output_columns], overall_metrics, worst_f1_df


def print_console_report(overall_metrics: dict[str, float], worst_f1_df: pd.DataFrame) -> None:
	print("\n=== Console Summary Report ===")
	print(f"Exact match rate: {overall_metrics['exact_match_rate'] * 100:.2f}%")
	print(f"Partial match rate: {overall_metrics['partial_match_rate'] * 100:.2f}%")
	print(f"Subset accuracy: {overall_metrics['subset_accuracy'] * 100:.2f}%")
	print(f"Hamming loss: {overall_metrics['hamming_loss']:.6f}")
	print("\nTop 10 worst categories by F1-score:")
	for row in worst_f1_df.itertuples(index=False):
		print(
			f"- {row.category}: f1={row.f1:.4f}, "
			f"precision={row.precision:.4f}, recall={row.recall:.4f}, support={int(row.support)}"
		)


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Evaluate multi-label category predictions in blind prediction and verification phases."
	)
	parser.add_argument("--testing-csv", type=Path, default=None)
	parser.add_argument("--checking-csv", type=Path, default=None)
	parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL_PATH)
	parser.add_argument("--vectorizer-path", type=Path, default=DEFAULT_VECTORIZER_PATH)
	parser.add_argument("--result-csv", type=Path, default=DEFAULT_RESULT_PATH)
	parser.add_argument("--threshold", type=float, default=PREDICTION_THRESHOLD)
	parser.add_argument(
		"--row-limit",
		type=int,
		default=TRAINING_DATA_LIMIT,
		help=(
			"Maximum rows to process. Default keeps evaluation aligned with the 25,000-row training subset. "
			"Set 0 or negative value to disable limit."
		),
	)
	return parser.parse_args()


def main() -> None:
	args = parse_args()

	testing_csv_path = resolve_input_file(BASE_DIR, TESTING_CSV_CANDIDATES, args.testing_csv)
	checking_csv_path = resolve_input_file(BASE_DIR, CHECKING_CSV_CANDIDATES, args.checking_csv)

	if not args.model_path.exists():
		raise FileNotFoundError(f"Model file not found: {args.model_path}")
	if not args.vectorizer_path.exists():
		raise FileNotFoundError(f"Vectorizer file not found: {args.vectorizer_path}")

	print(f"testing_csv={testing_csv_path}")
	print(f"checking_csv={checking_csv_path}")
	print(f"model_path={args.model_path}")
	print(f"vectorizer_path={args.vectorizer_path}")
	print(f"result_csv={args.result_csv}")
	print(f"threshold={args.threshold}")
	print(f"row_limit={args.row_limit}")

	model = joblib.load(args.model_path)
	vectorizer = joblib.load(args.vectorizer_path)

	result_df, predicted_sets, class_labels = run_prediction_phase(
		testing_csv_path=testing_csv_path,
		model=model,
		vectorizer=vectorizer,
		threshold=args.threshold,
		row_limit=args.row_limit,
		result_path=args.result_csv,
	)

	_, overall_metrics, worst_f1_df = run_verification_phase(
		result_df=result_df,
		predicted_sets=predicted_sets,
		class_labels=class_labels,
		checking_csv_path=checking_csv_path,
		result_path=args.result_csv,
		row_limit=args.row_limit,
	)

	print_console_report(overall_metrics, worst_f1_df)


if __name__ == "__main__":
	main()
