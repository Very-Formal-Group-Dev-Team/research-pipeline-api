#!/usr/bin/env python3
"""
Local agent for automatic room transcription when a meeting is joined in the browser.

Runs on the room PC and listens on http://127.0.0.1:8765. The web app calls
POST /start with the defense/meeting schedule id when someone joins.

Usage:
  pip install -r scripts/requirements-transcription.txt
  python scripts/transcription-local-agent.py

Optional env:
  TRANSCRIPTION_SERIAL_PORT=COM3
  TRANSCRIPTION_API_URL=http://localhost:4000/api
  TRANSCRIPTION_AGENT_PORT=8765
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
BRIDGE_SCRIPT = SCRIPT_DIR / 'mic-audio-bridge.py'
DEFAULT_PORT = int(os.environ.get('TRANSCRIPTION_AGENT_PORT', '8765'))
DEFAULT_API_URL = os.environ.get('TRANSCRIPTION_API_URL', 'http://localhost:4000/api')
DEFAULT_SERIAL = os.environ.get('TRANSCRIPTION_SERIAL_PORT', '').strip()

_bridge_process: subprocess.Popen | None = None
_process_lock = threading.Lock()


def _python_executable() -> str:
    return os.environ.get('TRANSCRIPTION_PYTHON', sys.executable)


def _stop_bridge() -> None:
    global _bridge_process
    with _process_lock:
        if _bridge_process is None:
            return
        proc = _bridge_process
        _bridge_process = None

    proc.send_signal(signal.CTRL_BREAK_EVENT if os.name == 'nt' else signal.SIGTERM)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def _start_bridge(schedule_id: str, session_token: str, api_url: str, serial_port: str) -> None:
    global _bridge_process
    _stop_bridge()

    if not serial_port:
        raise ValueError('serial_port is required (set TRANSCRIPTION_SERIAL_PORT or pass in /start body)')

    cmd = [
        _python_executable(),
        str(BRIDGE_SCRIPT),
        '--api-url', api_url,
        '--schedule-id', schedule_id,
        '--session-token', session_token,
        '--serial-port', serial_port,
    ]

    popen_kwargs: dict = {}
    if os.name == 'nt':
        popen_kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP

    with _process_lock:
        _bridge_process = subprocess.Popen(cmd, **popen_kwargs)


def _bridge_status() -> dict:
    with _process_lock:
        running = _bridge_process is not None and _bridge_process.poll() is None
        code = None if _bridge_process is None else _bridge_process.poll()
    return {'running': running, 'exit_code': code}


class AgentHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        print(f'[agent] {self.address_string()} {format % args}')

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == '/health':
            self._send_json(200, {'ok': True, 'bridge': _bridge_status()})
            return
        if path == '/status':
            self._send_json(200, _bridge_status())
            return
        self._send_json(404, {'error': 'Not found'})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        length = int(self.headers.get('Content-Length', '0'))
        raw = self.rfile.read(length) if length else b'{}'

        try:
            payload = json.loads(raw.decode('utf-8') or '{}')
        except json.JSONDecodeError:
            self._send_json(400, {'error': 'Invalid JSON body'})
            return

        if path == '/stop':
            _stop_bridge()
            self._send_json(200, {'ok': True, 'bridge': _bridge_status()})
            return

        if path == '/start':
            schedule_id = str(payload.get('schedule_id') or '').strip()
            session_token = str(payload.get('session_token') or '').strip()
            api_url = str(payload.get('api_url') or DEFAULT_API_URL).strip()
            serial_port = str(payload.get('serial_port') or DEFAULT_SERIAL).strip()

            if not schedule_id:
                self._send_json(400, {'error': 'schedule_id is required'})
                return
            if not session_token:
                self._send_json(400, {'error': 'session_token is required'})
                return

            try:
                _start_bridge(schedule_id, session_token, api_url, serial_port)
            except Exception as exc:  # noqa: BLE001
                self._send_json(500, {'error': str(exc)})
                return

            self._send_json(200, {'ok': True, 'bridge': _bridge_status()})
            return

        self._send_json(404, {'error': 'Not found'})


def main() -> int:
    server = HTTPServer(('127.0.0.1', DEFAULT_PORT), AgentHandler)
    print(f'Transcription local agent listening on http://127.0.0.1:{DEFAULT_PORT}')
    if DEFAULT_SERIAL:
        print(f'Default serial port: {DEFAULT_SERIAL}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopping agent...')
        _stop_bridge()
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
