const JITSI_PROVIDER = 'Jitsi';
const JITSI_DEFENSE_PREFIX = 'DEFENSE';
const JITSI_MEETING_PREFIX = 'MEETING';

function getJitsiBaseUrl() {
  const base = process.env.JITSI_BASE_URL || 'https://localhost:8443';
  return String(base).trim().replace(/\/+$/, '');
}

function isOnlineModality(modality) {
  if (!modality) return false;
  const normalized = String(modality).trim().toLowerCase();
  return normalized === 'online' || normalized === 'hybrid';
}

function buildMeetingRoom(prefix, recordId) {
  return `${prefix}-${recordId}`;
}

function buildMeetingUrl(baseUrl, room) {
  return `${baseUrl}/${encodeURIComponent(room)}`;
}

/** Rewrite legacy http://localhost:8000 links to the configured Jitsi base URL. */
function normalizeMeetingUrl(meetingUrl) {
  if (!meetingUrl || typeof meetingUrl !== 'string') return meetingUrl;

  const trimmed = meetingUrl.trim();
  if (!trimmed) return meetingUrl;

  try {
    const parsed = new URL(trimmed);
    const roomPath = parsed.pathname.replace(/^\/+/, '');
    if (!roomPath) return trimmed;

    const isLegacyLocal =
      parsed.hostname === 'localhost' &&
      (parsed.port === '8000' || (parsed.protocol === 'http:' && !parsed.port));

    if (isLegacyLocal) {
      return buildMeetingUrl(getJitsiBaseUrl(), roomPath);
    }
  } catch {
    if (trimmed.includes('localhost:8000')) {
      const room = trimmed.split('localhost:8000/')[1]?.split(/[?#]/)[0];
      if (room) return buildMeetingUrl(getJitsiBaseUrl(), room);
    }
  }

  return trimmed;
}

/**
 * @returns {{ meeting_room: string|null, meeting_url: string|null, meeting_provider: string|null }}
 */
function createJitsiMeetingFields({ prefix, recordId, modality }) {
  if (!isOnlineModality(modality) || !recordId) {
    return { meeting_room: null, meeting_url: null, meeting_provider: null };
  }

  const meeting_room = buildMeetingRoom(prefix, recordId);
  const meeting_url = buildMeetingUrl(getJitsiBaseUrl(), meeting_room);

  return {
    meeting_room,
    meeting_url,
    meeting_provider: JITSI_PROVIDER,
  };
}

function appendMeetingLinkToMessage(message, meetingUrl) {
  if (!meetingUrl) return message;
  return `${message}\n\nMeeting Link:\n${meetingUrl}`;
}

module.exports = {
  JITSI_PROVIDER,
  JITSI_DEFENSE_PREFIX,
  JITSI_MEETING_PREFIX,
  getJitsiBaseUrl,
  isOnlineModality,
  normalizeMeetingUrl,
  createJitsiMeetingFields,
  appendMeetingLinkToMessage,
};
