const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const projectsService = require('./projects.service');
const { getRoleByUserId } = require('../users/users.service');
const { uploadBase } = require('../../../config/env');

const FILES_DIR = path.join(uploadBase, 'files');

function resolvePaperFilePath(fileUrl) {
  const filename = path.basename(fileUrl || '');
  const absolutePath = path.join(FILES_DIR, filename);
  const normalizedPath = path.normalize(absolutePath);
  const normalizedDir = path.normalize(FILES_DIR);

  if (!normalizedPath.startsWith(normalizedDir)) {
    throw new Error('Invalid file path');
  }

  return absolutePath;
}

async function extractPaperText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  }
  if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf8');
  }
  return '';
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getKeywordModelBaseUrls() {
  const configured = normalizeBaseUrl(process.env.KEYWORD_MODEL_URL);
  const fallback = [
    configured,
    'http://keyword-model:8000',
    'http://keyword_model:8000',
    'http://host.docker.internal:8000',
    'http://localhost:8000',
  ].filter(Boolean);

  return Array.from(new Set(fallback));
}

function getKeywordsFromPaperText(candidateKeywords, extractedText, topK = 10) {
  if (!Array.isArray(candidateKeywords) || !candidateKeywords.length) {
    return [];
  }

  const normalizedText = ` ${String(extractedText || '').toLowerCase()} `;
  const filtered = candidateKeywords
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean)
    .filter((keyword, index, list) => list.indexOf(keyword) === index)
    .filter((keyword) => normalizedText.includes(` ${keyword} `));

  return filtered.slice(0, topK);
}

