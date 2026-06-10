const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../../../config/db');
const { uploadBase, whisperModel, transcriptionModelUrl } = require('../../../config/env');
const {
  resolveWhisperPython,
  isWhisperPythonReady,
  formatWhisperPythonLabel,
  getWhisperSpawnOptions,
} = require('../../../config/whisperPython');
const { assertDefenseMeetingAccess } = require('../defenses/defenses.service');

const TRANSCRIPTION_AUDIO_DIR = path.join(uploadBase, 'transcription-audio');
const TRANSCRIBE_SCRIPT = path.join(__dirname, '../../../scripts/transcribe-audio.py');

function ensureTranscriptionAudioDir() {
  if (!fs.existsSync(TRANSCRIPTION_AUDIO_DIR)) {
    fs.mkdirSync(TRANSCRIPTION_AUDIO_DIR, { recursive: true, mode: 0o755 });
  }
}

function normalizeDeviceKey(deviceKey) {
  const key = String(deviceKey || '').trim();
  if (!key) return null;
  return key.slice(0, 64);
}

function buildWhisperSetupError(config, label) {
  const installCommand = process.env.WHISPER_PYTHON?.trim() || label || 'python3';
  if (transcriptionModelUrl) {
    return `Transcription service unavailable (${transcriptionModelUrl}). Ensure transcription-model is running.`;
  }
  if (!config || !isWhisperPythonReady(config)) {
    return (
      `faster-whisper is not installed for ${installCommand}. Set TRANSCRIPTION_MODEL_URL for Docker or run: ${installCommand} -m pip install -r scripts/requirements-transcription.txt`
    );
  }

  return (
    `Python executable not found (${label}). Set TRANSCRIPTION_MODEL_URL or WHISPER_PYTHON in .env`
  );
}

function resolveUploadRelativePath(filePath) {
  const relativePath = path.relative(uploadBase, filePath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('..')) {
    throw new Error('Invalid transcription file path');
  }
  return relativePath;
}

async function transcribeAudioFileViaService(filePath) {
  const relativePath = resolveUploadRelativePath(filePath);
  const response = await fetch(`${transcriptionModelUrl}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_path: relativePath,
      model: whisperModel,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.detail || body?.error || `Transcription service failed (${response.status})`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }

  return body;
}

function transcribeAudioFileViaPython(filePath) {
  return new Promise((resolve, reject) => {
    const whisperConfig = resolveWhisperPython();
    const whisperLabel = formatWhisperPythonLabel(whisperConfig);

    if (!whisperConfig || !isWhisperPythonReady(whisperConfig)) {
      reject(new Error(buildWhisperSetupError(whisperConfig, whisperLabel)));
      return;
    }

    const cwd = path.join(__dirname, '../../..');
    const { command, args, options } = getWhisperSpawnOptions(
      whisperConfig,
      [TRANSCRIBE_SCRIPT, filePath, '--model', whisperModel],
      cwd,
    );
    const proc = spawn(command, args, options);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(buildWhisperSetupError(whisperConfig, whisperLabel)));
        return;
      }
      reject(err);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim();
        reject(new Error(detail || `Transcription process failed (${code})`));
        return;
      }

      const output = stdout.trim();
      if (!output) {
        reject(new Error(stderr.trim() || 'Transcription returned no output'));
        return;
      }

      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error(`Transcription returned invalid JSON: ${output.slice(0, 200)}`));
      }
    });
  });
}

async function transcribeAudioFile(filePath) {
  if (transcriptionModelUrl) {
    return transcribeAudioFileViaService(filePath);
  }
  return transcribeAudioFileViaPython(filePath);
}

async function processAudioUpload(userId, scheduleId, filePath, deviceKey) {
  const access = await assertDefenseMeetingAccess(userId, scheduleId);
  if (access.error) return access;

  try {
    const result = await transcribeAudioFile(filePath);
    const text = String(result.text || '').trim();
    if (!text) {
      return {
        data: {
          transcribed: false,
          text: '',
          reason: 'no_speech_detected',
        },
      };
    }

    const key = normalizeDeviceKey(deviceKey);

    await db.query(
      `INSERT INTO meeting_transcription_segments
         (schedule_id, schedule_source, device_key, text, start_ms, end_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        scheduleId,
        access.scheduleSource,
        key,
        text,
        result.start_ms ?? null,
        result.end_ms ?? null,
      ],
    );

    return { data: { transcribed: true, text } };
  } catch (err) {
    const message = err.message || 'Transcription failed';
    if (message.includes("doesn't exist") || message.includes('ER_NO_SUCH_TABLE')) {
      return {
        error: 'Transcription table missing. Run database migrations (npm run migrate).',
        status: 500,
      };
    }
    return { error: message, status: 500 };
  } finally {
    fs.unlink(filePath, () => {});
  }
}

async function getTranscription(userId, scheduleId) {
  const access = await assertDefenseMeetingAccess(userId, scheduleId);
  if (access.error) return access;

  const { rows: segments } = await db.query(
    `SELECT id, text, device_key, start_ms, end_ms, created_at
     FROM meeting_transcription_segments
     WHERE schedule_id = ? AND schedule_source = ?
     ORDER BY created_at ASC`,
    [scheduleId, access.scheduleSource],
  );

  const fullText = segments.map((segment) => segment.text).join('\n\n');

  return {
    data: {
      schedule_id: scheduleId,
      schedule_source: access.scheduleSource,
      project_title: access.defense.project_title || null,
      project_code: access.defense.project_code || null,
      segments,
      full_text: fullText,
      segment_count: segments.length,
    },
  };
}

async function getTranscriptionDownload(userId, scheduleId) {
  const result = await getTranscription(userId, scheduleId);
  if (result.error) return result;

  const title = result.data.project_title || 'Meeting';
  const code = result.data.project_code || scheduleId;
  const filename = `${code}-transcription.txt`.replace(/[^\w.-]+/g, '_');

  return {
    data: {
      filename,
      title,
      body: result.data.full_text || '',
      segment_count: result.data.segment_count,
    },
  };
}

module.exports = {
  ensureTranscriptionAudioDir,
  transcribeAudioFile,
  processAudioUpload,
  getTranscription,
  getTranscriptionDownload,
};
