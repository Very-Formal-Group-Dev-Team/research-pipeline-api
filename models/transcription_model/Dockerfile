FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /service

COPY models/transcription_model/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "import faster_whisper"

COPY models/transcription_model/ /service/

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
