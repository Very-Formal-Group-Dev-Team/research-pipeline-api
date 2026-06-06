const path = require('path');
const fs = require('fs');
const db = require('../../../config/db');
const { uploadBase } = require('../../../config/env');
const notificationsService = require('../notifications/notifications.service');

const FILES_DIR = path.join(uploadBase, 'files');

function safeUnlinkUploadedFile(fileUrl) {
  if (!fileUrl) return;
  const filename = path.basename(String(fileUrl));
  const absolutePath = path.normalize(path.join(FILES_DIR, filename));
  const normalizedDir = path.normalize(FILES_DIR);
  if (!absolutePath.startsWith(normalizedDir)) return;
  try {
    if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
  } catch {
    // Best-effort file cleanup; DB delete still proceeds.
  }
}

async function createProject({
  title,
  abstract,
  keywords,
  researchType,
  projectType,
  program,
  course,
  courseId,
  section,
  documentReference,
  createdBy,
}) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [roleRows] = await conn.execute(
      `SELECT institution_id FROM user_roles WHERE user_id = ? LIMIT 1`,
      [createdBy]
    );
    const institutionId = roleRows[0]?.institution_id || null;

    let resolvedCourseId = courseId || null;
    let resolvedCourseName = course || null;

    if (resolvedCourseId && institutionId) {
      const institutionsService = require('../institutions/institutions.service');
      const courseRow = await institutionsService.getCourseForInstitution(
        institutionId,
        resolvedCourseId,
      );
      if (!courseRow) {
        throw new Error('Selected course is not available in your institution');
      }
      resolvedCourseName = courseRow.course_name;
    }

    const normalizedProjectType = String(projectType || 'thesis').trim().toLowerCase();
    const safeProjectType =
      normalizedProjectType === 'capstone' ? 'capstone' : 'thesis';

    const [result] = await conn.execute(
      `INSERT INTO projects (title, description, abstract, keywords, paper_standard, program, course, course_id, section, document_reference, created_by, institution_id, status, project_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'topic_proposal', ?)`,
      [
        title,
        abstract,
        abstract,
        JSON.stringify(keywords || []),
        (researchType || 'ieee').toLowerCase(),
        program || null,
        resolvedCourseName,
        resolvedCourseId,
        section || null,
        documentReference || null,
        createdBy,
        institutionId,
        safeProjectType,
      ]
    );

    const [rows] = await conn.execute(
      'SELECT * FROM projects WHERE id = LAST_INSERT_ID() OR (created_by = ? AND title = ?) ORDER BY created_at DESC LIMIT 1',
      [createdBy, title]
    );

    if (!rows.length) {
      throw new Error('Failed to retrieve created project');
    }

    const project = rows[0];

    await conn.execute(
      `INSERT INTO project_members (project_id, user_id, role, status) VALUES (?, ?, 'leader', 'accepted')`,
      [project.id, createdBy]
    );

    await conn.commit();
    return project;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getProjectsByUser(userId) {
  const { rows } = await db.query(
    `SELECT p.*,
            (
              SELECT pm.role
              FROM project_members pm
              WHERE pm.project_id = p.id
                AND pm.user_id = ?
                AND pm.status = 'accepted'
              ORDER BY pm.id DESC
              LIMIT 1
            ) AS member_role
     FROM projects p
     WHERE p.created_by = ?
        OR EXISTS (
          SELECT 1
          FROM project_members pm_self
          WHERE pm_self.project_id = p.id
            AND pm_self.user_id = ?
            AND pm_self.status = 'accepted'
        )
     ORDER BY p.created_at DESC`,
    [userId, userId, userId]
  );
  return rows;
}

async function getProjectById(projectId) {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = ?', [projectId]);
  return rows[0] || null;
}

async function getProjectMembers(projectId) {
  const { rows } = await db.query(
    `SELECT pm.*, u.full_name, u.email, u.avatar_url
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ? AND pm.status = 'accepted'
     ORDER BY pm.invited_at ASC`,
    [projectId]
  );

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    role: r.role,
    status: r.status,
    is_main_adviser: r.is_main_adviser == null ? null : Boolean(r.is_main_adviser),
    invited_at: r.invited_at,
    users: {
      full_name: r.full_name,
      email: r.email,
      avatar_url: r.avatar_url,
    },
  }));
}

async function assignMainAdviserOnAccept(conn, projectId, memberId) {
  const [existingMainRows] = await conn.execute(
    `SELECT id FROM project_members
     WHERE project_id = ? AND role = 'adviser' AND status = 'accepted' AND is_main_adviser = 1
       AND id != ?
     LIMIT 1`,
    [projectId, memberId],
  );
  const isMain = !existingMainRows.length;
  await conn.execute(
    'UPDATE project_members SET is_main_adviser = ? WHERE id = ?',
    [isMain ? 1 : 0, memberId],
  );
}

async function promoteNextMainAdviser(conn, projectId) {
  const [rows] = await conn.execute(
    `SELECT id FROM project_members
     WHERE project_id = ? AND role = 'adviser' AND status = 'accepted'
     ORDER BY invited_at ASC, id ASC
     LIMIT 1`,
    [projectId],
  );
  await conn.execute(
    'UPDATE project_members SET is_main_adviser = 0 WHERE project_id = ? AND role = ?',
    [projectId, 'adviser'],
  );
  if (rows[0]?.id) {
    await conn.execute(
      'UPDATE project_members SET is_main_adviser = 1 WHERE id = ?',
      [rows[0].id],
    );
  }
}

