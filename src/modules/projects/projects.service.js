const db = require('../../../config/db');
const notificationsService = require('../notifications/notifications.service');

async function createProject({ title, abstract, keywords, researchType, program, course, section, documentReference, createdBy }) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT INTO projects (title, description, abstract, keywords, paper_standard, program, course, section, document_reference, created_by, status, project_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'thesis')`,
      [
        title,
        abstract,
        abstract,
        JSON.stringify(keywords || []),
        (researchType || 'ieee').toLowerCase(),
        program || null,
        course || null,
        section || null,
        documentReference || null,
        createdBy,
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
            ANY_VALUE(pm_self.role) AS member_role
     FROM projects p
     LEFT JOIN project_members pm_self
       ON pm_self.project_id = p.id
       AND pm_self.user_id = ?
       AND pm_self.status = 'accepted'
     WHERE p.created_by = ? OR pm_self.id IS NOT NULL
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [userId, userId]
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
     WHERE pm.project_id = ?
     ORDER BY pm.invited_at ASC`,
    [projectId]
  );

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    role: r.role,
    status: r.status,
    users: {
      full_name: r.full_name,
      email: r.email,
      avatar_url: r.avatar_url,
    },
  }));
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

async function joinProject(projectId, userId, memberRole) {
  await db.query(
    `INSERT INTO project_members (project_id, user_id, role, status)
     VALUES (?, ?, ?, 'accepted')`,
    [projectId, userId, memberRole]
  );
}

async function inviteToProject(projectId, userId, role, invitedByUserId) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO project_members (project_id, user_id, role, status)
       VALUES (?, ?, ?, 'pending')`,
      [projectId, userId, role]
    );

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

    await notificationsService.createNotification({
      userId,
      type: 'invitation',
      title: 'Project invitation',
      message: `You were invited by ${inviterName} to join "${project.title}" as ${role}.`,
      metadata: {
        projectId,
        role,
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
    `SELECT pm.id, pm.project_id, pm.role, pm.status, pm.invited_at,
            p.title AS project_title, p.project_code,
            creator.full_name AS invited_by_name, creator.email AS invited_by_email
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     JOIN users creator ON creator.id = p.created_by
     WHERE pm.user_id = ? AND pm.status = 'pending'
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

    await conn.execute(
      'UPDATE project_members SET status = ?, responded_at = NOW() WHERE id = ?',
      [status, invitationId]
    );

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
      `INSERT INTO defenses (project_id, adviser_id, defense_type, scheduled_at, location, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'scheduled', ?)`,
      [projectId, createdBy, defenseType, scheduledAt, location || null, createdBy]
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
    invited_at: r.invited_at,
    users: {
      full_name: r.full_name,
      email: r.email,
      avatar_url: r.avatar_url,
    },
  }));
}

async function getAdvisedProjects(userId) {
  const { rows } = await db.query(
    `SELECT p.*, pm.role AS member_role
     FROM projects p
     JOIN project_members pm
       ON pm.project_id = p.id
       AND pm.user_id = ?
       AND pm.status = 'accepted'
       AND pm.role = 'adviser'
     ORDER BY p.created_at DESC`,
    [userId]
  );
  return rows;
}

const ALLOWED_STATUSES = new Set(['draft', 'active', 'completed', 'archived']);

async function updateProjectStatus(projectId, status, userId) {
  if (!ALLOWED_STATUSES.has(status)) {
    return { error: 'Invalid status. Allowed: draft, active, completed, archived' };
  }

  // Verify user is adviser of this project
  const isMember = await isProjectMember(projectId, userId);
  if (!isMember) {
    return { error: 'You are not a member of this project' };
  }

  await db.query(
    'UPDATE projects SET status = ?, updated_at = NOW() WHERE id = ?',
    [status, projectId]
  );

  const project = await getProjectById(projectId);
  return { data: project };
}

module.exports = {
  createProject,
  getProjectsByUser,
  getProjectById,
  getProjectByCode,
  getProjectMembers,
  isProjectMember,
  joinProject,
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
  getAdvisedProjects,
  updateProjectStatus,
};
