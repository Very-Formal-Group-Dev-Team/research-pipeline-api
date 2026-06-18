const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Diff = require('diff');
const paperVersionsService = require('./paper_versions.service');
const paperBranchesService = require('./paper_branches.service');
const coordinatorService = require('../coordinator/coordinator.service');
const { Document, Packer, Paragraph } = require('docx');
const { editTemplate } = require('./template.editor');
const {
  FILES_DIR,
  resolveFilePath,
  extractText,
  getRenderableHtml,
  textToHtml,
} = require('./paper_text.util');

function ensureFilesDir() {
  if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
  }
}

async function userCanViewPaperVersions(userId, projectId) {
  const isMember = await paperVersionsService.isProjectMember(projectId, userId);
  if (isMember) return true;
  return coordinatorService.coordinatorCanViewProject(userId, projectId);
}

/** GET /projects/:id/paper-versions */
async function list(req, res) {
  const projectId = req.params.id;

  const canView = await userCanViewPaperVersions(req.user.id, projectId);
  if (!canView) {
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

  const { commitMessage, branchName } = req.body;
  if (!commitMessage || !commitMessage.trim()) {
    return res.status(400).json({ error: 'commitMessage is required' });
  }

  const targetBranchName = (branchName || '').trim() || 'main';
  const branch = await paperBranchesService.getBranch(projectId, targetBranchName);
  if (!branch) {
    return res.status(404).json({ error: `Branch "${targetBranchName}" not found` });
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
    branchId: branch.id,
    parentVersionId: branch.head_version_id || null,
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

  const templateData = await paperVersionsService.getProjectTemplateData(projectId);
  if (!templateData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { project, members, institution } = templateData;

  const { commitMessage, branchName } = req.body;
  const message = (commitMessage && commitMessage.trim())
    ? commitMessage.trim()
    : `Generated ${(project.paper_standard || 'ieee').toUpperCase()} template`;

  const targetBranchName = (branchName || '').trim() || 'main';
  const branch = await paperBranchesService.getBranch(projectId, targetBranchName);
  if (!branch) {
    return res.status(404).json({ error: `Branch "${targetBranchName}" not found` });
  }

  ensureFilesDir();

  const buffer = await editTemplate({
    paper_standard: project.paper_standard,
    title: project.title,
    abstract: project.abstract,
    description: project.description,
    keywords: project.keywords,
    program: project.program,
    course: project.course,
    section: project.section,
    creator_name: project.creator_name,
    creator_email: project.creator_email,
    members,
    institution,
  });
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
    branchId: branch.id,
    parentVersionId: branch.head_version_id || null,
  });

  return res.status(201).json({ versionNumber, fileUrl });
}

async function buildDocxFromText(contentText) {
  const paragraphs = contentText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => new Paragraph({ text }));

  const doc = new Document({
    sections: [{ children: paragraphs }],
  });

  return Packer.toBuffer(doc);
}

/** GET /projects/:id/paper-versions/:versionId/download */
async function download(req, res) {
  const { id: projectId, versionId } = req.params;

  const canView = await userCanViewPaperVersions(req.user.id, projectId);
  if (!canView) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const version = await paperVersionsService.getPaperVersionById(projectId, versionId);
  if (!version) {
    return res.status(404).json({ error: 'Version not found' });
  }

  // Merge commits reuse the target branch's old file_url — that file does not represent
  // the merged content. The merged text lives in content_text instead.
  // Detection: tag === 'merge' (strict string equality) is unambiguously false for every
  // regular upload and generated version, regardless of nullable-column edge cases.
  if (version.tag === 'merge' && version.content_text) {
    const docxFilename = version.file_name.replace(/\.[^.]+$/, '') + '.docx';
    const buffer = await buildDocxFromText(version.content_text);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(docxFilename)}"`);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    // res.end(Buffer) keeps the same safe response pattern as the .txt fix —
    // raw bytes only, no string-encoding side effects on the connection.
    return res.end(buffer);
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

function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

async function diff(req, res) {
  const { id: projectId, versionId } = req.params;

  const canView = await userCanViewPaperVersions(req.user.id, projectId);
  if (!canView) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const version = await paperVersionsService.getPaperVersionById(projectId, versionId);
  if (!version) {
    return res.status(404).json({ error: 'Version not found' });
  }

  const previous = await paperVersionsService.getPreviousVersion(projectId, version.version_number);

  // Merge commits reuse the target branch's old file_url; that file is identical to
  // the previous version's file and does not represent the merged content. Use
  // content_text (set to the final merged text at commit time) for both text
  // extraction and HTML generation for any version where tag === 'merge'.
  // Using strict string equality avoids any loose-null-comparison edge cases and is
  // unambiguously false for every regular upload and generated template.
  const getContent = async (v) => {
    if (v.tag === 'merge' && v.content_text) {
      return { text: v.content_text, html: textToHtml(v.content_text) };
    }
    const filePath = resolveFilePath(v.file_url);
    if (!fs.existsSync(filePath)) return { text: null, html: null };
    const text = await extractText(filePath);
    const html = text != null ? await getRenderableHtml(filePath, text) : null;
    return { text, html };
  };

  const { text: currentText, html: currentHtml } = await getContent(version);

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
      currentHtml,
    });
  }

  const { text: prevText, html: previousHtml } = await getContent(previous);
  const previousText = prevText || '';
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
    currentHtml,
    previousHtml,
  });
}

module.exports = { list, upload, generate, download, diff };
