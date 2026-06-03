from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

def _normalize_text(value: str) -> str:
	return " ".join(value.split())

def _is_scalar(value: Any) -> bool:
	return value is None or isinstance(value, (str, int, float, bool))

def _normalize_value(value: Any) -> str:
	if value is None:
		return ""
	if isinstance(value, str):
		return _normalize_text(value)
	return str(value)

def _force_text_key(key: str) -> bool:
	lower_key = key.lower()
	return lower_key == "id" or lower_key.endswith("_id")

@dataclass
class _ProgressTracker:
	total: int
	label: str
	interval: int = 5000
	last_reported: int = 0

	def update(self, current: int) -> None:
		if current == self.total:
			print(f"{self.label}: {current}/{self.total}", file=sys.stderr)
			self.last_reported = current
			return

		if current - self.last_reported >= self.interval:
			print(f"{self.label}: {current}/{self.total}", file=sys.stderr)
			self.last_reported = current


def _flatten_value(value: Any, prefix: str, flattened: dict[str, str], list_separator: str = "; ") -> None:
	if isinstance(value, dict):
		if not value and prefix:
			flattened[prefix] = ""
		for key, nested_value in value.items():
			nested_prefix = f"{prefix}.{key}" if prefix else str(key)
			_flatten_value(nested_value, nested_prefix, flattened, list_separator)
		return

	if isinstance(value, list):
		if not value:
			flattened[prefix] = ""
			return

		if all(_is_scalar(item) for item in value):
			flattened[prefix] = list_separator.join(
				_normalize_value(item) for item in value if _normalize_value(item)
			)
			return

		flattened[prefix] = json.dumps(value, ensure_ascii=False)
		return

	flattened[prefix] = _normalize_value(value)


def _prepare_record(record: dict[str, Any]) -> dict[str, str]:
	flattened: dict[str, str] = {}
	for key, value in record.items():
		_flatten_value(value, key, flattened)
	for key in list(flattened.keys()):
		if _force_text_key(key) and flattened[key]:
			flattened[key] = f"'{flattened[key]}"
	return flattened


def _load_jsonl_records(
	handle: Any,
	json_path: Path,
	start_line: int,
	end_line: int,
) -> tuple[list[dict[str, Any]], int]:
	records: list[dict[str, Any]] = []
	skipped_lines = 0
	total_records = end_line - start_line + 1
	progress = _ProgressTracker(total=total_records, label="Parsing JSONL records")

	for line_number, line in enumerate(handle, start=1):
		if line_number < start_line:
			continue
		if line_number > end_line:
			break

		line = line.strip()
		if not line:
			continue
		try:
			record = json.loads(line)
		except json.JSONDecodeError as error:
			skipped_lines += 1
			print(f"Skipping invalid JSON on line {line_number} in {json_path}: {error}", file=sys.stderr)
			continue
		if not isinstance(record, dict):
			skipped_lines += 1
			print(f"Skipping non-object JSON on line {line_number} in {json_path}.", file=sys.stderr)
			continue
		records.append(record)
		progress.update(len(records))

	return records, skipped_lines


def _load_records(json_path: Path, start_line: int, end_line: int) -> tuple[list[dict[str, Any]], int]:
	with json_path.open("r", encoding="utf-8-sig") as handle:
		while True:
			character = handle.read(1)
			if not character:
				return [], 0
			if not character.isspace():
				break

		if character == "[":
			try:
				records = json.load(handle)
			except json.JSONDecodeError as error:
				raise ValueError(f"Invalid JSON array in {json_path}: {error}") from error
			if not isinstance(records, list):
				raise ValueError("Expected a JSON array or JSONL file.")
			selected_records = [record for record in records if isinstance(record, dict)]
			return selected_records[start_line - 1 : end_line], 0

		handle.seek(0)
		return _load_jsonl_records(handle, json_path, start_line, end_line)


def convert_json_to_csv(
	input_path: str,
	output_path: str | None = None,
	start_line: int = 1000,
	end_line: int = 2000,
) -> Path:
	json_path = Path(input_path).expanduser().resolve()
	if not json_path.exists():
		raise FileNotFoundError(f"Input file not found: {json_path}")
	if start_line < 1:
		raise ValueError("start_line must be 1 or greater.")
	if end_line < start_line:
		raise ValueError("end_line must be greater than or equal to start_line.")

	print(f"Loading {json_path.name} lines {start_line}-{end_line}...", file=sys.stderr)
	records, skipped_lines = _load_records(json_path, start_line, end_line)
	print(f"Preparing {len(records)} record(s)...", file=sys.stderr)
	prepared_records = [_prepare_record(record) for record in records]
	csv_path = (
		Path(output_path).expanduser().resolve()
		if output_path
		else Path.cwd() / "archivum-data-testing.csv"
	)

	headers: list[str] = []
	seen: set[str] = set()
	for record in prepared_records:
		for key in record.keys():
			if key not in seen:
				seen.add(key)
				headers.append(key)

	with csv_path.open("w", newline="", encoding="utf-8") as csv_file:
		writer = csv.DictWriter(
			csv_file,
			fieldnames=headers,
			extrasaction="ignore",
			quoting=csv.QUOTE_ALL,
			quotechar='"',
			doublequote=True,
			lineterminator="\n",
		)
		writer.writeheader()
		progress = _ProgressTracker(total=len(prepared_records), label="Writing CSV rows")
		for row_number, record in enumerate(prepared_records, start=1):
			writer.writerow({key: record.get(key, "") for key in headers})
			progress.update(row_number)

	if skipped_lines:
		print(f"Skipped {skipped_lines} invalid line(s).", file=sys.stderr)

	return csv_path


def main() -> None:
	parser = argparse.ArgumentParser(description="Convert JSONL or JSON array files to an Altair-friendly CSV.")
	parser.add_argument("input_path", nargs="?", help="Path to the JSON or JSONL file")
	parser.add_argument("output_path", nargs="?", help="Optional output CSV path")
	parser.add_argument("--start-line", type=int, default=1000, help="First line to export (default: 1000)")
	parser.add_argument("--end-line", type=int, default=2000, help="Last line to export (default: 2000)")
	args = parser.parse_args()

	input_path = args.input_path or input("Enter the JSON file path: ").strip()
	if not input_path:
		raise SystemExit("No input file path provided.")

	csv_path = convert_json_to_csv(input_path, args.output_path, args.start_line, args.end_line)
	print(f"Wrote CSV file: {csv_path}")


if __name__ == "__main__":
	main()
