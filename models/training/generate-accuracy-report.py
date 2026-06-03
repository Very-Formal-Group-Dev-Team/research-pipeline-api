from __future__ import annotations

import argparse
import csv
import json
import re
import string
import zipfile
from pathlib import Path
from typing import Any

import joblib
import matplotlib
import nltk
import numpy as np
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from sklearn.metrics import precision_recall_fscore_support


matplotlib.use("Agg")
import matplotlib.pyplot as plt


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET_PATH = BASE_DIR / "archivum-data-testing.csv"
DEFAULT_MODEL_DIR = BASE_DIR.parent / "Backend" / "models" / "keyword_model"
DEFAULT_OUTPUT_DIR = BASE_DIR / "model-confidence-report"


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


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Generate model confidence and accuracy report.")
	parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET_PATH)
	parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
	parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
	parser.add_argument("--top-k", type=int, default=5)
	parser.add_argument("--confidence-bins", type=int, default=10)
	return parser.parse_args()


def load_dataset(dataset_path: Path) -> list[dict[str, Any]]:
	records: list[dict[str, Any]] = []
	with dataset_path.open("r", encoding="utf-8", newline="") as handle:
		reader = csv.DictReader(handle)
		for index, row in enumerate(reader):
			title = (row.get("title") or "").strip()
			abstract = (row.get("abstract") or "").strip()
			categories = [item for item in (row.get("categories") or "").split() if item]
			if not categories:
				continue

			text = " ".join(part for part in [title, abstract] if part).strip()
			if not text:
				continue

			records.append(
				{
					"id": (row.get("id") or str(index)).strip(),
					"text": text,
					"labels": categories,
				}
			)

	if not records:
		raise ValueError(f"No usable rows found in dataset: {dataset_path}")

	return records


def load_artifacts(model_dir: Path) -> tuple[Any, Any]:
	model_path = model_dir / "model.pkl"
	vectorizer_path = model_dir / "vectorizer.pkl"
	if not model_path.exists():
		raise FileNotFoundError(f"Model file not found: {model_path}")
	if not vectorizer_path.exists():
		raise FileNotFoundError(f"Vectorizer file not found: {vectorizer_path}")
	return joblib.load(model_path), joblib.load(vectorizer_path)


def build_score_matrix(model: Any, x_matrix: Any) -> np.ndarray:
	if hasattr(model, "predict_proba"):
		probabilities = model.predict_proba(x_matrix)
		if isinstance(probabilities, list):
			columns = []
			for item in probabilities:
				arr = np.asarray(item)
				if arr.ndim == 2 and arr.shape[1] > 1:
					columns.append(arr[:, 1])
				else:
					columns.append(np.ravel(arr))
			scores = np.column_stack(columns)
		else:
			scores = np.asarray(probabilities)
	else:
		decision = np.asarray(model.decision_function(x_matrix))
		scores = 1.0 / (1.0 + np.exp(-decision))

	if scores.ndim == 1:
		scores = scores.reshape(-1, 1)
	return scores


def compute_confidence_bins(
	top_confidence: np.ndarray, top_correct: np.ndarray, bins: int
) -> tuple[list[dict[str, Any]], float]:
	edges = np.linspace(0.0, 1.0, bins + 1)
	bin_ids = np.digitize(top_confidence, edges[1:-1], right=False)
	stats: list[dict[str, Any]] = []
	total = float(len(top_confidence))
	ece = 0.0

	for idx in range(bins):
		mask = bin_ids == idx
		count = int(mask.sum())
		low = float(edges[idx])
		high = float(edges[idx + 1])
		if count == 0:
			accuracy = 0.0
			avg_conf = float((low + high) / 2.0)
		else:
			accuracy = float(np.mean(top_correct[mask]))
			avg_conf = float(np.mean(top_confidence[mask]))
			ece += (count / total) * abs(accuracy - avg_conf)

		stats.append(
			{
				"bin": idx,
				"range_low": low,
				"range_high": high,
				"count": count,
				"accuracy": accuracy,
				"avg_confidence": avg_conf,
			}
		)

	return stats, float(ece)


def topk_hit_rate(scores: np.ndarray, classes: np.ndarray, true_sets: list[set[str]], k: int) -> float:
	ranked = np.argsort(scores, axis=1)[:, ::-1]
	k = max(1, min(k, scores.shape[1]))
	hits = []
	for row_index, true_labels in enumerate(true_sets):
		labels = classes[ranked[row_index, :k]]
		hits.append(any(label in true_labels for label in labels))
	return float(np.mean(hits))


