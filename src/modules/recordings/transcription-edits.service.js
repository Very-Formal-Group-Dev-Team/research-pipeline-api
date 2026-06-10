const crypto = require('crypto');
const db = require('../../../config/db');
const { assertDefenseMeetingAccess } = require('../defenses/defenses.service');
const { getRecordingById } = require('./recordings.service');

const SPEAKER_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#ca8a04',
  '#9333ea',
  '#0891b2',
  '#ea580c',
  '#be185d',
];

const STORED_ID_MAX_LENGTH = 36;

function normalizeStoredId(id, prefix) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  const prefixed = `${prefix}-`;
  if (raw.startsWith(prefixed) && raw.length > STORED_ID_MAX_LENGTH) {
    return raw.slice(prefixed.length);
  }
  return raw;
}

function normalizeSpeakerId(id) {
  return normalizeStoredId(id, 'speaker');
}

function parseEditContent(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeSpeakers(speakers) {
  if (!Array.isArray(speakers)) return [];
  return speakers
    .map((speaker, index) => {
      const id = normalizeSpeakerId(speaker?.id);
      const name = String(speaker?.name || '').trim();
      if (!id || !name) return null;
      return {
        id,
        name,
        color: String(speaker?.color || SPEAKER_COLORS[index % SPEAKER_COLORS.length]),
      };
    })
    .filter(Boolean);
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => {
      const id = String(line?.id || '').trim();
      const text = String(line?.text || '').trim();
      if (!id || !text) return null;
      return {
        id,
        text,
        speaker_id: line?.speaker_id ? normalizeSpeakerId(line.speaker_id) : null,
        start_ms: line?.start_ms == null ? null : Number(line.start_ms),
        end_ms: line?.end_ms == null ? null : Number(line.end_ms),
      };
    })
    .filter(Boolean);
}

function buildDefaultEditContent(segments, fullText) {
  const linesFromSegments = (segments || [])
    .map((segment) => ({
      id: segment.id,
      text: String(segment.text || '').trim(),
      speaker_id: null,
      start_ms: segment.start_ms ?? null,
      end_ms: segment.end_ms ?? null,
    }))
    .filter((line) => line.text);

  if (linesFromSegments.length) {
    return { speakers: [], lines: linesFromSegments };
  }

  const text = String(fullText || '').trim();
  if (!text) {
    return { speakers: [], lines: [] };
  }

  return {
    speakers: [],
    lines: text.split(/\n+/).filter(Boolean).map((lineText, index) => ({
      id: `line-${index + 1}`,
      text: lineText.trim(),
      speaker_id: null,
      start_ms: null,
      end_ms: null,
    })),
  };
}

function formatEditedTranscript(content) {
  const speakers = normalizeSpeakers(content?.speakers);
  const lines = normalizeLines(content?.lines);
  const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker]));

  return lines
    .map((line) => {
      const speaker = line.speaker_id ? speakerById.get(line.speaker_id) : null;
      const prefix = speaker ? `${speaker.name}: ` : '';
      return `${prefix}${line.text}`.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

async function loadSpeakersFromDb(recordingId) {
  const { rows } = await db.query(
    `SELECT id, name, color, sort_order
     FROM meeting_transcription_speakers
     WHERE recording_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [recordingId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
  }));
}

async function loadLinesFromDb(recordingId) {
  const { rows } = await db.query(
    `SELECT id, text, speaker_id, start_ms, end_ms, sort_order, source_segment_id
     FROM meeting_transcription_edit_lines
     WHERE recording_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [recordingId],
  );
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    speaker_id: row.speaker_id ?? null,
    start_ms: row.start_ms ?? null,
    end_ms: row.end_ms ?? null,
  }));
}

async function loadEditMetadata(recordingId) {
  const { rows } = await db.query(
    `SELECT id, edited_by, created_at, updated_at
     FROM meeting_transcription_edits
     WHERE recording_id = ?
     LIMIT 1`,
    [recordingId],
  );
  return rows[0] || null;
}

async function loadLegacyJsonContent(recordingId) {
  const { rows } = await db.query(
    `SELECT content FROM meeting_transcription_edits WHERE recording_id = ? LIMIT 1`,
    [recordingId],
  );
  const parsed = parseEditContent(rows[0]?.content);
  if (!parsed) return null;
  return {
    speakers: normalizeSpeakers(parsed.speakers),
    lines: normalizeLines(parsed.lines),
  };
}

