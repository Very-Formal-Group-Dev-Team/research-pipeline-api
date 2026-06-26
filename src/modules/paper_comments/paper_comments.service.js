const crypto = require('crypto');
const db = require('../../../config/db');
const coordinatorService = require('../coordinator/coordinator.service');
const paperVersionsService = require('../paper_versions/paper_versions.service');
const notificationsService = require('../notifications/notifications.service');
const { getVersionPlainText, hashPlainText } = require('../paper_versions/paper_text.util');
const { remapAnchor, computeTouchedByDiff, buildTextQuoteSelector, resolveAnchorInPlainText } = require('./anchor.service');

const BODY_MIN_LENGTH = 1;
const BODY_MAX_LENGTH = 5000;

function mapCommentRow(row, extras = {}) {
  if (!row) return null;
  let anchor = row.anchor_json;
  if (typeof anchor === 'string') {
    try {
      anchor = JSON.parse(anchor);
    } catch {
      anchor = null;
    }
  }

  return {
    id: row.id,
    project_id: row.project_id,
    anchor_version_id: row.anchor_version_id,
    anchor_version_number: row.anchor_version_number ?? null,
    review_request_id: row.review_request_id,
    parent_id: row.parent_id,
    author_id: row.author_id,
    author_name: row.author_name ?? null,
    author_avatar: row.author_avatar ?? null,
    author_role: row.author_role ?? null,
    body: row.body,
    anchor,
    plain_text_hash: row.plain_text_hash,
    status: row.status,
    resolved_by: row.resolved_by,
    resolved_at: row.resolved_at,
    revision_requested_by: row.revision_requested_by,
    revision_requested_at: row.revision_requested_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    mapped_start: extras.mapped_start ?? null,
    mapped_end: extras.mapped_end ?? null,
    anchor_status: extras.anchor_status ?? null,
    touched_by_diff: extras.touched_by_diff ?? false,
  };
}