async function addProjectFile({ projectId, fileUrl, fileName, fileSize, mimeType, uploadedBy }) {
  await db.query(
    `INSERT INTO project_files (project_id, file_url, file_name, file_size, mime_type, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectId, fileUrl, fileName, fileSize, mimeType || null, uploadedBy]
  );
}

async function updateProjectDocumentRef(projectId, documentReference) {
  await db.query(
    'UPDATE projects SET document_reference = ? WHERE id = ?',
    [documentReference, projectId]
  );
}

async function getProjectFiles(projectId) {
  const { rows } = await db.query(
    'SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at DESC',
    [projectId]
  );
  return rows;
}

async function getLatestPaperVersion(projectId) {
  const { rows } = await db.query(
    `SELECT *
     FROM paper_versions
     WHERE project_id = ?
     ORDER BY version_number DESC, created_at DESC
     LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}

async function updateProjectKeywords(projectId, keywords) {
  await db.query(
    'UPDATE projects SET keywords = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(keywords || []), projectId]
  );
}

async function getProjectByCode(projectCode) {
  const { rows } = await db.query(
    'SELECT * FROM projects WHERE project_code = ? LIMIT 1',
    [projectCode]
  );
  return rows[0] || null;
}

async function isProjectMember(projectId, userId) {
  const { rows } = await db.query(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1',
    [projectId, userId]
  );
  return rows.length > 0;
}

async function getProjectMembership(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id, role, status, join_source, is_main_adviser
     FROM project_members
     WHERE project_id = ? AND user_id = ?
     LIMIT 1`,
    [projectId, userId],
  );
  return rows[0] || null;
}

async function getProjectLeaderId(projectId) {
  const { rows } = await db.query(
    `SELECT user_id
     FROM project_members
     WHERE project_id = ? AND role = 'leader' AND status = 'accepted'
     LIMIT 1`,
    [projectId],
  );
  return rows[0]?.user_id || null;
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

async function joinProject(projectId, userId, memberRole) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO project_members (project_id, user_id, role, join_source, status)
       VALUES (?, ?, ?, NULL, 'accepted')`,
      [projectId, userId, memberRole],
    );
    if (memberRole === 'adviser') {
      const [memberRows] = await conn.execute(
        `SELECT id FROM project_members
         WHERE project_id = ? AND user_id = ? AND status = 'accepted'
         ORDER BY invited_at DESC
         LIMIT 1`,
        [projectId, userId],
      );
      if (memberRows[0]?.id) {
        await assignMainAdviserOnAccept(conn, projectId, memberRows[0].id);
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function requestJoinProject(projectId, userId) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existingRows] = await conn.execute(
      `SELECT id, status
       FROM project_members
       WHERE project_id = ? AND user_id = ?
       LIMIT 1`,
      [projectId, userId],
    );
    const existing = existingRows[0] || null;

    if (existing?.status === 'accepted') {
      throw new Error('ALREADY_MEMBER');
    }
    if (existing?.status === 'pending') {
      throw new Error('PENDING_REQUEST');
    }

    let memberId;
    if (existing?.status === 'declined') {
      await conn.execute(
        `UPDATE project_members
         SET status = 'pending',
             join_source = 'code_request',
             role = 'member',
             invited_at = NOW(),
             responded_at = NULL
         WHERE id = ?`,
        [existing.id],
      );
      memberId = existing.id;
    } else {
      await conn.execute(
        `INSERT INTO project_members (project_id, user_id, role, join_source, status)
         VALUES (?, ?, 'member', 'code_request', 'pending')`,
        [projectId, userId],
      );

      const [memberRows] = await conn.execute(
        `SELECT id FROM project_members
         WHERE project_id = ? AND user_id = ? AND status = 'pending'
         ORDER BY invited_at DESC
         LIMIT 1`,
        [projectId, userId],
      );
      memberId = memberRows[0]?.id || null;
    }

    const [infoRows] = await conn.execute(
      `SELECT p.title, requester.full_name AS requester_name
       FROM projects p
       JOIN users requester ON requester.id = ?
       WHERE p.id = ?
       LIMIT 1`,
      [userId, projectId],
    );

    if (!infoRows.length) {
      throw new Error('Project not found while creating join request');
    }

    const project = infoRows[0];
    const leaderId = await getProjectLeaderId(projectId);
    const requesterName = project.requester_name || 'A student';

    if (leaderId && leaderId !== userId) {
      await notificationsService.createNotification({
        userId: leaderId,
        type: 'join_request',
        title: 'Join request',
        message: `${requesterName} requested to join "${project.title}" via project code.`,
        metadata: {
          projectId,
          memberId,
          requesterUserId: userId,
        },
        conn,
      });
    }

    await conn.commit();
    return { memberId, status: 'pending' };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function respondToJoinRequest(memberId, accept, leaderUserId) {
  const status = accept ? 'accepted' : 'declined';

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [memberRows] = await conn.execute(
      `SELECT pm.id,
              pm.project_id,
              pm.user_id,
              pm.role,
              pm.status,
              pm.join_source,
              p.title AS project_title,
              requester.full_name AS requester_name,
              leader.full_name AS leader_name
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       LEFT JOIN users requester ON requester.id = pm.user_id
       LEFT JOIN users leader ON leader.id = ?
       WHERE pm.id = ?
       LIMIT 1`,
      [leaderUserId, memberId],
    );

    if (!memberRows.length) {
      throw new Error('Join request not found');
    }

    const member = memberRows[0];

    if (member.join_source !== 'code_request') {
      throw new Error('This membership is not a join request');
    }

    if (member.status !== 'pending') {
      throw new Error('Join request has already been responded to');
    }

    const projectLeaderId = await getProjectLeaderId(member.project_id);
    if (!projectLeaderId || projectLeaderId !== leaderUserId) {
      throw new Error('Only the project leader can respond to join requests');
    }

    const [updateResult] = await conn.execute(
      `UPDATE project_members
       SET status = ?, responded_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [status, memberId],
    );

    if (!updateResult.affectedRows) {
      throw new Error('Join request not found or already responded to');
    }

    await notificationsService.deleteJoinRequestNotifications({
      userId: leaderUserId,
      projectId: member.project_id,
      memberId: member.id,
      conn,
    });

    const leaderName = member.leader_name || 'The project leader';
    await notificationsService.createNotification({
      userId: member.user_id,
      type: 'join_request',
      title: accept ? 'Join request accepted' : 'Join request declined',
      message: accept
        ? `${leaderName} accepted your request to join "${member.project_title}".`
        : `${leaderName} declined your request to join "${member.project_title}".`,
      metadata: {
        projectId: member.project_id,
        memberId: member.id,
        status,
      },
      conn,
    });

    await conn.commit();
    return {
      projectId: member.project_id,
      userId: member.user_id,
      status,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function inviteToProject(projectId, userId, role, invitedByUserId, contributorRole = null) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO project_members (project_id, user_id, role, contributor_role, join_source, status)
       VALUES (?, ?, ?, ?, 'invite', 'pending')`,
      [projectId, userId, role, contributorRole || null]
    );

    const [memberRows] = await conn.execute(
      `SELECT id FROM project_members
       WHERE project_id = ? AND user_id = ? AND status = 'pending'
       ORDER BY invited_at DESC
       LIMIT 1`,
      [projectId, userId],
    );
    const invitationId = memberRows[0]?.id || null;

    const [projectRows] = await conn.execute(
      `SELECT p.title,
              p.created_by,
              creator.full_name AS created_by_name,
              inviter.full_name AS invited_by_name
       FROM projects p
       JOIN users creator ON creator.id = p.created_by
       LEFT JOIN users inviter ON inviter.id = ?
       WHERE p.id = ?
       LIMIT 1`,
      [invitedByUserId, projectId]
    );

    if (!projectRows.length) {
      throw new Error('Project not found while creating invitation notification');
    }

    const project = projectRows[0];
    const inviterName = project.invited_by_name || project.created_by_name || 'a user';
    const roleLabel = contributorRole || role;

    await notificationsService.createNotification({
      userId,
      type: 'invitation',
      title: 'Project invitation',
      message: `You were invited by ${inviterName} to join "${project.title}" as ${roleLabel}.`,
      metadata: {
        projectId,
        invitationId,
        role,
        contributorRole: contributorRole || null,
        invitedByUserId: invitedByUserId || project.created_by,
      },
      conn,
    });

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getPendingInvitationsForUser(userId) {
  const { rows } = await db.query(
    `SELECT pm.id, pm.project_id, pm.role, pm.contributor_role, pm.status, pm.invited_at,
            p.title AS project_title, p.project_code,
            creator.full_name AS invited_by_name, creator.email AS invited_by_email
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     JOIN users creator ON creator.id = p.created_by
     WHERE pm.user_id = ?
       AND pm.status = 'pending'
       AND (pm.join_source IS NULL OR pm.join_source = 'invite')
     ORDER BY pm.invited_at DESC`,
    [userId]
  );
  return rows;
}

async function getInvitationById(invitationId) {
  const { rows } = await db.query(
    'SELECT * FROM project_members WHERE id = ? LIMIT 1',
    [invitationId]
  );
  return rows[0] || null;
}

async function respondToInvitation(invitationId, accept, respondedByUserId) {
  const status = accept ? 'accepted' : 'declined';

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [invitationRows] = await conn.execute(
      `SELECT pm.id,
              pm.project_id,
              pm.user_id,
              pm.role,
              pm.status,
              p.title AS project_title,
              p.created_by,
              responder.full_name AS responder_name
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       LEFT JOIN users responder ON responder.id = ?
       WHERE pm.id = ?
       LIMIT 1`,
      [respondedByUserId, invitationId]
    );

    if (!invitationRows.length) {
      throw new Error('Invitation not found while responding');
    }

    const invitation = invitationRows[0];

    const [updateResult] = await conn.execute(
      `UPDATE project_members
       SET status = ?, responded_at = NOW()
       WHERE id = ? AND user_id = ? AND status = 'pending'`,
      [status, invitationId, respondedByUserId],
    );

    if (!updateResult.affectedRows) {
      throw new Error('Invitation not found or already responded to');
    }

    if (accept && invitation.role === 'adviser') {
      await assignMainAdviserOnAccept(conn, invitation.project_id, invitation.id);
    }

    await notificationsService.deleteProjectInvitationNotifications({
      userId: invitation.user_id,
      projectId: invitation.project_id,
      invitationId: invitation.id,
      conn,
    });

    if (invitation.created_by && invitation.created_by !== respondedByUserId) {
      const responderName = invitation.responder_name || 'A user';
      await notificationsService.createNotification({
        userId: invitation.created_by,
        type: 'invitation',
        title: 'Invitation response',
        message: `${responderName} ${accept ? 'accepted' : 'declined'} your invitation to join "${invitation.project_title}" as ${invitation.role}.`,
        metadata: {
          projectId: invitation.project_id,
          invitationId,
          invitedUserId: invitation.user_id,
          role: invitation.role,
          status,
        },
        conn,
      });
    }

    await conn.commit();
    return {
      projectId: invitation.project_id,
      role: invitation.role,
      status,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function notifyProjectMembersDefenseScheduled({
  projectId,
  defenseType,
  scheduledAt,
  location,
  triggeredByUserId,
  conn = null,
}) {
  const queryRunner = conn || db;
  const { rows } = await queryRunner.query(
    `SELECT pm.user_id, p.title
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     WHERE pm.project_id = ? AND pm.status = 'accepted'`,
    [projectId]
  );

  const recipients = rows
    .map((row) => row.user_id)
    .filter((userId) => userId && userId !== triggeredByUserId);

  if (!recipients.length) {
    return;
  }

  const projectTitle = rows[0]?.title || 'your project';
  const formattedType = defenseType || 'Defense';
  const scheduledLabel = scheduledAt
    ? new Date(scheduledAt).toLocaleString('en-US', { hour12: true })
    : 'TBA';

  await Promise.all(
    recipients.map((userId) => notificationsService.createNotification({
      userId,
      type: 'schedule',
      title: 'Defense schedule updated',
      message: `${formattedType} for "${projectTitle}" is scheduled on ${scheduledLabel}${location ? ` at ${location}` : ''}.`,
      metadata: {
        projectId,
        defenseType: defenseType || null,
        scheduledAt: scheduledAt || null,
        location: location || null,
      },
      conn,
    }))
  );
}

async function createDefenseSchedule({ projectId, defenseType, scheduledAt, location, createdBy }) {
  const conn = await db.pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO defenses (project_id, defense_type, scheduled_at, location, status, created_by)
       VALUES (?, ?, ?, ?, 'scheduled', ?)`,
      [projectId, defenseType, scheduledAt, location || null, createdBy]
    );

    const [rows] = await conn.execute(
      `SELECT * FROM defenses
       WHERE project_id = ? AND defense_type = ? AND scheduled_at = ? AND created_by = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId, defenseType, scheduledAt, createdBy]
    );

    await notifyProjectMembersDefenseScheduled({
      projectId,
      defenseType,
      scheduledAt,
      location,
      triggeredByUserId: createdBy,
      conn,
    });

    await conn.commit();
    return rows[0] || null;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getProjectInvitations(projectId) {
  const { rows } = await db.query(
    `SELECT pm.*, u.full_name, u.email, u.avatar_url
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ? AND pm.status = 'pending'
     ORDER BY pm.invited_at DESC`,
    [projectId]
  );
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    role: r.role,
    status: r.status,
    join_source: r.join_source || 'invite',
    invited_at: r.invited_at,
    users: {
      full_name: r.full_name,
      email: r.email,
      avatar_url: r.avatar_url,
    },
  }));
}

async function removeProjectMember(projectId, memberId, requestedByUserId) {
  const canManage = await isAcceptedProjectMember(projectId, requestedByUserId);
  if (!canManage) {
    return { error: 'You must be an accepted project member to manage the team', status: 403 };
  }

  const { rows } = await db.query(
    `SELECT id, user_id, role, status, join_source, is_main_adviser
     FROM project_members
     WHERE id = ? AND project_id = ?
     LIMIT 1`,
    [memberId, projectId],
  );
  const member = rows[0];
  if (!member) {
    return { error: 'Team member not found', status: 404 };
  }

  if (member.role === 'leader') {
    return { error: 'Cannot remove the project leader', status: 400 };
  }

  const wasMainAdviser = member.role === 'adviser' && member.is_main_adviser === 1;

  if (!['pending', 'accepted'].includes(member.status)) {
    return { error: 'This team member cannot be removed', status: 400 };
  }

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    if (member.status === 'pending') {
      if (member.join_source === 'code_request') {
        const leaderId = await getProjectLeaderId(projectId);
        if (leaderId) {
          await notificationsService.deleteJoinRequestNotifications({
            userId: leaderId,
            projectId,
            memberId: member.id,
            conn,
          });
        }
      } else {
        await notificationsService.deleteProjectInvitationNotifications({
          userId: member.user_id,
          projectId,
          invitationId: member.id,
          conn,
        });
      }
    }

    await conn.execute('DELETE FROM project_members WHERE id = ?', [memberId]);

    if (wasMainAdviser && member.status === 'accepted') {
      await promoteNextMainAdviser(conn, projectId);
    }

    await conn.commit();

    return {
      success: true,
      reverted: member.status === 'pending',
      removed: member.status === 'accepted',
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getAdvisedProjects(userId) {
  const { rows } = await db.query(
    `SELECT DISTINCT p.*, pm.role AS member_role
     FROM projects p
     INNER JOIN project_members pm
       ON pm.project_id = p.id
      AND pm.user_id = ?
      AND pm.status = 'accepted'
      AND pm.role = 'adviser'
     ORDER BY p.created_at DESC`,
    [userId],
  );
  return rows;
}

function parseScheduleStart(row) {
  const raw = row.start_time || row.scheduled_at;
  if (!raw) return null;
  const parsed = new Date(String(raw).replace(/Z$/i, ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countUpcomingScheduleItems(schedule) {
  const now = new Date();
  const inactive = new Set(['cancelled', 'rejected', 'completed']);
  const rows = [
    ...(schedule.defenses || []),
    ...(schedule.meetings || []),
    ...(schedule.events || []),
  ];
  let count = 0;
  for (const row of rows) {
    const status = String(row.status || '').toLowerCase();
    if (inactive.has(status)) continue;
    const start = parseScheduleStart(row);
    if (start && start >= now) count += 1;
  }
  return count;
}

function toCount(value) {
  if (value == null) return 0;
  if (typeof value === 'bigint') return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function getAdviserDashboardStats(adviserUserId) {
  const advisedProjects = await getAdvisedProjects(adviserUserId);

  let totalAdvisees = 0;
  if (advisedProjects.length > 0) {
    const projectIds = advisedProjects.map((p) => p.id);
    const placeholders = projectIds.map(() => '?').join(', ');
    const { rows } = await db.query(
      `SELECT COUNT(DISTINCT pm.user_id) AS cnt
       FROM project_members pm
       WHERE pm.project_id IN (${placeholders})
         AND LOWER(pm.role) IN ('member', 'leader')
         AND pm.status = 'accepted'
         AND pm.user_id != ?`,
      [...projectIds, adviserUserId],
    );
    totalAdvisees = toCount(rows[0]?.cnt ?? rows[0]?.count);
  }

  let activeProjects = 0;
  let completedProjects = 0;
  for (const project of advisedProjects) {
    const status = String(project.status || 'topic_proposal').toLowerCase();
    if (status === 'completed' || status === 'for_publication' || status === 'archived') {
      completedProjects += 1;
    } else if (status !== 'rejected') {
      activeProjects += 1;
    }
  }

  let upcomingEvents = 0;
  try {
    const { getMySchedule } = require('../schedule/schedule.service');
    const schedule = await getMySchedule(adviserUserId);
    upcomingEvents = countUpcomingScheduleItems(schedule);
  } catch (err) {
    console.error('getAdviserDashboardStats – schedule count failed:', err);
  }

  return {
    totalAdvisees,
    activeProjects,
    completedProjects,
    upcomingEvents,
  };
}

const ALLOWED_STATUSES = new Set([
  'topic_proposal',
  'approved',
  'ongoing',
  'for_pre_defense',
  'for_final_defense',
  'completed',
  'for_publication',
  'rejected',
]);

const PROJECT_STAGE_LABELS = {
  topic_proposal: 'Topic Proposal',
  approved: 'Approved',
  ongoing: 'Ongoing',
  for_pre_defense: 'For Pre-Defense',
  for_final_defense: 'For Final Defense',
  completed: 'Completed',
  for_publication: 'For Publication',
  rejected: 'Rejected',
};

function normalizeProjectStatus(status) {
  const current = String(status || 'topic_proposal').trim().toLowerCase();
  if (current === 'draft') return 'topic_proposal';
  if (current === 'active') return 'ongoing';
  if (current === 'archived') return 'completed';
  return current;
}

function formatProjectStageLabel(stage) {
  return PROJECT_STAGE_LABELS[stage] || stage;
}

async function notifyProjectMembersStageUpdated({
  projectId,
  newStage,
  previousStage,
  triggeredByUserId,
}) {
  const { rows } = await db.query(
    `SELECT pm.user_id, p.title, adviser.full_name AS adviser_name
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     LEFT JOIN users adviser ON adviser.id = ?
     WHERE pm.project_id = ? AND pm.status = 'accepted'`,
    [triggeredByUserId, projectId],
  );

  const recipients = rows
    .map((row) => row.user_id)
    .filter((userId) => userId && userId !== triggeredByUserId);

  if (!recipients.length) {
    return;
  }

  const projectTitle = rows[0]?.title || 'your project';
  const adviserName = rows[0]?.adviser_name || 'Your adviser';

  await Promise.all(
    recipients.map((userId) =>
      notificationsService.upsertUnreadProjectStageNotification({
        userId,
        projectId,
        title: 'Research stage updated',
        adviserName,
        projectTitle,
        newStage,
        previousStage,
        updatedByUserId: triggeredByUserId,
        formatStageLabel: formatProjectStageLabel,
      }),
    ),
  );
}

async function isProjectAdviser(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND role = 'adviser' AND status = 'accepted'
     LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

async function isMainProjectAdviser(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND role = 'adviser' AND status = 'accepted' AND is_main_adviser = 1
     LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

async function updateProjectStatus(projectId, status, userId) {
  const normalized = String(status || '').trim().toLowerCase();
  const mapped =
    normalized === 'draft'
      ? 'topic_proposal'
      : normalized === 'active'
        ? 'ongoing'
        : normalized === 'archived'
          ? 'completed'
          : normalized;

  if (!ALLOWED_STATUSES.has(mapped)) {
    return {
      error:
        'Invalid stage. Allowed: topic_proposal, approved, ongoing, for_pre_defense, for_final_defense, completed, for_publication, rejected',
    };
  }

  const isAdviser = await isProjectAdviser(projectId, userId);
  if (!isAdviser) {
    return { error: 'Only the project adviser can update research stage' };
  }

  const project = await getProjectById(projectId);
  if (!project) {
    return { error: 'Project not found' };
  }

  const currentMapped = normalizeProjectStatus(project.status);

  if (mapped === 'rejected' && currentMapped === 'rejected') {
    return { error: 'Project is already rejected' };
  }

  if (currentMapped === mapped) {
    return { data: project };
  }

  await db.query(
    'UPDATE projects SET status = ?, updated_at = NOW() WHERE id = ?',
    [mapped, projectId]
  );

  await notifyProjectMembersStageUpdated({
    projectId,
    newStage: mapped,
    previousStage: currentMapped,
    triggeredByUserId: userId,
  });

  const updated = await getProjectById(projectId);
  return { data: updated };
}

const ALLOWED_PAPER_STANDARDS = ['ieee', 'apa', 'mla', 'chicago', 'imrad', 'custom'];

function normalizePaperStandard(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_PAPER_STANDARDS.includes(normalized) ? normalized : null;
}

function normalizeProjectType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'capstone' ? 'capstone' : normalized === 'thesis' ? 'thesis' : null;
}

async function updateProjectDetails(projectId, details) {
  const {
    title,
    projectType,
    paperStandard,
    program,
    course,
    courseId,
    section,
  } = details;

  let resolvedCourseId = courseId || null;
  let resolvedCourseName = course || null;

  if (resolvedCourseId) {
    const { rows: projectRows } = await db.query(
      'SELECT institution_id FROM projects WHERE id = ? LIMIT 1',
      [projectId],
    );
    const institutionId = projectRows[0]?.institution_id || null;

    if (institutionId) {
      const institutionsService = require('../institutions/institutions.service');
      const courseRow = await institutionsService.getCourseForInstitution(
        institutionId,
        resolvedCourseId,
      );
      if (!courseRow) {
        throw new Error('Selected course is not available in your institution');
      }
      resolvedCourseName = courseRow.course_name;
    } else {
      resolvedCourseId = null;
    }
  }

  await db.query(
    `UPDATE projects
     SET title = ?,
         project_type = ?,
         paper_standard = ?,
         program = ?,
         course = ?,
         course_id = ?,
         section = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      title,
      projectType,
      paperStandard,
      program,
      resolvedCourseName,
      resolvedCourseId,
      section,
      projectId,
    ],
  );

  return getProjectById(projectId);
}

async function updateProjectAbstract(projectId, abstract) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      'UPDATE projects SET abstract = ?, description = ?, updated_at = NOW() WHERE id = ?',
      [abstract, abstract, projectId],
    );
    await conn.commit();
    return { abstract };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function isProjectLeader(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND role = 'leader' AND status = 'accepted'
     LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

function isProjectLocked(project) {
  const status = String(project?.status || '').trim().toLowerCase();
  return status === 'archived' || status === 'completed' || status === 'for_publication';
}

async function getInstitutionCoordinatorIds(institutionId, queryRunner = db) {
  if (!institutionId) return [];
  const sql = `SELECT DISTINCT user_id
               FROM user_roles
               WHERE institution_id = ?
                 AND role = 'coordinator'`;
  if (typeof queryRunner.execute === 'function') {
    const [rows] = await queryRunner.execute(sql, [institutionId]);
    return rows.map((row) => row.user_id).filter(Boolean);
  }
  const { rows } = await queryRunner.query(sql, [institutionId]);
  return rows.map((row) => row.user_id).filter(Boolean);
}

async function notifyMemberRoleAppointment({
  userId,
  projectId,
  projectTitle,
  appointedByUserId,
  appointedByName,
  appointmentType,
  conn,
}) {
  const appointmentConfig = {
    leader: {
      type: 'ownership_transferred',
      title: 'You are now the project leader',
      message: `${appointedByName} appointed you as project leader for "${projectTitle}".`,
    },
    main_adviser: {
      type: 'event',
      title: 'You are now the main adviser',
      message: `${appointedByName} appointed you as main adviser for "${projectTitle}".`,
    },
  };
  const config = appointmentConfig[appointmentType];
  if (!config || !userId) return;

  await notificationsService.createNotification({
    userId,
    type: config.type,
    title: config.title,
    message: config.message,
    metadata: {
      projectId,
      appointedByUserId,
      appointmentType,
    },
    conn,
  });
}

async function notifyProjectLeaveRecipients({
  projectId,
  projectTitle,
  actorUserId,
  actorName,
  leaveRole,
  reason,
  ownershipTransfer,
  institutionId,
  excludeUserIds = [],
  conn,
}) {
  const excluded = new Set([actorUserId, ...excludeUserIds].filter(Boolean));

  const [memberRows] = await conn.execute(
    `SELECT pm.user_id
     FROM project_members pm
     WHERE pm.project_id = ? AND pm.status = 'accepted'`,
    [projectId],
  );

  const memberRecipients = (memberRows || [])
    .map((row) => row.user_id)
    .filter((userId) => userId && !excluded.has(userId));
  const coordinatorRecipients = (await getInstitutionCoordinatorIds(institutionId, conn))
    .filter((userId) => userId && !excluded.has(userId));

  const allRecipients = Array.from(new Set([...memberRecipients, ...coordinatorRecipients]));
  if (!allRecipients.length) return;

  let title;
  let message;
  let type;

  if (ownershipTransfer) {
    type = 'ownership_transferred';
    title = 'Project ownership transferred';
    message = `${actorName} transferred ownership of "${projectTitle}" to ${ownershipTransfer.successorName}.`;
  } else if (leaveRole === 'adviser') {
    type = 'member_left';
    title = 'Adviser left project';
    const reasonSuffix = reason?.trim() ? ` Reason: ${reason.trim()}` : '';
    message = `${actorName} left "${projectTitle}" as adviser. The project will continue without an assigned adviser.${reasonSuffix}`;
  } else {
    type = 'member_left';
    title = 'Member left project';
    message = `${actorName} left "${projectTitle}".`;
  }

  const metadata = {
    projectId,
    actorUserId,
    leaveRole,
    reason: reason?.trim() || null,
    ownershipTransfer: ownershipTransfer || null,
  };

  await Promise.all(
    allRecipients.map((userId) => notificationsService.createNotification({
      userId,
      type,
      title,
      message,
      metadata,
      conn,
    })),
  );
}

async function logProjectAuditEntry({
  projectId,
  action,
  actorUserId,
  targetUserId,
  metadata,
  conn,
}) {
  await conn.execute(
    `INSERT INTO project_audit_log (project_id, action, actor_user_id, target_user_id, metadata)
     VALUES (?, ?, ?, ?, ?)`,
    [
      projectId,
      action,
      actorUserId,
      targetUserId || null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}

async function leaveProject(projectId, userId, { reason, successorMemberId, confirmDisplayName } = {}) {
  const project = await getProjectById(projectId);
  if (!project) {
    return { error: 'Project not found', status: 404 };
  }

  if (isProjectLocked(project)) {
    return { error: 'Project is locked', status: 403 };
  }

  const membership = await getProjectMembership(projectId, userId);
  if (!membership || membership.status !== 'accepted') {
    return { error: 'You must be an accepted project member to leave', status: 403 };
  }

  const { rows: actorRows } = await db.query(
    'SELECT full_name FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  const actorName = actorRows[0]?.full_name || 'A project member';

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    if (membership.role === 'leader') {
      const [acceptedRows] = await conn.execute(
        `SELECT pm.id, pm.user_id, pm.role, u.full_name
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
         WHERE pm.project_id = ? AND pm.status = 'accepted'`,
        [projectId],
      );
      const acceptedMembers = acceptedRows || [];
      const otherMembers = acceptedMembers.filter((row) => row.user_id !== userId);

      if (!otherMembers.length) {
        await conn.rollback();
        return {
          error: 'You are the only member. Delete the project instead.',
          status: 400,
        };
      }

      if (!successorMemberId) {
        await conn.rollback();
        return { error: 'Select a successor before leaving as project owner', status: 400 };
      }

      const successor = otherMembers.find((row) => row.id === successorMemberId);
      if (!successor) {
        await conn.rollback();
        return { error: 'Selected successor is not a valid project member', status: 400 };
      }
      if (successor.role === 'adviser') {
        await conn.rollback();
        return {
          error: 'The new project owner must be a collaborator, not an adviser',
          status: 400,
        };
      }

      if (typeof confirmDisplayName !== 'string' || confirmDisplayName !== actorName) {
        await conn.rollback();
        return {
          error: 'Type your display name exactly as shown to confirm',
          status: 400,
        };
      }

      await conn.execute(
        `UPDATE project_members SET role = 'leader' WHERE id = ? AND project_id = ?`,
        [successor.id, projectId],
      );
      await conn.execute(
        `UPDATE project_members SET role = 'member' WHERE project_id = ? AND user_id = ?`,
        [projectId, userId],
      );
      await conn.execute(
        'UPDATE projects SET created_by = ?, updated_at = NOW() WHERE id = ?',
        [successor.user_id, projectId],
      );

      await logProjectAuditEntry({
        projectId,
        action: 'ownership_transferred',
        actorUserId: userId,
        targetUserId: successor.user_id,
        metadata: {
          fromUserId: userId,
          toUserId: successor.user_id,
          fromName: actorName,
          toName: successor.full_name || 'Member',
        },
        conn,
      });

      await notifyMemberRoleAppointment({
        userId: successor.user_id,
        projectId,
        projectTitle: project.title,
        appointedByUserId: userId,
        appointedByName: actorName,
        appointmentType: 'leader',
        conn,
      });

      await notifyProjectLeaveRecipients({
        projectId,
        projectTitle: project.title,
        actorUserId: userId,
        actorName,
        leaveRole: 'leader',
        institutionId: project.institution_id,
        ownershipTransfer: {
          successorUserId: successor.user_id,
          successorName: successor.full_name || 'Member',
        },
        excludeUserIds: [successor.user_id],
        conn,
      });

      await conn.commit();
      return { success: true, action: 'ownership_transferred' };
    }

    if (membership.role === 'adviser') {
      const wasMainAdviser = membership.is_main_adviser === 1 || membership.is_main_adviser === true;

      await conn.execute(
        'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
        [projectId, userId],
      );

      if (wasMainAdviser) {
        await promoteNextMainAdviser(conn, projectId);
      }

      await notifyProjectLeaveRecipients({
        projectId,
        projectTitle: project.title,
        actorUserId: userId,
        actorName,
        leaveRole: 'adviser',
        reason,
        institutionId: project.institution_id,
        conn,
      });

      await conn.commit();
      return { success: true, action: 'left', removed: true };
    }

    await conn.execute(
      'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
      [projectId, userId],
    );

    await notifyProjectLeaveRecipients({
      projectId,
      projectTitle: project.title,
      actorUserId: userId,
      actorName,
      leaveRole: 'member',
      institutionId: project.institution_id,
      conn,
    });

    await conn.commit();
    return { success: true, action: 'left', removed: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function transferProjectLeadership(projectId, leaderUserId, targetMemberId) {
  const project = await getProjectById(projectId);
  if (!project) {
    return { error: 'Project not found', status: 404 };
  }

  if (isProjectLocked(project)) {
    return { error: 'Project is locked', status: 403 };
  }

  if (!(await isProjectLeader(projectId, leaderUserId))) {
    return { error: 'Only the project leader can transfer leadership', status: 403 };
  }

  const { rows: targetRows } = await db.query(
    `SELECT pm.id, pm.user_id, pm.role, pm.status, u.full_name
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.id = ? AND pm.project_id = ?
     LIMIT 1`,
    [targetMemberId, projectId],
  );
  const target = targetRows[0];
  if (!target || target.status !== 'accepted') {
    return { error: 'Selected member is not an active team member', status: 400 };
  }
  if (target.role === 'leader') {
    return { error: 'This member is already the project leader', status: 400 };
  }
  if (target.role === 'adviser') {
    return {
      error: 'Leadership can only be transferred to a collaborator, not an adviser',
      status: 400,
    };
  }
  if (target.user_id === leaderUserId) {
    return { error: 'You cannot transfer leadership to yourself', status: 400 };
  }

  const { rows: leaderRows } = await db.query(
    'SELECT full_name FROM users WHERE id = ? LIMIT 1',
    [leaderUserId],
  );
  const leaderName = leaderRows[0]?.full_name || 'The project leader';
  const previousNewLeaderRole = target.role;

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE project_members SET role = 'leader' WHERE id = ? AND project_id = ?`,
      [target.id, projectId],
    );
    await conn.execute(
      `UPDATE project_members SET role = 'member' WHERE project_id = ? AND user_id = ?`,
      [projectId, leaderUserId],
    );
    await conn.execute(
      'UPDATE projects SET created_by = ?, updated_at = NOW() WHERE id = ?',
      [target.user_id, projectId],
    );

    await logProjectAuditEntry({
      projectId,
      action: 'ownership_transferred',
      actorUserId: leaderUserId,
      targetUserId: target.user_id,
      metadata: {
        fromUserId: leaderUserId,
        toUserId: target.user_id,
        fromName: leaderName,
        toName: target.full_name || 'Member',
        initiatedBy: 'leader_transfer',
      },
      conn,
    });

    await notifyMemberRoleAppointment({
      userId: target.user_id,
      projectId,
      projectTitle: project.title,
      appointedByUserId: leaderUserId,
      appointedByName: leaderName,
      appointmentType: 'leader',
      conn,
    });

    await notifyProjectLeaveRecipients({
      projectId,
      projectTitle: project.title,
      actorUserId: leaderUserId,
      actorName: leaderName,
      leaveRole: 'leader',
      institutionId: project.institution_id,
      ownershipTransfer: {
        successorUserId: target.user_id,
        successorName: target.full_name || 'Member',
      },
      excludeUserIds: [target.user_id],
      conn,
    });

    await conn.commit();
    return {
      success: true,
      revert: {
        previousLeaderUserId: leaderUserId,
        newLeaderUserId: target.user_id,
        previousNewLeaderRole,
      },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function revertProjectLeadership(projectId, actorUserId, {
  previousLeaderUserId,
  newLeaderUserId,
  previousNewLeaderRole,
}) {
  const project = await getProjectById(projectId);
  if (!project) {
    return { error: 'Project not found', status: 404 };
  }

  if (isProjectLocked(project)) {
    return { error: 'Project is locked', status: 403 };
  }

  if (actorUserId !== previousLeaderUserId) {
    return { error: 'Only the previous leader can revert this transfer', status: 403 };
  }

  const currentLeaderId = await getProjectLeaderId(projectId);
  if (!currentLeaderId || currentLeaderId !== newLeaderUserId) {
    return { error: 'Leadership has changed and can no longer be reverted', status: 400 };
  }

  const safePreviousRole = previousNewLeaderRole === 'adviser' ? 'adviser' : 'member';

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE project_members SET role = 'leader' WHERE project_id = ? AND user_id = ? AND status = 'accepted'`,
      [projectId, previousLeaderUserId],
    );
    await conn.execute(
      `UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ? AND status = 'accepted'`,
      [safePreviousRole, projectId, newLeaderUserId],
    );
    await conn.execute(
      'UPDATE projects SET created_by = ?, updated_at = NOW() WHERE id = ?',
      [previousLeaderUserId, projectId],
    );

    await logProjectAuditEntry({
      projectId,
      action: 'ownership_transfer_reverted',
      actorUserId,
      targetUserId: newLeaderUserId,
      metadata: {
        restoredLeaderUserId: previousLeaderUserId,
        demotedUserId: newLeaderUserId,
        restoredRole: safePreviousRole,
      },
      conn,
    });

    await conn.commit();
    return { success: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function transferMainAdviser(projectId, mainAdviserUserId, targetMemberId) {
  const project = await getProjectById(projectId);
  if (!project) {
    return { error: 'Project not found', status: 404 };
  }

  if (isProjectLocked(project)) {
    return { error: 'Project is locked', status: 403 };
  }

  if (!(await isMainProjectAdviser(projectId, mainAdviserUserId))) {
    return { error: 'Only the main adviser can transfer this role', status: 403 };
  }

  const { rows: targetRows } = await db.query(
    `SELECT pm.id, pm.user_id, pm.role, pm.status, u.full_name
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.id = ? AND pm.project_id = ?
     LIMIT 1`,
    [targetMemberId, projectId],
  );
  const target = targetRows[0];
  if (!target || target.status !== 'accepted' || target.role !== 'adviser') {
    return { error: 'Selected member is not an active project adviser', status: 400 };
  }
  if (target.user_id === mainAdviserUserId) {
    return { error: 'You cannot transfer main adviser role to yourself', status: 400 };
  }

  const { rows: mainAdviserRows } = await db.query(
    'SELECT full_name FROM users WHERE id = ? LIMIT 1',
    [mainAdviserUserId],
  );
  const mainAdviserName = mainAdviserRows[0]?.full_name || 'The main adviser';

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      'UPDATE project_members SET is_main_adviser = 1 WHERE id = ? AND project_id = ?',
      [target.id, projectId],
    );
    await conn.execute(
      `UPDATE project_members SET is_main_adviser = 0
       WHERE project_id = ? AND user_id = ? AND role = 'adviser'`,
      [projectId, mainAdviserUserId],
    );

    await notifyMemberRoleAppointment({
      userId: target.user_id,
      projectId,
      projectTitle: project.title,
      appointedByUserId: mainAdviserUserId,
      appointedByName: mainAdviserName,
      appointmentType: 'main_adviser',
      conn,
    });

    await conn.commit();
    return {
      success: true,
      revert: {
        previousMainAdviserUserId: mainAdviserUserId,
        newMainAdviserUserId: target.user_id,
      },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function revertMainAdviserTransfer(projectId, actorUserId, {
  previousMainAdviserUserId,
  newMainAdviserUserId,
}) {
  const project = await getProjectById(projectId);
  if (!project) {
    return { error: 'Project not found', status: 404 };
  }

  if (isProjectLocked(project)) {
    return { error: 'Project is locked', status: 403 };
  }

  if (actorUserId !== previousMainAdviserUserId) {
    return { error: 'Only the previous main adviser can revert this transfer', status: 403 };
  }

  const isCurrentMain = await isMainProjectAdviser(projectId, newMainAdviserUserId);
  if (!isCurrentMain) {
    return { error: 'Main adviser role has changed and can no longer be reverted', status: 400 };
  }

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE project_members SET is_main_adviser = 1
       WHERE project_id = ? AND user_id = ? AND role = 'adviser' AND status = 'accepted'`,
      [projectId, previousMainAdviserUserId],
    );
    await conn.execute(
      `UPDATE project_members SET is_main_adviser = 0
       WHERE project_id = ? AND user_id = ? AND role = 'adviser' AND status = 'accepted'`,
      [projectId, newMainAdviserUserId],
    );

    await conn.commit();
    return { success: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteProjectByLeader(projectId, userId, confirmTitle) {
  const project = await getProjectById(projectId);
  if (!project) {
    return { error: 'Project not found', status: 404 };
  }

  if (!(await isProjectLeader(projectId, userId))) {
    return { error: 'Only the project leader can delete this project', status: 403 };
  }

  if (typeof confirmTitle !== 'string' || confirmTitle !== project.title) {
    return {
      error: 'Type the project title exactly as shown to confirm deletion',
      status: 400,
    };
  }

  const [paperVersionsResult, projectFiles] = await Promise.all([
    db.query('SELECT file_url FROM paper_versions WHERE project_id = ?', [projectId]),
    getProjectFiles(projectId),
  ]);
  const paperVersionRows = paperVersionsResult.rows || [];

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [documentRows] = await conn.execute(
      'SELECT id FROM documents WHERE project_id = ?',
      [projectId],
    );
    const documentIds = (documentRows || []).map((row) => row.id);

    if (documentIds.length) {
      const placeholders = documentIds.map(() => '?').join(', ');
      await conn.execute(
        `DELETE FROM comments WHERE document_id IN (${placeholders})`,
        documentIds,
      );
      await conn.execute(
        `DELETE FROM document_versions WHERE document_id IN (${placeholders})`,
        documentIds,
      );
      await conn.execute(
        `DELETE FROM documents WHERE id IN (${placeholders})`,
        documentIds,
      );
    }

    await conn.execute('DELETE FROM evaluations WHERE project_id = ?', [projectId]);
    await conn.execute('DELETE FROM defense_results WHERE project_id = ?', [projectId]);

    try {
      await conn.execute(
        `DELETE dv FROM defense_verifications dv
         INNER JOIN defenses d ON d.id = dv.defense_id
         WHERE d.project_id = ?`,
        [projectId],
      );
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    }

    await conn.execute('DELETE FROM defenses WHERE project_id = ?', [projectId]);

    try {
      await conn.execute('DELETE FROM meetings WHERE project_id = ?', [projectId]);
    } catch (err) {
      if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    }

    await conn.execute('DELETE FROM project_proposals WHERE project_id = ?', [projectId]);
    await conn.execute('DELETE FROM project_members WHERE project_id = ?', [projectId]);
    await conn.execute('DELETE FROM paper_versions WHERE project_id = ?', [projectId]);
    await conn.execute('DELETE FROM project_files WHERE project_id = ?', [projectId]);
    await conn.execute('DELETE FROM projects WHERE id = ?', [projectId]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  for (const row of paperVersionRows) {
    safeUnlinkUploadedFile(row.file_url);
  }
  for (const file of projectFiles) {
    safeUnlinkUploadedFile(file.file_url);
  }
  safeUnlinkUploadedFile(project.document_reference);

  return { success: true };
}

module.exports = {
  createProject,
  getProjectsByUser,
  getProjectById,
  getProjectByCode,
  getProjectMembers,
  isProjectMember,
  isAcceptedProjectMember,
  removeProjectMember,
  joinProject,
  requestJoinProject,
  respondToJoinRequest,
  getProjectMembership,
  getProjectLeaderId,
  inviteToProject,
  getPendingInvitationsForUser,
  getInvitationById,
  respondToInvitation,
  getProjectInvitations,
  notifyProjectMembersDefenseScheduled,
  createDefenseSchedule,
  addProjectFile,
  updateProjectDocumentRef,
  getProjectFiles,
  getLatestPaperVersion,
  updateProjectKeywords,
  getAdvisedProjects,
  getAdviserDashboardStats,
  updateProjectStatus,
  updateProjectDetails,
  normalizePaperStandard,
  normalizeProjectType,
  updateProjectAbstract,
  isProjectLeader,
  isProjectLocked,
  leaveProject,
  transferProjectLeadership,
  revertProjectLeadership,
  transferMainAdviser,
  revertMainAdviserTransfer,
  isMainProjectAdviser,
  deleteProjectByLeader,
};
