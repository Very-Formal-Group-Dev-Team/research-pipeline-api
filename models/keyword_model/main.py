from pathlib import Path
import re
import string
import zipfile
from typing import Any

import joblib
import nltk
import numpy as np
from fastapi import FastAPI
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model.pkl"
VECTORIZER_PATH = BASE_DIR / "vectorizer.pkl"

_cached_model: Any = None
_cached_vectorizer: Any = None


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


def load_model() -> Any:
    global _cached_model
    if _cached_model is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")
        _cached_model = joblib.load(MODEL_PATH)
    return _cached_model


def load_vectorizer() -> Any:
    global _cached_vectorizer
    if _cached_vectorizer is None:
        if not VECTORIZER_PATH.exists():
            raise FileNotFoundError(f"Vectorizer file not found: {VECTORIZER_PATH}")
        _cached_vectorizer = joblib.load(VECTORIZER_PATH)
    return _cached_vectorizer


def clean_text(text: str) -> str:
    text = (text or "").lower()
    text = text.translate(PUNCT_TABLE)
    text = re.sub(r"\s+", " ", text).strip()

    tokens = word_tokenize(text)
    filtered = [token for token in tokens if token not in STOP_WORDS and token.isalpha()]
    return " ".join(filtered)


def predict_with_vectorization(text: str, top_k: int = 5) -> dict[str, Any]:
    cleaned = clean_text(text)
    if not cleaned:
        return {
            "keywords": [],
            "predicted_labels": [],
            "vectorization": {"shape": [1, 0], "non_zero": 0, "top_terms": []},
        }

    model = load_model()
    vectorizer = load_vectorizer()
    x_matrix = vectorizer.transform([cleaned])

    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(x_matrix)
        if isinstance(probabilities, list):
            scores = np.array([p[:, 1] for p in probabilities]).ravel()
        else:
            scores = np.ravel(probabilities)
    else:
        scores = np.ravel(model.decision_function(x_matrix))

    classes = getattr(model, "classes_", None)
    if classes is None:
        raise RuntimeError("Trained model does not expose classes_.")

    ranked_indices = np.argsort(scores)[::-1]
    predicted_labels = [str(classes[i]) for i in ranked_indices[:top_k] if scores[i] > 0]

    feature_names = vectorizer.get_feature_names_out()
    vector_values = x_matrix.toarray()[0]
    top_term_indices = np.argsort(vector_values)[::-1]
    top_terms = [
        {"term": str(feature_names[i]), "value": float(vector_values[i])}
        for i in top_term_indices[:10]
        if vector_values[i] > 0
    ]

    keywords = [item["term"] for item in top_terms[:top_k]]
    return {
        "keywords": keywords,
        "predicted_labels": predicted_labels,
        "vectorization": {
            "shape": [int(x_matrix.shape[0]), int(x_matrix.shape[1])],
            "non_zero": int(x_matrix.nnz),
            "top_terms": top_terms,
        },
    }


class PredictRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Extracted paper text or abstract")
    top_k: int = Field(default=5, ge=1, le=20)


class PredictResponse(BaseModel):
    keywords: list[str]


class VectorizationItem(BaseModel):
    term: str
    value: float

class VectorizationResponse(BaseModel):
    shape: list[int]
    non_zero: int
    top_terms: list[VectorizationItem]


class PredictDetailedResponse(BaseModel):
    keywords: list[str]
    predicted_labels: list[str] = []
    vectorization: VectorizationResponse


app = FastAPI(title="AI Keyword Prediction Service", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/predict-keywords", response_model=PredictResponse)
def predict(payload: PredictRequest) -> PredictResponse:
    result = predict_with_vectorization(payload.text, top_k=payload.top_k)
    return PredictResponse(keywords=result["keywords"])


@app.post("/predict-keywords-detailed", response_model=PredictDetailedResponse)
def predict_detailed(payload: PredictRequest) -> PredictDetailedResponse:
    result = predict_with_vectorization(payload.text, top_k=payload.top_k)
    return PredictDetailedResponse(**result)
