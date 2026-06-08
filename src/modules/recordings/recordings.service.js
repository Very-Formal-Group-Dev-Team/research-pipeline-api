const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../../config/db');
const { uploadBase } = require('../../../config/env');
const { assertDefenseMeetingAccess } = require('../defenses/defenses.service');
const { transcribeAudioFile } = require('../transcriptions/transcriptions.service');

function scheduleTable(scheduleSource) {
  return scheduleSource === 'defense' ? 'defenses' : 'meetings';
}

function mapRecordingRow(row, userId) {
  if (!row) return row;
  return {
    ...row,
    can_delete: row.recorded_by === userId,
    can_manage: row.recorded_by === userId,
  };
}

async function getRecordingById(recordingId) {
  const { rows } = await db.query(
    `SELECT *
     FROM meeting_recordings
     WHERE id = ?
     LIMIT 1`,
    [recordingId],
  );
  return rows[0] || null;
}

async function startRecording(userId, scheduleId) {
  const access = await assertDefenseMeetingAccess(userId, scheduleId);
  if (access.error) return access;

  const recordingId = crypto.randomUUID();

  await db.query(
    `INSERT INTO meeting_recordings
       (id, schedule_id, schedule_source, recorded_by, status, transcription_status)
     VALUES (?, ?, ?, ?, 'recording', 'pending')`,
    [recordingId, scheduleId, access.scheduleSource, userId],
  );

  return {
    data: {
      recording_id: recordingId,
      schedule_id: scheduleId,
      schedule_source: access.scheduleSource,
      status: 'recording',
    },
  };
}

async function persistTranscriptionResult({
  recordingId,
  scheduleId,
  scheduleSource,
  userId,
  result,
}) {
  const segments = Array.isArray(result.segments) ? result.segments : [];
  const fullText = String(result.text || '').trim()
    || segments.map((s) => s.text).join(' ').trim();

  if (!fullText) {
    await db.query(
      `UPDATE meeting_recordings
       SET transcription_status = 'skipped',
           transcription_error = 'No speech detected',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [recordingId],
    );
    return { skipped: true };
  }

  const archiveId = crypto.randomUUID();
  const conn = await db.pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO meeting_transcription_archives
         (id, recording_id, schedule_id, schedule_source, full_text, language, transcribed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        archiveId,
        recordingId,
        scheduleId,
        scheduleSource,
        fullText,
        result.language ?? null,
        userId,
      ],
    );

    const segmentRows = segments.length
      ? segments
      : [{ text: fullText, start_ms: result.start_ms ?? 0, end_ms: result.end_ms ?? null }];

    for (const segment of segmentRows) {
      const text = String(segment.text || '').trim();
      if (!text) continue;
      await conn.query(
        `INSERT INTO meeting_transcription_segments
           (schedule_id, schedule_source, recording_id, text, start_ms, end_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          scheduleId,
          scheduleSource,
          recordingId,
          text,
          segment.start_ms ?? null,
          segment.end_ms ?? null,
        ],
      );
    }

    const table = scheduleTable(scheduleSource);
    await conn.query(
      `UPDATE ${table} SET transcription_id = ? WHERE id = ?`,
      [archiveId, scheduleId],
    );

    await conn.query(
      `UPDATE meeting_recordings
       SET transcription_status = 'completed',
           transcription_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [recordingId],
    );

    await conn.commit();

    return {
      transcription_id: archiveId,
      full_text: fullText,
      segment_count: segments.length || 1,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function processTranscriptionJob(recordingId, userId) {
  const recording = await getRecordingById(recordingId);
  if (!recording || recording.status !== 'completed') return;

  const { rows: existingArchive } = await db.query(
    `SELECT id FROM meeting_transcription_archives WHERE recording_id = ? LIMIT 1`,
    [recordingId],
  );
  if (existingArchive.length) return;

  const sourcePath = recording.audio_url || recording.file_url;
  if (!sourcePath) {
    await db.query(
      `UPDATE meeting_recordings
       SET transcription_status = 'skipped',
           transcription_error = 'No audio available',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [recordingId],
    );
    return;
  }

  await db.query(
    `UPDATE meeting_recordings
     SET transcription_status = 'processing',
         transcription_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [recordingId],
  );

  const filePath = path.join(uploadBase, sourcePath.replace(/^\/uploads\//, ''));

  try {
    const result = await transcribeAudioFile(filePath);
    await persistTranscriptionResult({
      recordingId,
      scheduleId: recording.schedule_id,
      scheduleSource: recording.schedule_source,
      userId,
      result,
    });
  } catch (err) {
    const message = String(err.message || 'Transcription failed').slice(0, 512);
    await db.query(
      `UPDATE meeting_recordings
       SET transcription_status = 'failed',
           transcription_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [message, recordingId],
    );
    console.error(`[transcription] recording ${recordingId} failed:`, message);
  }
}