def evaluate(records: list[dict[str, Any]], model: Any, vectorizer: Any, top_k: int, bins: int) -> dict[str, Any]:
	cleaned_texts = [clean_text(item["text"]) for item in records]
	x_matrix = vectorizer.transform(cleaned_texts)
	scores = build_score_matrix(model, x_matrix)

	classes = np.asarray(getattr(model, "classes_", []), dtype=str)
	if classes.size == 0:
		raise RuntimeError("Model does not expose classes_.")

	true_sets = [set(item["labels"]) for item in records]
	n_samples = len(records)
	n_classes = len(classes)
	top_k = max(1, min(top_k, n_classes))

	ranked = np.argsort(scores, axis=1)[:, ::-1]
	top_indices = ranked[:, 0]
	row_ids = np.arange(n_samples)
	top_labels = classes[top_indices]
	top_confidence = scores[row_ids, top_indices]
	top_correct = np.array([label in true_sets[i] for i, label in enumerate(top_labels)], dtype=float)

	label_to_index = {label: idx for idx, label in enumerate(classes)}
	y_true = np.zeros((n_samples, n_classes), dtype=int)
	y_pred_topk = np.zeros((n_samples, n_classes), dtype=int)

	for row_index, labels in enumerate(true_sets):
		for label in labels:
			if label in label_to_index:
				y_true[row_index, label_to_index[label]] = 1

		for col_index in ranked[row_index, :top_k]:
			y_pred_topk[row_index, int(col_index)] = 1

	micro_precision, micro_recall, micro_f1, _ = precision_recall_fscore_support(
		y_true, y_pred_topk, average="micro", zero_division=0
	)
	macro_precision, macro_recall, macro_f1, _ = precision_recall_fscore_support(
		y_true, y_pred_topk, average="macro", zero_division=0
	)

	bin_stats, ece = compute_confidence_bins(top_confidence, top_correct, bins)
	brier = float(np.mean((top_confidence - top_correct) ** 2))

	top3_acc = topk_hit_rate(scores, classes, true_sets, 3)
	top5_acc = topk_hit_rate(scores, classes, true_sets, 5)

	rows: list[dict[str, Any]] = []
	for row_index, record in enumerate(records):
		predicted_topk = [str(classes[idx]) for idx in ranked[row_index, :top_k]]
		rows.append(
			{
				"id": record["id"],
				"true_labels": list(sorted(true_sets[row_index])),
				"top_prediction": str(top_labels[row_index]),
				"top_confidence": float(top_confidence[row_index]),
				"top_prediction_correct": bool(top_correct[row_index]),
				"predicted_top_k": predicted_topk,
			}
		)

	metrics = {
		"samples": n_samples,
		"classes": n_classes,
		"top_k_used": top_k,
		"top1_accuracy": float(np.mean(top_correct)),
		"top3_accuracy": top3_acc,
		"top5_accuracy": top5_acc,
		"micro_precision": float(micro_precision),
		"micro_recall": float(micro_recall),
		"micro_f1": float(micro_f1),
		"macro_precision": float(macro_precision),
		"macro_recall": float(macro_recall),
		"macro_f1": float(macro_f1),
		"mean_top_confidence": float(np.mean(top_confidence)),
		"mean_confidence_correct": float(np.mean(top_confidence[top_correct == 1])) if np.any(top_correct == 1) else 0.0,
		"mean_confidence_incorrect": float(np.mean(top_confidence[top_correct == 0])) if np.any(top_correct == 0) else 0.0,
		"ece": ece,
		"brier_top1": brier,
	}

	return {
		"metrics": metrics,
		"bins": bin_stats,
		"per_sample": rows,
		"plot_inputs": {
			"top_confidence": top_confidence,
			"top_correct": top_correct,
		},
	}


def save_visualizations(report: dict[str, Any], output_dir: Path) -> None:
	output_dir.mkdir(parents=True, exist_ok=True)
	metrics = report["metrics"]
	bins = report["bins"]
	top_conf = report["plot_inputs"]["top_confidence"]
	top_correct = report["plot_inputs"]["top_correct"]

	plt.figure(figsize=(10, 5))
	correct_conf = top_conf[top_correct == 1]
	incorrect_conf = top_conf[top_correct == 0]
	if len(correct_conf) > 0:
		plt.hist(correct_conf, bins=20, alpha=0.65, label="Correct", color="#2ca02c")
	if len(incorrect_conf) > 0:
		plt.hist(incorrect_conf, bins=20, alpha=0.65, label="Incorrect", color="#d62728")
	plt.xlabel("Top-1 confidence")
	plt.ylabel("Samples")
	plt.title("Confidence Distribution")
	plt.legend()
	plt.tight_layout()
	plt.savefig(output_dir / "confidence-distribution.png", dpi=160)
	plt.close()

	bin_centers = np.array([(b["range_low"] + b["range_high"]) / 2.0 for b in bins], dtype=float)
	bin_acc = np.array([b["accuracy"] for b in bins], dtype=float)
	bin_count = np.array([b["count"] for b in bins], dtype=float)

	fig, ax1 = plt.subplots(figsize=(8, 8))
	ax1.plot([0, 1], [0, 1], linestyle="--", color="gray", label="Perfect calibration")
	ax1.plot(bin_centers, bin_acc, marker="o", linewidth=2, color="#1f77b4", label="Empirical accuracy")
	ax1.set_xlim(0, 1)
	ax1.set_ylim(0, 1)
	ax1.set_xlabel("Confidence")
	ax1.set_ylabel("Accuracy")
	ax1.set_title("Reliability Diagram")

	ax2 = ax1.twinx()
	ax2.bar(bin_centers, bin_count, width=0.08, alpha=0.25, color="#ff7f0e", label="Bin count")
	ax2.set_ylabel("Bin count")

	lines1, labels1 = ax1.get_legend_handles_labels()
	lines2, labels2 = ax2.get_legend_handles_labels()
	ax1.legend(lines1 + lines2, labels1 + labels2, loc="lower right")
	fig.tight_layout()
	fig.savefig(output_dir / "reliability-diagram.png", dpi=160)
	plt.close(fig)

	metric_names = ["Top-1", "Top-3", "Top-5", "Micro F1", "Macro F1"]
	metric_values = [
		metrics["top1_accuracy"],
		metrics["top3_accuracy"],
		metrics["top5_accuracy"],
		metrics["micro_f1"],
		metrics["macro_f1"],
	]
	plt.figure(figsize=(9, 5))
	bars = plt.bar(metric_names, metric_values, color=["#4e79a7", "#59a14f", "#76b7b2", "#f28e2b", "#e15759"])
	for bar, value in zip(bars, metric_values):
		plt.text(bar.get_x() + bar.get_width() / 2, value + 0.01, f"{value:.3f}", ha="center", va="bottom")
	plt.ylim(0, 1.05)
	plt.ylabel("Score")
	plt.title("Model Performance Summary")
	plt.tight_layout()
	plt.savefig(output_dir / "performance-summary.png", dpi=160)
	plt.close()