async function callKeywordModel(extractedText) {
  const baseUrls = getKeywordModelBaseUrls();
  const attempted = [];
  let lastError = null;

  for (const baseUrl of baseUrls) {
    attempted.push(baseUrl);
    try {
      let response = await fetch(`${baseUrl}/predict-keywords-detailed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: extractedText, top_k: 10 }),
      });

      if (response.status === 404) {
        response = await fetch(`${baseUrl}/predict-keywords`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: extractedText, top_k: 10 }),
        });
      }

      if (!response.ok) {
        const body = await response.text();
        lastError = `Keyword model at ${baseUrl} returned ${response.status}: ${body || response.statusText}`;
        continue;
      }

      const modelOutput = await response.json();
      return { modelOutput, baseUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown connection error';
      lastError = `Keyword model at ${baseUrl} is unreachable: ${message}`;
    }
  }

  return {
    error: lastError || 'Keyword model is unreachable',
    attempted,
  };
}

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

async function updateKeywords(req, res) {
  try {
    const projectId = req.params.id;
    const userRole = await getRoleByUserId(req.user.id);
    if (userRole !== 'student') {
      return res.status(403).json({ error: 'Only students can update project keywords' });
    }

    const isMember = await projectsService.isProjectMember(projectId, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this project' });
    }

    const project = await projectsService.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const keywords = Array.isArray(req.body?.keywords)
      ? req.body.keywords
        .map((item) => String(item || '').trim())
        .filter(Boolean)
      : null;

    if (!keywords) {
      return res.status(400).json({ error: 'keywords must be an array of strings' });
    }

    const uniqueKeywords = Array.from(new Set(keywords)).slice(0, 30);
    await projectsService.updateProjectKeywords(projectId, uniqueKeywords);

    return res.json({ success: true, keywords: uniqueKeywords });
  } catch (err) {
    console.error('projects.controller – updateKeywords error:', err);
    return res.status(500).json({ error: 'Failed to update project keywords' });
  }
}

async function findRelatedStudies(req, res) {
  try {
    const projectId = req.params.id;
    const userRole = await getRoleByUserId(req.user.id);
    if (userRole !== 'student') {
      return res.status(403).json({ error: 'Only students can run this action' });
    }

    const isMember = await projectsService.isProjectMember(projectId, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this project' });
    }

    const project = await projectsService.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const latestVersion = await projectsService.getLatestPaperVersion(projectId);
    if (!latestVersion) {
      return res.status(400).json({ error: 'No paper version found for this project' });
    }

    const filePath = resolvePaperFilePath(latestVersion.file_url);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Latest submitted file was not found on disk' });
    }

    const extractedText = await extractPaperText(filePath);
    if (!extractedText.trim()) {
      return res.status(400).json({ error: 'Could not extract text from the latest submitted file' });
    }

    const keywordModelResponse = await callKeywordModel(extractedText);
    if (keywordModelResponse.error) {
      return res.status(502).json({
        error: keywordModelResponse.error,
        attempted_urls: keywordModelResponse.attempted || [],
      });
    }

    const modelOutput = keywordModelResponse.modelOutput;
    const vectorizationTopTerms = Array.isArray(modelOutput?.vectorization?.top_terms)
      ? modelOutput.vectorization.top_terms.map((item) => item?.term).filter(Boolean)
      : [];
    const modelKeywords = Array.isArray(modelOutput?.keywords)
      ? modelOutput.keywords
      : [];
    const fallbackLabelKeywords = Array.isArray(modelOutput?.predicted_labels)
      ? modelOutput.predicted_labels
      : [];

    let keywords = getKeywordsFromPaperText(modelKeywords, extractedText, 10);
    if (!keywords.length) {
      keywords = getKeywordsFromPaperText(vectorizationTopTerms, extractedText, 10);
    }
    if (!keywords.length) {
      keywords = getKeywordsFromPaperText(fallbackLabelKeywords, extractedText, 10);
    }

    await projectsService.updateProjectKeywords(projectId, keywords);

    const vectorization = modelOutput?.vectorization && typeof modelOutput.vectorization === 'object'
      ? modelOutput.vectorization
      : { message: 'Vectorization detail unavailable from keyword model endpoint' };

    return res.json({
      projectId,
      latestVersion: {
        id: latestVersion.id,
        version_number: latestVersion.version_number,
        file_name: latestVersion.file_name,
        created_at: latestVersion.created_at,
      },
      keyword_model_url: keywordModelResponse.baseUrl,
      keywords,
      vectorization,
    });
  } catch (err) {
    console.error('projects.controller – findRelatedStudies error:', err);
    return res.status(500).json({ error: 'Failed to process related studies keyword detection' });
  }
}

async function crossReferenceStudies(req, res) {
  try {
    const projectId = req.params.id;
    const userRole = await getRoleByUserId(req.user.id);
    if (userRole !== 'student') {
      return res.status(403).json({ error: 'Only students can run cross-referencing' });
    }

    const isMember = await projectsService.isProjectMember(projectId, req.user.id);
    if (!isMember) {
      return res.status(403).json({ error: 'You are not a member of this project' });
    }

    const project = await projectsService.getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const keywords = typeof project.keywords === 'string'
      ? JSON.parse(project.keywords || '[]')
      : (project.keywords || []);
    const sanitizedKeywords = Array.isArray(keywords)
      ? keywords.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    if (!sanitizedKeywords.length) {
      return res.status(400).json({ error: 'No keywords found. Add keywords first before cross-referencing.' });
    }

    const searchTerm = sanitizedKeywords.join(' ');
    const params = new URLSearchParams({
      search: searchTerm,
      select: 'display_name,authorships,publication_date,primary_location,doi',
    });
    params.set('per-page', '20');

    const response = await fetch(`https://api.openalex.org/works?${params.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({ error: `OpenAlex request failed: ${body || response.statusText}` });
    }

    const payload = await response.json();
    const studies = Array.isArray(payload?.results) ? payload.results : [];

    return res.json({
      query: searchTerm,
      total: studies.length,
      studies,
    });
  } catch (err) {
    console.error('projects.controller – crossReferenceStudies error:', err);
    return res.status(500).json({ error: 'Failed to fetch cross-referenced studies' });
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
  updateKeywords,
  findRelatedStudies,
  crossReferenceStudies,
};
