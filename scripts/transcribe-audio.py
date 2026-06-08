#!/usr/bin/env python3
"""Transcribe an audio/video file with Faster-Whisper and emit JSON on stdout."""

from __future__ import annotations

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description='Transcribe audio with Faster-Whisper')
    parser.add_argument('audio_path', help='Path to the audio or video file')
    parser.add_argument('--model', default='base', help='Whisper model size (default: base)')
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            json.dumps({
                'error': 'faster-whisper is not installed. Run: pip install -r scripts/requirements-transcription.txt',
            }),
            file=sys.stderr,
        )
        return 1

    print(f'Loading Faster-Whisper model "{args.model}"...', file=sys.stderr)
    model = WhisperModel(args.model, device='cpu', compute_type='int8')
    print('Transcribing audio...', file=sys.stderr)

    segments_iter, info = model.transcribe(
        args.audio_path,
        beam_size=5,
        vad_filter=False,
        condition_on_previous_text=False,
    )

    texts = []
    segment_rows = []
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

    payload = {
        'text': ' '.join(texts).strip(),
        'segments': segment_rows,
        'start_ms': start_ms,
        'end_ms': end_ms,
        'language': info.language,
    }
    print(json.dumps(payload))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
