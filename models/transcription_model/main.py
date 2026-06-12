from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from transcribe import transcribe_file


UPLOAD_ROOT = Path(os.environ.get('UPLOAD_ROOT', '/app/uploads')).resolve()
DEFAULT_MODEL = (os.environ.get('WHISPER_MODEL') or 'base').strip() or 'base'

app = FastAPI(title='Transcription Model', version='1.0.0')


class TranscribeRequest(BaseModel):
    file_path: str = Field(..., description='Path relative to UPLOAD_ROOT, e.g. meeting-recordings/file.webm')
    model: str | None = None


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.post('/transcribe')
def transcribe(request: TranscribeRequest) -> dict:
    relative = request.file_path.strip().replace('\\', '/').lstrip('/')
    if not relative or '..' in relative.split('/'):
        raise HTTPException(status_code=400, detail='Invalid file path')

    target = (UPLOAD_ROOT / relative).resolve()
    if not str(target).startswith(str(UPLOAD_ROOT)):
        raise HTTPException(status_code=400, detail='Invalid file path')

    if not target.is_file():
        raise HTTPException(status_code=404, detail='Audio file not found')

    try:
        return transcribe_file(str(target), request.model or DEFAULT_MODEL)
    except Exception as exc:  # noqa: BLE001 - surface model errors to API caller
        raise HTTPException(status_code=500, detail=str(exc)) from exc