def write_outputs(report: dict[str, Any], output_dir: Path) -> None:
	output_dir.mkdir(parents=True, exist_ok=True)

	json_report = {
		"metrics": report["metrics"],
		"bins": report["bins"],
	}
	with (output_dir / "confidence-report.json").open("w", encoding="utf-8") as handle:
		json.dump(json_report, handle, indent=2)

	metrics = report["metrics"]
	lines = [
		"Keyword Model Confidence Report",
		"",
		f"samples={metrics['samples']}",
		f"classes={metrics['classes']}",
		f"top_k_used={metrics['top_k_used']}",
		"",
		f"top1_accuracy={metrics['top1_accuracy']:.4f}",
		f"top3_accuracy={metrics['top3_accuracy']:.4f}",
		f"top5_accuracy={metrics['top5_accuracy']:.4f}",
		f"micro_precision={metrics['micro_precision']:.4f}",
		f"micro_recall={metrics['micro_recall']:.4f}",
		f"micro_f1={metrics['micro_f1']:.4f}",
		f"macro_precision={metrics['macro_precision']:.4f}",
		f"macro_recall={metrics['macro_recall']:.4f}",
		f"macro_f1={metrics['macro_f1']:.4f}",
		"",
		f"mean_top_confidence={metrics['mean_top_confidence']:.4f}",
		f"mean_confidence_correct={metrics['mean_confidence_correct']:.4f}",
		f"mean_confidence_incorrect={metrics['mean_confidence_incorrect']:.4f}",
		f"ece={metrics['ece']:.4f}",
		f"brier_top1={metrics['brier_top1']:.4f}",
		"",
		"Plots:",
		"- confidence-distribution.png",
		"- reliability-diagram.png",
		"- performance-summary.png",
	]
	with (output_dir / "confidence-report.txt").open("w", encoding="utf-8") as handle:
		handle.write("\n".join(lines) + "\n")

	with (output_dir / "per-sample-predictions.csv").open("w", encoding="utf-8", newline="") as handle:
		writer = csv.DictWriter(
			handle,
			fieldnames=[
				"id",
				"true_labels",
				"top_prediction",
				"top_confidence",
				"top_prediction_correct",
				"predicted_top_k",
			],
		)
		writer.writeheader()
		for row in report["per_sample"]:
			writer.writerow(
				{
					"id": row["id"],
					"true_labels": " ".join(row["true_labels"]),
					"top_prediction": row["top_prediction"],
					"top_confidence": f"{row['top_confidence']:.6f}",
					"top_prediction_correct": str(row["top_prediction_correct"]),
					"predicted_top_k": " ".join(row["predicted_top_k"]),
				}
			)


def main() -> None:
	args = parse_args()
	records = load_dataset(args.dataset)
	model, vectorizer = load_artifacts(args.model_dir)
	report = evaluate(records, model, vectorizer, top_k=args.top_k, bins=args.confidence_bins)
	write_outputs(report, args.output_dir)
	save_visualizations(report, args.output_dir)

	metrics = report["metrics"]
	print(f"report_saved={args.output_dir}")
	print(f"samples={metrics['samples']}")
	print(f"top1_accuracy={metrics['top1_accuracy']:.4f}")
	print(f"top5_accuracy={metrics['top5_accuracy']:.4f}")
	print(f"micro_f1={metrics['micro_f1']:.4f}")
	print(f"ece={metrics['ece']:.4f}")


if __name__ == "__main__":
	main()
