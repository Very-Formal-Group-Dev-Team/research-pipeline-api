from __future__ import annotations

import os
from typing import Any


def transcribe_file(audio_path: str, model_name: str | None = None) -> dict[str, Any]:
    from faster_whisper import WhisperModel

    whisper_model = (model_name or os.environ.get('WHISPER_MODEL') or 'base').strip() or 'base'
    model = WhisperModel(whisper_model, device='cpu', compute_type='int8')

    segments_iter, info = model.transcribe(
        audio_path,
        beam_size=5,
        vad_filter=False,
        condition_on_previous_text=False,
    )

    texts: list[str] = []
    segment_rows: list[dict[str, Any]] = []
    start_ms = None
    end_ms = None

    for segment in segments_iter:
        text = (segment.text or '').strip()
        if not text:
            continue
        texts.append(text)
        segment_start_ms = int(segment.start * 1000)
        segment_end_ms = int(segment.end * 1000)
        segment_rows.append({
            'text': text,
            'start_ms': segment_start_ms,
            'end_ms': segment_end_ms,
        })
        if start_ms is None:
            start_ms = segment_start_ms
        end_ms = segment_end_ms

    return {
        'text': ' '.join(texts).strip(),
        'segments': segment_rows,
        'start_ms': start_ms,
        'end_ms': end_ms,
        'language': info.language,
    }
