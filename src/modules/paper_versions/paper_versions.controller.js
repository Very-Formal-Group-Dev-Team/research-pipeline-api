const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mammoth = require('mammoth');
const Diff = require('diff');
const paperVersionsService = require('./paper_versions.service');
const { generateDocxTemplate } = require('./template.generator');
const { getProjectById } = require('../projects/projects.service');
const { uploadBase } = require('../../../config/env');

const FILES_DIR = path.join(uploadBase, 'files');

function ensureFilesDir() {
  if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
  }
}

/** GET /projects/:id/paper-versions */
async function list(req, res) {
  const projectId = req.params.id;

  const isMember = await paperVersionsService.isProjectMember(projectId, req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const versions = await paperVersionsService.getPaperVersions(projectId);
  return res.json(versions);
}

/** POST /projects/:id/paper-versions  (multipart: file + commitMessage) */
async function upload(req, res) {
  const projectId = req.params.id;

  const isMember = await paperVersionsService.isProjectMember(projectId, req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'A .docx file is required' });
  }

  const { commitMessage } = req.body;
  if (!commitMessage || !commitMessage.trim()) {
    return res.status(400).json({ error: 'commitMessage is required' });
  }

  const fileUrl = `/uploads/files/${req.file.filename}`;
  const versionNumber = await paperVersionsService.createPaperVersion({
    projectId,
    fileUrl,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    commitMessage: commitMessage.trim(),
    tag: null,
    uploadedBy: req.user.id,
    isGenerated: false,
  });

  return res.status(201).json({ versionNumber, fileUrl });
}

/** POST /projects/:id/paper-versions/generate */
async function generate(req, res) {
  const projectId = req.params.id;

  const isMember = await paperVersionsService.isProjectMember(projectId, req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const project = await getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { commitMessage } = req.body;
  const message = (commitMessage && commitMessage.trim())
    ? commitMessage.trim()
    : `Generated ${(project.paper_standard || 'ieee').toUpperCase()} template`;

  ensureFilesDir();

  const buffer = await generateDocxTemplate(project.paper_standard, project.title);
  const filename = `${req.user.id}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.docx`;
  const destPath = path.join(FILES_DIR, filename);
  fs.writeFileSync(destPath, buffer);

  const fileUrl = `/uploads/files/${filename}`;
  const displayName = `${project.title.replace(/[^a-z0-9]/gi, '_')}_template.docx`;

  const versionNumber = await paperVersionsService.createPaperVersion({
    projectId,
    fileUrl,
    fileName: displayName,
    fileSize: buffer.length,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    commitMessage: message,
    tag: 'template',
    uploadedBy: req.user.id,
    isGenerated: true,
  });

  return res.status(201).json({ versionNumber, fileUrl });
}

/** GET /projects/:id/paper-versions/:versionId/download */
async function download(req, res) {
  const { id: projectId, versionId } = req.params;

  const isMember = await paperVersionsService.isProjectMember(projectId, req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const version = await paperVersionsService.getPaperVersionById(projectId, versionId);
  if (!version) {
    return res.status(404).json({ error: 'Version not found' });
  }

  // file_url is stored as /uploads/files/<filename>
  // Extract the filename from the URL
  const filename = path.basename(version.file_url);
  const absolutePath = path.join(FILES_DIR, filename);

  // Verify the file is within FILES_DIR to prevent path traversal
  const normalizedPath = path.normalize(absolutePath);
  const normalizedDir = path.normalize(FILES_DIR);
  if (!normalizedPath.startsWith(normalizedDir)) {
    return res.status(403).json({ error: 'Invalid file path' });
  }

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(version.file_name)}"`);
  res.setHeader('Content-Type', version.mime_type || 'application/octet-stream');
  return res.sendFile(absolutePath);
}

function resolveFilePath(fileUrl) {
  // file_url is stored as /uploads/files/<filename>
  // Extract the filename from the URL
  const filename = path.basename(fileUrl);
  const absolutePath = path.join(FILES_DIR, filename);

  // Verify the file is within FILES_DIR to prevent path traversal
  const normalizedPath = path.normalize(absolutePath);
  const normalizedDir = path.normalize(FILES_DIR);
  if (!normalizedPath.startsWith(normalizedDir)) {
    throw new Error('Invalid file path');
  }

  return absolutePath;
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf8');
  }
  return null;
}

function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

async function diff(req, res) {
  const { id: projectId, versionId } = req.params;

  const isMember = await paperVersionsService.isProjectMember(projectId, req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const version = await paperVersionsService.getPaperVersionById(projectId, versionId);
  if (!version) {
    return res.status(404).json({ error: 'Version not found' });
  }

  const previous = await paperVersionsService.getPreviousVersion(projectId, version.version_number);

  const currentPath = resolveFilePath(version.file_url);
  if (!fs.existsSync(currentPath)) {
    return res.status(404).json({ error: 'Current version file not found on disk' });
  }

  const currentText = await extractText(currentPath);
  if (currentText === null) {
    return res.json({
      supported: false,
      message: 'Diff is not available for this file type',
      currentWords: 0,
      previousWords: 0,
    });
  }

  const currentWords = countWords(currentText);

  if (!previous) {
    const changes = [{ added: true, value: currentText }];
    return res.json({
      supported: true,
      changes,
      stats: {
        addedWords: currentWords,
        removedWords: 0,
        currentWords,
        previousWords: 0,
      },
    });
  }

  const previousPath = resolveFilePath(previous.file_url);
  let previousText = '';
  if (fs.existsSync(previousPath)) {
    previousText = (await extractText(previousPath)) || '';
  }

  const previousWords = countWords(previousText);
  const changes = Diff.diffWords(previousText, currentText);

  let addedWords = 0;
  let removedWords = 0;
  for (const part of changes) {
    const wc = countWords(part.value);
    if (part.added) addedWords += wc;
    if (part.removed) removedWords += wc;
  }

  return res.json({
    supported: true,
    changes,
    stats: {
      addedWords,
      removedWords,
      currentWords,
      previousWords,
    },
  });
}

module.exports = { list, upload, generate, download, diff };