async function loadEditContent(recordingId, segments, fullText) {
  const speakers = await loadSpeakersFromDb(recordingId);
  const lines = await loadLinesFromDb(recordingId);

  if (speakers.length || lines.length) {
    return { speakers, lines };
  }

  const legacy = await loadLegacyJsonContent(recordingId);
  if (legacy && (legacy.speakers.length || legacy.lines.length)) {
    return legacy;
  }

  return buildDefaultEditContent(segments, fullText);
}

async function persistEditContent(recordingId, userId, content) {
  const speakers = normalizeSpeakers(content?.speakers);
  const lines = normalizeLines(content?.lines);
  const conn = await db.pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.query(
      `DELETE FROM meeting_transcription_edit_lines WHERE recording_id = ?`,
      [recordingId],
    );
    await conn.query(
      `DELETE FROM meeting_transcription_speakers WHERE recording_id = ?`,
      [recordingId],
    );

    for (let i = 0; i < speakers.length; i += 1) {
      const speaker = speakers[i];
      await conn.query(
        `INSERT INTO meeting_transcription_speakers (id, recording_id, name, color, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [speaker.id, recordingId, speaker.name, speaker.color, i],
      );
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      await conn.query(
        `INSERT INTO meeting_transcription_edit_lines
           (id, recording_id, text, speaker_id, start_ms, end_ms, sort_order, source_segment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          line.id,
          recordingId,
          line.text,
          line.speaker_id,
          line.start_ms,
          line.end_ms,
          i,
          line.id.startsWith('line-') || line.id.startsWith('seed-line-') ? null : line.id,
        ],
      );
    }

    const snapshot = JSON.stringify({ speakers, lines });
    const [existingRows] = await conn.query(
      `SELECT id FROM meeting_transcription_edits WHERE recording_id = ? LIMIT 1`,
      [recordingId],
    );

    if (existingRows.length) {
      await conn.query(
        `UPDATE meeting_transcription_edits
         SET content = ?, edited_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE recording_id = ?`,
        [snapshot, userId, recordingId],
      );
    } else {
      await conn.query(
        `INSERT INTO meeting_transcription_edits (id, recording_id, edited_by, content)
         VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), recordingId, userId, snapshot],
      );
    }

    await conn.commit();
    return { speakers, lines };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function mergeLinesInDocumentOrder(lines, lineIds) {
  const uniqueIds = [...new Set(lineIds.map((id) => String(id).trim()).filter(Boolean))];
  if (uniqueIds.length < 2) {
    return { error: 'Select at least two statements to merge', status: 400 };
  }

  const idSet = new Set(uniqueIds);
  const indices = lines
    .map((line, index) => (idSet.has(line.id) ? index : -1))
    .filter((index) => index >= 0);

  if (indices.length !== uniqueIds.length) {
    return { error: 'One or more selected statements were not found', status: 404 };
  }

  const selected = indices.map((index) => lines[index]);
  const merged = {
    id: crypto.randomUUID(),
    text: selected.map((line) => line.text.trim()).filter(Boolean).join(' '),
    speaker_id: selected.find((line) => line.speaker_id)?.speaker_id ?? null,
    start_ms: selected[0].start_ms ?? null,
    end_ms: selected[selected.length - 1].end_ms ?? null,
  };

  const next = lines.filter((line) => !idSet.has(line.id));
  next.splice(indices[0], 0, merged);

  return { lines: next, merged_id: merged.id };
}

async function assertRecordingAccess(userId, scheduleId, recordingId) {
  const access = await assertDefenseMeetingAccess(userId, scheduleId);
  if (access.error) return access;

  const recording = await getRecordingById(recordingId);
  if (!recording || recording.schedule_id !== scheduleId || recording.schedule_source !== access.scheduleSource) {
    return { error: 'Recording not found', status: 404 };
  }

  return { recording, access };
}

async function assertRecordingEditor(userId, scheduleId, recordingId) {
  const result = await assertRecordingAccess(userId, scheduleId, recordingId);
  if (result.error) return result;

  if (result.recording.recorded_by !== userId) {
    return { error: 'Only the person who recorded this meeting can edit the transcript', status: 403 };
  }

  return result;
}

async function getTranscriptionEdit(userId, scheduleId, recordingId) {
  const result = await assertRecordingAccess(userId, scheduleId, recordingId);
  if (result.error) return result;

  const { recording } = result;

  const { rows: segments } = await db.query(
    `SELECT id, text, start_ms, end_ms
     FROM meeting_transcription_segments
     WHERE recording_id = ?
     ORDER BY start_ms ASC, created_at ASC`,
    [recordingId],
  );

  const { rows: archiveRows } = await db.query(
    `SELECT full_text FROM meeting_transcription_archives WHERE recording_id = ? LIMIT 1`,
    [recordingId],
  );

  const metadata = await loadEditMetadata(recordingId);
  const content = await loadEditContent(recordingId, segments, archiveRows[0]?.full_text);

  return {
    data: {
      recording_id: recordingId,
      can_edit: recording.recorded_by === userId,
      edit: metadata
        ? {
          id: metadata.id,
          edited_by: metadata.edited_by,
          created_at: metadata.created_at,
          updated_at: metadata.updated_at,
        }
        : null,
      content,
    },
  };
}

async function saveTranscriptionEdit(userId, scheduleId, recordingId, payload) {
  const result = await assertRecordingEditor(userId, scheduleId, recordingId);
  if (result.error) return result;

  const content = {
    speakers: normalizeSpeakers(payload?.speakers),
    lines: normalizeLines(payload?.lines),
  };

  if (!content.lines.length) {
    return { error: 'At least one transcript line is required', status: 400 };
  }

  const speakerIds = new Set(content.speakers.map((speaker) => speaker.id));
  for (const line of content.lines) {
    if (line.speaker_id && !speakerIds.has(line.speaker_id)) {
      return { error: 'Each assigned speaker must exist in the speaker list', status: 400 };
    }
  }

  const persisted = await persistEditContent(recordingId, userId, content);
  const metadata = await loadEditMetadata(recordingId);

  return {
    data: {
      recording_id: recordingId,
      edit_id: metadata?.id || null,
      content: persisted,
    },
  };
}

async function mergeTranscriptionLines(userId, scheduleId, recordingId, lineIds, payloadSpeakers) {
  const result = await assertRecordingEditor(userId, scheduleId, recordingId);
  if (result.error) return result;

  const current = await getTranscriptionEdit(userId, scheduleId, recordingId);
  if (current.error) return current;

  const mergeResult = mergeLinesInDocumentOrder(current.data.content.lines, lineIds);
  if (mergeResult.error) return mergeResult;

  const speakers = payloadSpeakers != null
    ? normalizeSpeakers(payloadSpeakers)
    : normalizeSpeakers(current.data.content.speakers);

  const persisted = await persistEditContent(recordingId, userId, {
    speakers,
    lines: mergeResult.lines,
  });

  return {
    data: {
      recording_id: recordingId,
      merged_id: mergeResult.merged_id,
      content: persisted,
    },
  };
}

async function assignTranscriptionSpeaker(userId, scheduleId, recordingId, lineIds, speakerId, payloadSpeakers) {
  const result = await assertRecordingEditor(userId, scheduleId, recordingId);
  if (result.error) return result;

  const current = await getTranscriptionEdit(userId, scheduleId, recordingId);
  if (current.error) return current;

  const uniqueIds = [...new Set(lineIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!uniqueIds.length) {
    return { error: 'Select at least one statement to assign', status: 400 };
  }

  const normalizedSpeakerId = normalizeSpeakerId(speakerId);
  if (!normalizedSpeakerId) {
    return { error: 'Speaker is required', status: 400 };
  }

  const speakers = payloadSpeakers != null
    ? normalizeSpeakers(payloadSpeakers)
    : normalizeSpeakers(current.data.content.speakers);
  const speaker = speakers.find((row) => row.id === normalizedSpeakerId);
  if (!speaker) {
    return { error: 'Speaker not found for this recording', status: 404 };
  }

  const idSet = new Set(uniqueIds);
  const lines = current.data.content.lines.map((line) => (
    idSet.has(line.id) ? { ...line, speaker_id: normalizedSpeakerId } : line
  ));

  const matched = lines.filter((line) => idSet.has(line.id));
  if (!matched.length) {
    return { error: 'One or more selected statements were not found', status: 404 };
  }

  const persisted = await persistEditContent(recordingId, userId, { speakers, lines });

  return {
    data: {
      recording_id: recordingId,
      speaker_id: normalizedSpeakerId,
      assigned_count: matched.length,
      content: persisted,
    },
  };
}

async function downloadTranscriptionEdit(userId, scheduleId, recordingId) {
  const result = await getTranscriptionEdit(userId, scheduleId, recordingId);
  if (result.error) return result;

  const text = formatEditedTranscript(result.data.content);
  if (!text) {
    return { error: 'No edited transcript content to export', status: 400 };
  }

  return {
    data: {
      text,
      filename: `edited-transcription-${recordingId}.txt`,
    },
  };
}

module.exports = {
  getTranscriptionEdit,
  saveTranscriptionEdit,
  mergeTranscriptionLines,
  assignTranscriptionSpeaker,
  downloadTranscriptionEdit,
  formatEditedTranscript,
  mergeLinesInDocumentOrder,
  SPEAKER_COLORS,
};
