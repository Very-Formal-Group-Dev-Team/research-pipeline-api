#!/usr/bin/env python3
"""
Record room audio and upload chunks when the Arduino USB serial gate reports speaking.

The ESP32 prints JSON lines like:
  {"device":"user-01","speaking":true,"volume":512}

Usage:
  pip install -r scripts/requirements-transcription.txt
  python scripts/mic-audio-bridge.py \\
    --api-url http://localhost:4000/api \\
    --schedule-id YOUR_DEFENSE_ID \\
    --session-token YOUR_SESSION_TOKEN \\
    --serial-port COM3

Requires a working microphone, USB serial connection to the Arduino, and
the `sounddevice`, `pyserial`, and `requests` packages.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import wave

import requests

try:
    import numpy as np
    import serial
    import sounddevice as sd
except ImportError:
    print(
        'Install dependencies: pip install -r scripts/requirements-transcription.txt',
        file=sys.stderr,
    )
    raise SystemExit(1)


SAMPLE_RATE = 16000
CHANNELS = 1
CHUNK_SECONDS = 5


def record_wav_bytes(seconds: int, input_device: int | None = None) -> bytes:
    frames = int(seconds * SAMPLE_RATE)
    audio = sd.rec(
        frames,
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype='int16',
        device=input_device,
    )
    sd.wait()
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(audio.tobytes())
    return buffer.getvalue()


def parse_gate_line(line: str) -> dict | None:
    line = line.strip()
    if not line.startswith('{'):
        return None
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def upload_chunk(
    api_url: str,
    session_token: str,
    schedule_id: str,
    wav_bytes: bytes,
    device_key: str | None = None,
) -> dict:
    data = {'schedule_id': schedule_id}
    if device_key:
        data['device_key'] = device_key

    response = requests.post(
        f'{api_url.rstrip("/")}/mic/audio',
        headers={'Authorization': f'Bearer {session_token}'},
        data=data,
        files={'audio': ('chunk.wav', wav_bytes, 'audio/wav')},
        timeout=300,
    )

    try:
        body = response.json()
    except ValueError:
        body = {'error': response.text[:500] or response.reason}

    if not response.ok:
        detail = body.get('error') if isinstance(body, dict) else str(body)
        raise RuntimeError(f'Upload failed ({response.status_code}): {detail}')

    return body if isinstance(body, dict) else {}


def list_input_devices() -> None:
    print(sd.query_devices())


def main() -> int:
    parser = argparse.ArgumentParser(description='Upload gated meeting audio for transcription')
    parser.add_argument('--api-url', default='http://localhost:4000/api')
    parser.add_argument('--schedule-id', required=True)
    parser.add_argument('--session-token', required=True)
    parser.add_argument('--serial-port', required=True, help='e.g. COM3 on Windows or /dev/ttyUSB0 on Linux')
    parser.add_argument('--baud-rate', type=int, default=115200)
    parser.add_argument('--chunk-seconds', type=int, default=CHUNK_SECONDS)
    parser.add_argument('--input-device', type=int, default=None, help='sounddevice input index (see --list-devices)')
    parser.add_argument('--list-devices', action='store_true', help='List audio input devices and exit')
    args = parser.parse_args()

    if args.list_devices:
        list_input_devices()
        return 0

    print(f'Opening serial port {args.serial_port} at {args.baud_rate} baud...')
    ser = serial.Serial(args.serial_port, args.baud_rate, timeout=0.2)

    speaking = False
    device_key: str | None = None
    print('Mic audio bridge running. Press Ctrl+C to stop.')
    print(f'Uploading to schedule {args.schedule_id} at {args.api_url.rstrip("/")}/mic/audio')

    try:
        while True:
            try:
                line = ser.readline().decode('utf-8', errors='ignore')
                payload = parse_gate_line(line)
                if payload is not None:
                    speaking = payload.get('speaking') is True or payload.get('speaking') == 'true'
                    raw_device = payload.get('device')
                    if isinstance(raw_device, str) and raw_device.strip():
                        device_key = raw_device.strip()

                if speaking:
                    print('Gate open — recording chunk...')
                    wav_bytes = record_wav_bytes(args.chunk_seconds, args.input_device)
                    result = upload_chunk(
                        args.api_url,
                        args.session_token,
                        args.schedule_id,
                        wav_bytes,
                        device_key,
                    )
                    if result.get('transcribed'):
                        print('Transcribed:', result.get('text', '')[:120])
                    elif result.get('reason') == 'no_speech_detected':
                        print('Uploaded chunk, but Whisper detected no speech in the recording.')
                    else:
                        print('Upload OK:', result)
            except KeyboardInterrupt:
                raise
            except Exception as exc:  # noqa: BLE001 - bridge loop should keep running
                print('Error:', exc, file=sys.stderr)
                time.sleep(1.0)
    except KeyboardInterrupt:
        print('\nStopped.')
        return 0
    finally:
        ser.close()


if __name__ == '__main__':
    raise SystemExit(main())