function enqueueTranscription(recordingId, userId) {
  setImmediate(() => {
    processTranscriptionJob(recordingId, userId).catch((err) => {
      console.error(`[transcription] background job failed for ${recordingId}:`, err);
    });
  });
}

async function completeRecording(userId, scheduleId, recordingId, fileMeta) {
  const access = await assertDefenseMeetingAccess(userId, scheduleId);
  if (access.error) return access;

  const recording = await getRecordingById(recordingId);
  if (!recording || recording.schedule_id !== scheduleId || recording.schedule_source !== access.scheduleSource) {
    return { error: 'Recording not found', status: 404 };
  }

  if (recording.recorded_by !== userId) {
    return { error: 'Only the user who started the recording can upload it', status: 403 };
  }

  const endedAt = new Date();
  const durationMs = Number.parseInt(String(fileMeta.duration_ms ?? 0), 10) || null;
  const hasAudio = Boolean(fileMeta.audio_url);
  const transcriptionStatus = hasAudio ? 'pending' : 'skipped';

  await db.query(
    `UPDATE meeting_recordings
     SET file_url = ?, audio_url = ?, file_size = ?, duration_ms = ?, mime_type = ?,
         ended_at = ?, status = 'completed', transcription_status = ?,
         transcription_error = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      fileMeta.file_url,
      fileMeta.audio_url ?? null,
      fileMeta.file_size ?? null,
      durationMs,
      fileMeta.mime_type || 'video/webm',
      endedAt,
      transcriptionStatus,
      hasAudio ? null : 'No gated audio captured',
      recordingId,
    ],
  );

  const table = scheduleTable(access.scheduleSource);
  await db.query(
    `UPDATE ${table}
     SET recording_id = ?, recorded_at = ?
     WHERE id = ?`,
    [recordingId, recording.recorded_at || endedAt, scheduleId],
  );

  if (hasAudio) {
    enqueueTranscription(recordingId, userId);
  }

  return {
    data: {
      recording_id: recordingId,
      schedule_id: scheduleId,
      schedule_source: access.scheduleSource,
      file_url: fileMeta.file_url,
      audio_url: fileMeta.audio_url ?? null,
      duration_ms: durationMs,
      status: 'completed',
      transcription_status: transcriptionStatus,
    },
  };
}

async function transcribeRecording(userId, scheduleId, recordingId) {
  const access = await assertDefenseMeetingAccess(userId, scheduleId);
  if (access.error) return access;

  const recording = await getRecordingById(recordingId);
  if (!recording || recording.schedule_id !== scheduleId || recording.schedule_source !== access.scheduleSource) {
    return { error: 'Recording not found', status: 404 };
  }

  if (recording.recorded_by !== userId) {
    return { error: 'Only the recorder can request transcription', status: 403 };
  }

  if (recording.status !== 'completed') {
    return { error: 'Recording file is not ready for transcription', status: 400 };
  }

  const { rows: existingArchive } = await db.query(
    `SELECT id FROM meeting_transcription_archives WHERE recording_id = ? LIMIT 1`,
    [recordingId],
  );
  if (existingArchive.length) {
    return { error: 'This recording has already been transcribed', status: 409 };
  }

  if (recording.transcription_status === 'processing') {
    return { error: 'Transcription is already in progress', status: 409 };
  }

  try {
    await processTranscriptionJob(recordingId, userId);
    const updated = await getRecordingById(recordingId);
    if (updated.transcription_status === 'failed') {
      return { error: updated.transcription_error || 'Transcription failed', status: 500 };
    }
    if (updated.transcription_status === 'skipped') {
      return { error: updated.transcription_error || 'No speech detected in recording', status: 400 };
    }

    const { rows: archiveRows } = await db.query(
      `SELECT id, full_text FROM meeting_transcription_archives WHERE recording_id = ? LIMIT 1`,
      [recordingId],
    );

    return {
      data: {
        transcription_id: archiveRows[0]?.id || null,
        recording_id: recordingId,
        full_text: archiveRows[0]?.full_text || '',
        transcription_status: updated.transcription_status,
      },
    };
  } catch (err) {
    return { error: err.message || 'Transcription failed', status: 500 };
  }
}

function unlinkUpload(relativeUrl) {
  if (!relativeUrl) return;
  const filePath = path.join(uploadBase, relativeUrl.replace(/^\/uploads\//, ''));
  fs.unlink(filePath, () => {});
}

async function deleteRecording(userId, scheduleId, recordingId) {
  const access = await assertDefenseMeetingAccess(userId, scheduleId);
  if (access.error) return access;

  const recording = await getRecordingById(recordingId);
  if (!recording || recording.schedule_id !== scheduleId || recording.schedule_source !== access.scheduleSource) {
    return { error: 'Recording not found', status: 404 };
  }

  if (recording.recorded_by !== userId) {
    return { error: 'Only the user who recorded this meeting can delete it', status: 403 };
  }

  unlinkUpload(recording.file_url);
  unlinkUpload(recording.audio_url);

  await db.query(`DELETE FROM meeting_recordings WHERE id = ?`, [recordingId]);

  return { data: { deleted: true, recording_id: recordingId } };
}

async function listScheduleRecordings(userId, scheduleId) {
  const access = await assertDefenseMeetingAccess(userId, scheduleId);
  if (access.error) return access;

  const { rows } = await db.query(
    `SELECT r.id, r.schedule_id, r.schedule_source, r.file_url, r.audio_url, r.file_size, r.duration_ms,
            r.mime_type, r.recorded_by, r.recorded_at, r.ended_at, r.status,
            r.transcription_status, r.transcription_error,
            a.id AS transcription_id, a.transcribed_at
     FROM meeting_recordings r
     LEFT JOIN meeting_transcription_archives a ON a.recording_id = r.id
     WHERE r.schedule_id = ? AND r.schedule_source = ?
     ORDER BY r.recorded_at DESC`,
    [scheduleId, access.scheduleSource],
  );

  return {
    data: {
      schedule_id: scheduleId,
      schedule_source: access.scheduleSource,
      project_title: access.defense.project_title || null,
      project_code: access.defense.project_code || null,
      recordings: rows.map((row) => mapRecordingRow(row, userId)),
    },
  };
}

async function listAccessibleRecordings(userId) {
  const { rows: defenseRows } = await db.query(
    `SELECT r.id, r.schedule_id, r.schedule_source, r.file_url, r.duration_ms,
            r.recorded_by, r.recorded_at, r.status, r.transcription_status, r.transcription_error,
            a.id AS transcription_id, a.transcribed_at,
            p.title AS project_title, p.project_code, d.defense_type, d.scheduled_at
     FROM meeting_recordings r
     INNER JOIN defenses d ON d.id = r.schedule_id AND r.schedule_source = 'defense'
     INNER JOIN projects p ON p.id = d.project_id
     LEFT JOIN meeting_transcription_archives a ON a.recording_id = r.id
     WHERE r.status = 'completed'
       AND (
         d.created_by = ?
         OR EXISTS (
           SELECT 1 FROM defense_panelists dp
           WHERE dp.defense_id = d.id AND dp.user_id = ?
         )
         OR EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = d.project_id AND pm.user_id = ? AND pm.status = 'accepted'
         )
         OR EXISTS (
           SELECT 1 FROM user_roles ur
           WHERE ur.user_id = ? AND ur.institution_id = p.institution_id AND ur.role = 'coordinator'
         )
       )
     ORDER BY r.recorded_at DESC`,
    [userId, userId, userId, userId],
  );

  const { rows: meetingRows } = await db.query(
    `SELECT r.id, r.schedule_id, r.schedule_source, r.file_url, r.duration_ms,
            r.recorded_by, r.recorded_at, r.status, r.transcription_status, r.transcription_error,
            a.id AS transcription_id, a.transcribed_at,
            p.title AS project_title, p.project_code, m.defense_type, m.scheduled_at,
            m.meeting_title
     FROM meeting_recordings r
     INNER JOIN meetings m ON m.id = r.schedule_id AND r.schedule_source = 'meeting'
     LEFT JOIN projects p ON p.id = m.project_id
     LEFT JOIN meeting_transcription_archives a ON a.recording_id = r.id
     WHERE r.status = 'completed'
       AND (
         m.created_by = ?
         OR m.adviser_id = ?
         OR EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = m.project_id AND pm.user_id = ? AND pm.status = 'accepted'
         )
       )
     ORDER BY r.recorded_at DESC`,
    [userId, userId, userId],
  );

  const recordings = [...defenseRows, ...meetingRows]
    .map((row) => mapRecordingRow(row, userId))
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());

  return { data: { recordings } };
}

async function getRecordingDetail(userId, scheduleId, recordingId) {
  const access = await assertDefenseMeetingAccess(userId, scheduleId);
  if (access.error) return access;

  const recording = await getRecordingById(recordingId);
  if (!recording || recording.schedule_id !== scheduleId || recording.schedule_source !== access.scheduleSource) {
    return { error: 'Recording not found', status: 404 };
  }

  const { rows: archiveRows } = await db.query(
    `SELECT id, full_text, language, transcribed_at
     FROM meeting_transcription_archives
     WHERE recording_id = ?
     LIMIT 1`,
    [recordingId],
  );

  const { rows: segments } = await db.query(
    `SELECT id, text, start_ms, end_ms, created_at
     FROM meeting_transcription_segments
     WHERE recording_id = ?
     ORDER BY start_ms ASC, created_at ASC`,
    [recordingId],
  );

  return {
    data: {
      recording: mapRecordingRow({
        ...recording,
        project_title: access.defense.project_title || null,
        project_code: access.defense.project_code || null,
      }, userId),
      transcription: archiveRows[0] || null,
      segments,
    },
  };
}

module.exports = {
  startRecording,
  completeRecording,
  transcribeRecording,
  deleteRecording,
  listScheduleRecordings,
  listAccessibleRecordings,
  getRecordingDetail,
};