async function isAcceptedStudentMember(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND status = 'accepted'
       AND role IN ('leader', 'member')
     LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

async function isAcceptedAdviser(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND status = 'accepted' AND role = 'adviser'
     LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

async function isAcceptedProjectMember(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND status = 'accepted'
     LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

async function userCanView(projectId, userId) {
  const isMember = await isAcceptedProjectMember(projectId, userId);
  if (isMember) return true;
  return coordinatorService.coordinatorCanViewProject(userId, projectId);
}

async function getStudentMemberIds(projectId) {
  const { rows } = await db.query(
    `SELECT user_id FROM project_members
     WHERE project_id = ? AND status = 'accepted' AND role IN ('leader', 'member')`,
    [projectId],
  );
  return rows.map((r) => r.user_id).filter(Boolean);
}

async function getAdviserIds(projectId) {
  const { rows } = await db.query(
    `SELECT user_id FROM project_members
     WHERE project_id = ? AND status = 'accepted' AND role = 'adviser'`,
    [projectId],
  );
  return rows.map((r) => r.user_id).filter(Boolean);
}

async function getVersionPlainTextCached(version) {
  return getVersionPlainText(version);
}

async function enrichCommentForVersion(comment, targetVersion, plainTextCache) {
  const cacheKey = targetVersion.id;
  if (!plainTextCache.has(cacheKey)) {
    plainTextCache.set(cacheKey, await getVersionPlainTextCached(targetVersion));
  }
  const targetText = plainTextCache.get(cacheKey);

  if (!targetText || !comment.anchor) {
    return mapCommentRow(comment, { anchor_status: 'orphaned', touched_by_diff: false });
  }

  const remapped = remapAnchor(targetText, comment.anchor);

  let touchedByDiff = false;
  if (comment.anchor_version_id !== targetVersion.id && remapped.mapped_start != null) {
    const anchorKey = comment.anchor_version_id;
    if (!plainTextCache.has(anchorKey)) {
      const anchorVersion = await paperVersionsService.getPaperVersionById(
        comment.project_id,
        comment.anchor_version_id,
      );
      plainTextCache.set(anchorKey, anchorVersion ? await getVersionPlainTextCached(anchorVersion) : null);
    }
    const anchorText = plainTextCache.get(anchorKey);
    if (anchorText) {
      touchedByDiff = computeTouchedByDiff(
        comment.anchor.exact,
        anchorText,
        targetText,
      );
    }
  }

  return mapCommentRow(comment, {
    mapped_start: remapped.mapped_start,
    mapped_end: remapped.mapped_end,
    anchor_status: remapped.anchor_status,
    touched_by_diff: touchedByDiff,
  });
}

async function listComments(projectId, userId, { versionId, status } = {}) {
  if (!(await userCanView(projectId, userId))) {
    return { error: 'You are not a member of this project', status: 403 };
  }

  if (!versionId) {
    return { error: 'versionId query parameter is required', status: 400 };
  }

  const version = await paperVersionsService.getPaperVersionById(projectId, versionId);
  if (!version) {
    return { error: 'Version not found', status: 404 };
  }

  const params = [projectId, versionId];
  let statusClause = '';
  if (status && ['open', 'resolved', 'needs_revision'].includes(status)) {
    statusClause = ' AND pc.status = ?';
    params.push(status);
  }

  const { rows } = await db.query(
    `SELECT pc.*, pv.version_number AS anchor_version_number,
            u.full_name AS author_name, u.avatar_url AS author_avatar,
            pm.role AS author_role
     FROM paper_comments pc
     JOIN paper_versions pv ON pv.id = pc.anchor_version_id
     JOIN paper_versions target_pv ON target_pv.id = ? AND target_pv.project_id = pc.project_id
     JOIN users u ON u.id = pc.author_id
     LEFT JOIN project_members pm
       ON pm.project_id = pc.project_id
      AND pm.user_id = pc.author_id
      AND pm.status = 'accepted'
     WHERE pc.project_id = ?
       AND pv.version_number <= target_pv.version_number${statusClause}
     ORDER BY pc.created_at ASC`,
    params,
  );

  const plainTextCache = new Map();
  const enriched = await Promise.all(
    rows.map((row) => enrichCommentForVersion(row, version, plainTextCache)),
  );

  return { data: enriched };
}

async function getCommentSummary(projectId, userId) {
  if (!(await userCanView(projectId, userId))) {
    return { error: 'You are not a member of this project', status: 403 };
  }

  const { rows } = await db.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN status = 'needs_revision' THEN 1 ELSE 0 END) AS needs_revision_count,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count
     FROM paper_comments
     WHERE project_id = ?`,
    [projectId],
  );

  const byVersionRows = await db.query(
    `SELECT anchor_version_id,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
            SUM(CASE WHEN status = 'needs_revision' THEN 1 ELSE 0 END) AS needs_revision_count
     FROM paper_comments
     WHERE project_id = ?
     GROUP BY anchor_version_id`,
    [projectId],
  );

  const byVersion = {};
  for (const row of byVersionRows.rows) {
    byVersion[row.anchor_version_id] = {
      open: Number(row.open_count) || 0,
      needs_revision: Number(row.needs_revision_count) || 0,
    };
  }

  const summary = rows[0] || {};
  return {
    data: {
      total: Number(summary.total) || 0,
      open: Number(summary.open_count) || 0,
      needs_revision: Number(summary.needs_revision_count) || 0,
      resolved: Number(summary.resolved_count) || 0,
      by_version: byVersion,
    },
  };
}

function validateAnchor(anchor) {
  if (!anchor || anchor.type !== 'TextQuoteSelector') {
    return 'Invalid anchor: TextQuoteSelector required';
  }
  const exact = (anchor.exact || '').trim();
  if (!exact) {
    return 'Anchor exact text is required';
  }
  if (typeof anchor.start !== 'number' || typeof anchor.end !== 'number') {
    return 'Anchor start and end offsets are required';
  }
  if (anchor.end <= anchor.start) {
    return 'Anchor end must be after start';
  }
  return null;
}

async function getPendingReviewRequestIdForVersion(projectId, versionId) {
  const { rows } = await db.query(
    `SELECT id, paper_version_id
     FROM paper_review_requests
     WHERE project_id = ? AND status = 'pending'
     LIMIT 1`,
    [projectId],
  );
  const row = rows[0];
  if (!row || row.paper_version_id !== versionId) return null;
  return row.id;
}

async function createComment(projectId, userId, { versionId, anchor, body, parentId }) {
  if (!(await userCanView(projectId, userId))) {
    return { error: 'You are not a member of this project', status: 403 };
  }

  const isAdviser = await isAcceptedAdviser(projectId, userId);
  const isStudent = await isAcceptedStudentMember(projectId, userId);

  if (parentId) {
    if (!isAdviser && !isStudent) {
      return { error: 'Only project members can reply to comments', status: 403 };
    }
  } else if (!isAdviser && !isStudent) {
    return { error: 'Only project members can create inline comments', status: 403 };
  }

  const anchorError = validateAnchor(anchor);
  if (anchorError) {
    return { error: anchorError, status: 400 };
  }

  const trimmedBody = String(body || '').trim();
  if (trimmedBody.length < BODY_MIN_LENGTH || trimmedBody.length > BODY_MAX_LENGTH) {
    return { error: `Comment must be between ${BODY_MIN_LENGTH} and ${BODY_MAX_LENGTH} characters`, status: 400 };
  }

  const version = await paperVersionsService.getPaperVersionById(projectId, versionId);
  if (!version) {
    return { error: 'Version not found', status: 404 };
  }

  if (parentId) {
    const { rows: parentRows } = await db.query(
      'SELECT id FROM paper_comments WHERE id = ? AND project_id = ? LIMIT 1',
      [parentId, projectId],
    );
    if (!parentRows.length) {
      return { error: 'Parent comment not found', status: 404 };
    }
  }

  const plainText = await getVersionPlainTextCached(version);
  if (!plainText) {
    return { error: 'Cannot anchor comments on this file type', status: 400 };
  }

  const remapped = resolveAnchorInPlainText(plainText, anchor);
  if (remapped.remapped.anchor_status === 'orphaned') {
    return { error: 'Selected text could not be located in this document version', status: 400 };
  }

  const storedAnchor = remapped.anchor;

  const reviewRequestId = await getPendingReviewRequestIdForVersion(projectId, versionId);

  const plainTextHash = hashPlainText(plainText);
  const commentId = crypto.randomUUID();

  await db.query(
    `INSERT INTO paper_comments
       (id, project_id, anchor_version_id, review_request_id, parent_id, author_id, body, anchor_json, plain_text_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
    [
      commentId,
      projectId,
      versionId,
      reviewRequestId,
      parentId || null,
      userId,
      trimmedBody,
      JSON.stringify(storedAnchor),
      plainTextHash,
    ],
  );

  const { rows } = await db.query(
    `SELECT pc.*, pv.version_number AS anchor_version_number,
            u.full_name AS author_name, u.avatar_url AS author_avatar,
            pm.role AS author_role
     FROM paper_comments pc
     JOIN paper_versions pv ON pv.id = pc.anchor_version_id
     JOIN users u ON u.id = pc.author_id
     LEFT JOIN project_members pm
       ON pm.project_id = pc.project_id
      AND pm.user_id = pc.author_id
      AND pm.status = 'accepted'
     WHERE pc.id = ?
     LIMIT 1`,
    [commentId],
  );

  const plainTextCache = new Map();
  const enriched = await enrichCommentForVersion(rows[0], version, plainTextCache);

  if (!parentId) {
    const { rows: projectRows } = await db.query(
      'SELECT title FROM projects WHERE id = ? LIMIT 1',
      [projectId],
    );
    const projectTitle = projectRows[0]?.title || 'your project';
    const authorName = rows[0]?.author_name || 'A project member';

    if (isAdviser) {
      const studentIds = await getStudentMemberIds(projectId);
      const recipients = studentIds.filter((id) => id !== userId);

      await Promise.all(
        recipients.map((recipientId) =>
          notificationsService.createNotification({
            userId: recipientId,
            type: 'comment_added',
            title: 'New manuscript comment',
            message: `${authorName} left a comment on "${projectTitle}" (version ${version.version_number}).`,
            metadata: {
              projectId,
              paperVersionId: versionId,
              versionNumber: version.version_number,
              commentId,
            },
          }),
        ),
      );
    } else if (isStudent) {
      const adviserIds = await getAdviserIds(projectId);
      const recipients = adviserIds.filter((id) => id !== userId);

      await Promise.all(
        recipients.map((recipientId) =>
          notificationsService.createNotification({
            userId: recipientId,
            type: 'comment_added',
            title: 'New student comment',
            message: `${authorName} left a comment on "${projectTitle}" (version ${version.version_number}).`,
            metadata: {
              projectId,
              paperVersionId: versionId,
              versionNumber: version.version_number,
              commentId,
            },
          }),
        ),
      );
    }
  }

  return { data: enriched, status: 201 };
}

async function getCommentById(projectId, commentId) {
  const { rows } = await db.query(
    `SELECT pc.*, pv.version_number AS anchor_version_number,
            u.full_name AS author_name, u.avatar_url AS author_avatar,
            pm.role AS author_role
     FROM paper_comments pc
     JOIN paper_versions pv ON pv.id = pc.anchor_version_id
     JOIN users u ON u.id = pc.author_id
     LEFT JOIN project_members pm
       ON pm.project_id = pc.project_id
      AND pm.user_id = pc.author_id
      AND pm.status = 'accepted'
     WHERE pc.id = ? AND pc.project_id = ?
     LIMIT 1`,
    [commentId, projectId],
  );
  return rows[0] || null;
}

async function resolveComment(projectId, commentId, userId) {
  if (!(await userCanView(projectId, userId))) {
    return { error: 'You are not a member of this project', status: 403 };
  }

  const isAdviser = await isAcceptedAdviser(projectId, userId);
  const isStudent = await isAcceptedStudentMember(projectId, userId);
  if (!isAdviser && !isStudent) {
    return { error: 'Only project members can resolve comments', status: 403 };
  }

  const comment = await getCommentById(projectId, commentId);
  if (!comment) {
    return { error: 'Comment not found', status: 404 };
  }

  if (comment.status === 'resolved') {
    return { data: mapCommentRow(comment) };
  }

  await db.query(
    `UPDATE paper_comments
     SET status = 'resolved', resolved_by = ?, resolved_at = NOW(),
         revision_requested_by = NULL, revision_requested_at = NULL
     WHERE id = ?`,
    [userId, commentId],
  );

  const updated = await getCommentById(projectId, commentId);

  if (isStudent) {
    const adviserIds = await getAdviserIds(projectId);
    const { rows: projectRows } = await db.query(
      'SELECT title FROM projects WHERE id = ? LIMIT 1',
      [projectId],
    );
    const { rows: userRows } = await db.query(
      'SELECT full_name FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    const projectTitle = projectRows[0]?.title || 'your project';
    const resolverName = userRows[0]?.full_name || 'A student';

    await Promise.all(
      adviserIds.filter((id) => id !== userId).map((adviserId) =>
        notificationsService.createNotification({
          userId: adviserId,
          type: 'comment_resolved',
          title: 'Comment resolved',
          message: `${resolverName} resolved a comment on "${projectTitle}".`,
          metadata: { projectId, commentId, paperVersionId: comment.anchor_version_id },
        }),
      ),
    );
  }

  return { data: mapCommentRow(updated) };
}

async function requestRevision(projectId, commentId, userId) {
  if (!(await isAcceptedAdviser(projectId, userId))) {
    return { error: 'Only advisers can request revision on a comment', status: 403 };
  }

  const comment = await getCommentById(projectId, commentId);
  if (!comment) {
    return { error: 'Comment not found', status: 404 };
  }

  await db.query(
    `UPDATE paper_comments
     SET status = 'needs_revision',
         revision_requested_by = ?, revision_requested_at = NOW(),
         resolved_by = NULL, resolved_at = NULL
     WHERE id = ?`,
    [userId, commentId],
  );

  const updated = await getCommentById(projectId, commentId);

  const { rows: projectRows } = await db.query(
    'SELECT title FROM projects WHERE id = ? LIMIT 1',
    [projectId],
  );
  const { rows: adviserRows } = await db.query(
    'SELECT full_name FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  const projectTitle = projectRows[0]?.title || 'your project';
  const adviserName = adviserRows[0]?.full_name || 'Your adviser';
  const studentIds = await getStudentMemberIds(projectId);

  await Promise.all(
    studentIds.map((studentId) =>
      notificationsService.createNotification({
        userId: studentId,
        type: 'revision_requested',
        title: 'Revision requested',
        message: `${adviserName} requested further revision on a comment in "${projectTitle}".`,
        metadata: { projectId, commentId, paperVersionId: comment.anchor_version_id },
      }),
    ),
  );

  return { data: mapCommentRow(updated) };
}

async function reopenComment(projectId, commentId, userId) {
  if (!(await userCanView(projectId, userId))) {
    return { error: 'You are not a member of this project', status: 403 };
  }

  const comment = await getCommentById(projectId, commentId);
  if (!comment) {
    return { error: 'Comment not found', status: 404 };
  }

  await db.query(
    `UPDATE paper_comments
     SET status = 'open', resolved_by = NULL, resolved_at = NULL,
         revision_requested_by = NULL, revision_requested_at = NULL
     WHERE id = ?`,
    [commentId],
  );

  const updated = await getCommentById(projectId, commentId);
  return { data: mapCommentRow(updated) };
}

async function updateCommentBody(projectId, commentId, userId, body) {
  const comment = await getCommentById(projectId, commentId);
  if (!comment) {
    return { error: 'Comment not found', status: 404 };
  }

  if (comment.author_id !== userId) {
    return { error: 'Only the author can edit this comment', status: 403 };
  }

  const createdAt = new Date(comment.created_at).getTime();
  const fifteenMinutes = 15 * 60 * 1000;
  if (Date.now() - createdAt > fifteenMinutes) {
    return { error: 'Comments can only be edited within 15 minutes of posting', status: 403 };
  }

  const trimmedBody = String(body || '').trim();
  if (trimmedBody.length < BODY_MIN_LENGTH || trimmedBody.length > BODY_MAX_LENGTH) {
    return { error: `Comment must be between ${BODY_MIN_LENGTH} and ${BODY_MAX_LENGTH} characters`, status: 400 };
  }

  await db.query('UPDATE paper_comments SET body = ? WHERE id = ?', [trimmedBody, commentId]);
  const updated = await getCommentById(projectId, commentId);
  return { data: mapCommentRow(updated) };
}

async function linkCommentsToReviewOnComplete(projectId, reviewRequestId, paperVersionId) {
  await db.query(
    `UPDATE paper_comments
     SET review_request_id = ?
     WHERE project_id = ?
       AND anchor_version_id = ?
       AND review_request_id IS NULL
       AND parent_id IS NULL`,
    [reviewRequestId, projectId, paperVersionId],
  );
}

async function getOpenCommentCountsForReview(projectId, paperVersionId) {
  const { rows } = await db.query(
    `SELECT
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN status = 'needs_revision' THEN 1 ELSE 0 END) AS needs_revision_count,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count
     FROM paper_comments
     WHERE project_id = ?
       AND anchor_version_id = ?
       AND parent_id IS NULL`,
    [projectId, paperVersionId],
  );
  const row = rows[0] || {};
  return {
    open: Number(row.open_count) || 0,
    needs_revision: Number(row.needs_revision_count) || 0,
    resolved: Number(row.resolved_count) || 0,
  };
}

module.exports = {
  listComments,
  getCommentSummary,
  createComment,
  resolveComment,
  requestRevision,
  reopenComment,
  updateCommentBody,
  linkCommentsToReviewOnComplete,
  getOpenCommentCountsForReview,
  buildTextQuoteSelector,
  userCanView,
};
