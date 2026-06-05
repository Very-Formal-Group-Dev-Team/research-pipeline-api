from __future__ import annotations

import argparse
import csv
import re
import string
import zipfile
from pathlib import Path
from typing import Any

import joblib
import nltk
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.multiclass import OneVsRestClassifier
from sklearn.preprocessing import MultiLabelBinarizer


BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent
DATASET_PATH = BASE_DIR / "archivum-dataset.csv"
OUTPUT_DIR = REPO_ROOT / "Backend" / "models" / "keyword_model"
MODEL_PATH = OUTPUT_DIR / "model.pkl"
VECTORIZER_PATH = OUTPUT_DIR / "vectorizer.pkl"


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


def load_training_data(dataset_path: Path) -> tuple[list[str], list[list[str]]]:
	texts: list[str] = []
	labels: list[list[str]] = []

	with dataset_path.open("r", encoding="utf-8", newline="") as handle:
		reader = csv.DictReader(handle)
		for row in reader:
			title = (row.get("title") or "").strip()
			abstract = (row.get("abstract") or "").strip()
			categories = [item for item in (row.get("categories") or "").split() if item]

			if not categories:
				continue

			text = " ".join(part for part in [title, abstract] if part).strip()
			if not text:
				continue

			texts.append(clean_text(text))
			labels.append(categories)

	if not texts:
		raise ValueError(f"No training rows were found in {dataset_path}")

	return texts, labels


def build_vectorizer() -> TfidfVectorizer:
	return TfidfVectorizer(
		lowercase=False,
		ngram_range=(1, 1),
		sublinear_tf=True,
	)


def build_model() -> OneVsRestClassifier:
	estimator = LogisticRegression(
		max_iter=2000,
		class_weight="balanced",
		solver="liblinear",
	)
	return OneVsRestClassifier(estimator)


def train(dataset_path: Path, output_dir: Path) -> dict[str, Any]:
	texts, label_sets = load_training_data(dataset_path)

	mlb = MultiLabelBinarizer()
	target_matrix = mlb.fit_transform(label_sets)

	vectorizer = build_vectorizer()
	features = vectorizer.fit_transform(texts)

	model = build_model()
	model.fit(features, target_matrix)
	model.classes_ = mlb.classes_
	if hasattr(model, "label_binarizer_"):
		model.label_binarizer_.classes_ = mlb.classes_

	output_dir.mkdir(parents=True, exist_ok=True)
	joblib.dump(vectorizer, VECTORIZER_PATH)
	joblib.dump(model, MODEL_PATH)

	return {
		"rows": len(texts),
		"labels": len(mlb.classes_),
		"features": int(features.shape[1]),
		"vectorizer_path": VECTORIZER_PATH,
		"model_path": MODEL_PATH,
	}


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Train the keyword model artifacts.")
	parser.add_argument("--dataset", type=Path, default=DATASET_PATH)
	parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
	return parser.parse_args()


def main() -> None:
	args = parse_args()
	summary = train(args.dataset, args.output_dir)
	print(f"trained on {summary['rows']} rows with {summary['labels']} labels")
	print(f"feature_count={summary['features']}")
	print(f"saved_vectorizer={summary['vectorizer_path']}")
	print(f"saved_model={summary['model_path']}")


if __name__ == "__main__":
	main()
