const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mammoth = require('mammoth');
const { uploadBase } = require('../../../config/env');

const FILES_DIR = path.join(uploadBase, 'files');

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text) {
  const normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return null;

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function resolveFilePath(fileUrl) {
  const filename = path.basename(fileUrl);
  const absolutePath = path.join(FILES_DIR, filename);
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

async function getRenderableHtml(filePath, extractedText) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.docx') {
    return null;
  }

  try {
    const converted = await mammoth.convertToHtml({ path: filePath });
    if (converted && converted.value && converted.value.trim()) {
      return converted.value;
    }
  } catch {
    // fall back to plain text HTML
  }

  const sourceText = typeof extractedText === 'string' ? extractedText : await extractText(filePath);
  return textToHtml(sourceText);
}

function hashPlainText(text) {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

async function getVersionPlainText(version) {
  const filePath = resolveFilePath(version.file_url);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return extractText(filePath);
}

module.exports = {
  FILES_DIR,
  resolveFilePath,
  extractText,
  getRenderableHtml,
  textToHtml,
  hashPlainText,
  getVersionPlainText,
};
