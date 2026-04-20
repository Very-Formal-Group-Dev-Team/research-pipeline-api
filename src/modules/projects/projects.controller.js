const path = require('path');
const fs = require('fs');
const projectsService = require('./projects.service');
const { getRoleByUserId } = require('../users/users.service');

async function create(req, res) {
  try {
    const { title, abstract, keywords, researchType, program, course, section } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Project title is required' });
    }
    if (!abstract || !abstract.trim()) {
      return res.status(400).json({ error: 'Project abstract is required' });
    }

    let parsedKeywords = [];
    if (keywords) {
      try {
        parsedKeywords = typeof keywords === 'string' ? JSON.parse(keywords) : keywords;
      } catch {
        parsedKeywords = [];
      }
    }

    const project = await projectsService.createProject({
      title: title.trim(),
      abstract: abstract.trim(),
      keywords: parsedKeywords,
      researchType: researchType || 'ieee',
      program: program || null,
      course: course || null,
      section: section || null,
      documentReference: null,
      createdBy: req.user.id,
    });

    if (req.file) {
      const publicUrl = `/uploads/files/${req.file.filename}`;

      await projectsService.addProjectFile({
        projectId: project.id,
        fileUrl: publicUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: req.user.id,
      });

      await projectsService.updateProjectDocumentRef(project.id, publicUrl);
    }

    return res.status(201).json({
      projectId: project.id,
      projectCode: project.project_code,
    });
  } catch (err) {
    console.error('projects.controller – create error:', err);
    return res.status(500).json({ error: 'Failed to create project' });
  }
}

async function list(req, res) {
  try {
    const projects = await projectsService.getProjectsByUser(req.user.id);

    const mapped = projects.map((p) => ({
      ...p,
      keywords: typeof p.keywords === 'string' ? JSON.parse(p.keywords) : (p.keywords || []),
    }));

    return res.json(mapped);
  } catch (err) {
    console.error('projects.controller – list error:', err);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
}

async function listAdvised(req, res) {
  try {
    const projects = await projectsService.getAdvisedProjects(req.user.id);

    const mapped = projects.map((p) => ({
      ...p,
      keywords: typeof p.keywords === 'string' ? JSON.parse(p.keywords) : (p.keywords || []),
    }));

    return res.json(mapped);
  } catch (err) {
    console.error('projects.controller – listAdvised error:', err);
    return res.status(500).json({ error: 'Failed to fetch advised projects' });
  }
}

async function getOne(req, res) {
  try {
    const project = await projectsService.getProjectById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    project.keywords = typeof project.keywords === 'string'
      ? JSON.parse(project.keywords)
      : (project.keywords || []);

    return res.json(project);
  } catch (err) {
    console.error('projects.controller – getOne error:', err);
    return res.status(500).json({ error: 'Failed to fetch project' });
  }
}

async function getMembers(req, res) {
  try {
    const members = await projectsService.getProjectMembers(req.params.id);
    return res.json(members);
  } catch (err) {
    console.error('projects.controller – getMembers error:', err);
    return res.status(500).json({ error: 'Failed to fetch members' });
  }
}

async function getFiles(req, res) {
  try {
    const files = await projectsService.getProjectFiles(req.params.id);
    return res.json(files);
  } catch (err) {
    console.error('projects.controller – getFiles error:', err);
    return res.status(500).json({ error: 'Failed to fetch project files' });
  }
}

async function join(req, res) {
  try {
    const { projectCode } = req.body;
    if (!projectCode || typeof projectCode !== 'string' || !projectCode.trim()) {
      return res.status(400).json({ error: 'Project code is required' });
    }

    const project = await projectsService.getProjectByCode(projectCode.trim());
    if (!project) {
      return res.status(404).json({ error: 'No project found with that code' });
    }

    const alreadyMember = await projectsService.isProjectMember(project.id, req.user.id);
    if (alreadyMember) {
      return res.status(409).json({ error: 'You are already a member of this project' });
    }

    const userRole = await getRoleByUserId(req.user.id);
    const memberRole = userRole === 'adviser' ? 'adviser' : 'member';

    await projectsService.joinProject(project.id, req.user.id, memberRole);

    return res.status(200).json({
      success: true,
      message: `Successfully joined "${project.title}"`,
      project: { id: project.id, title: project.title },
    });
  } catch (err) {
    console.error('projects.controller – join error:', err);
    return res.status(500).json({ error: 'Failed to join project' });
  }
}

async function invite(req, res) {
  try {
    const { userId, role } = req.body;
    const projectId = req.params.id;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required' });
    }

    const validRoles = ['member', 'adviser'];
    const memberRole = validRoles.includes(role) ? role : 'member';

    const project = await projectsService.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const alreadyMember = await projectsService.isProjectMember(projectId, userId);
    if (alreadyMember) {
      return res.status(409).json({ error: 'User is already a member or has a pending invitation' });
    }

    await projectsService.inviteToProject(projectId, userId, memberRole, req.user.id);

    return res.status(201).json({ success: true, message: 'Invitation sent' });
  } catch (err) {
    console.error('projects.controller – invite error:', err);
    return res.status(500).json({ error: 'Failed to send invitation' });
  }
}

async function getMyInvitations(req, res) {
  try {
    const invitations = await projectsService.getPendingInvitationsForUser(req.user.id);
    return res.json(invitations);
  } catch (err) {
    console.error('projects.controller – getMyInvitations error:', err);
    return res.status(500).json({ error: 'Failed to fetch invitations' });
  }
}

async function respondInvitation(req, res) {
  try {
    const { accept } = req.body;
    const invitationId = req.params.invitationId;

    if (typeof accept !== 'boolean') {
      return res.status(400).json({ error: 'accept must be a boolean' });
    }

    const invitation = await projectsService.getInvitationById(invitationId);
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    if (invitation.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only respond to your own invitations' });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ error: 'Invitation has already been responded to' });
    }

    await projectsService.respondToInvitation(invitationId, accept, req.user.id);

    return res.json({ success: true, status: accept ? 'accepted' : 'declined' });
  } catch (err) {
    console.error('projects.controller – respondInvitation error:', err);
    return res.status(500).json({ error: 'Failed to respond to invitation' });
  }
}

async function getInvitations(req, res) {
  try {
    const invitations = await projectsService.getProjectInvitations(req.params.id);
    return res.json(invitations);
  } catch (err) {
    console.error('projects.controller – getInvitations error:', err);
    return res.status(500).json({ error: 'Failed to fetch invitations' });
  }
}

async function scheduleDefense(req, res) {
  try {
    const projectId = req.params.id;
    const { defenseType, scheduledAt, location } = req.body || {};

    const validDefenseTypes = ['proposal', 'midterm', 'final'];
    if (!validDefenseTypes.includes(defenseType)) {
      return res.status(400).json({ error: 'defenseType must be one of: proposal, midterm, final' });
    }

    const parsedDate = new Date(scheduledAt);
    if (!scheduledAt || Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'scheduledAt must be a valid datetime value' });
    }

    const project = await projectsService.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const defense = await projectsService.createDefenseSchedule({
      projectId,
      defenseType,
      scheduledAt: parsedDate,
      location: location || null,
      createdBy: req.user.id,
    });

    return res.status(201).json({
      success: true,
      message: 'Defense schedule created',
      defense,
    });
  } catch (err) {
    console.error('projects.controller – scheduleDefense error:', err);
    return res.status(500).json({ error: 'Failed to create defense schedule' });
  }
}

async function updateStatus(req, res) {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const result = await projectsService.updateProjectStatus(req.params.id, status, req.user.id);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result.data);
  } catch (err) {
    console.error('projects.controller – updateStatus error:', err);
    return res.status(500).json({ error: 'Failed to update project status' });
  }
}

module.exports = {
  create,
  list,
  listAdvised,
  getOne,
  getMembers,
  getFiles,
  join,
  invite,
  getMyInvitations,
  respondInvitation,
  getInvitations,
  scheduleDefense,
  updateStatus,
};
