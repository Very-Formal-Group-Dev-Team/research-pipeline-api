const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { uploadBase } = require('../../../config/env');

const FILES_DIR = path.join(uploadBase, 'files');

/**
 * Ensure the files directory exists
 */
async function ensureFilesDir() {
  try {
    await fs.mkdir(FILES_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

/**
 * Validate and sanitize filename to prevent path traversal attacks
 * @param {string} filename - The filename to validate
 * @returns {string} - The sanitized filename
 * @throws {Error} - If the filename is invalid
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename');
  }

  // Remove any path separators or traversal attempts
  const sanitized = path.basename(filename);

  // Prevent empty or hidden files
  if (!sanitized || sanitized.startsWith('.')) {
    throw new Error('Invalid filename');
  }

  // Limit filename length
  if (sanitized.length > 255) {
    throw new Error('Filename too long');
  }

  return sanitized;
}

/**
 * POST /api/file-operations/upload
 * Accept a JSON request with filename and content fields
 * Write the file to the volume at uploadBase/files
 * Return a success response with the file path
 */
async function uploadFile(req, res) {
  try {
    const { filename, content } = req.body;

    // Validate input
    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    if (content === undefined || content === null) {
      return res.status(400).json({ error: 'content is required' });
    }

    const sanitized = sanitizeFilename(filename);

    // Ensure directory exists
    await ensureFilesDir();

    const filePath = path.join(FILES_DIR, sanitized);

    // Verify the resolved path is still within FILES_DIR (prevent path traversal)
    const normalizedPath = path.normalize(filePath);
    const normalizedDir = path.normalize(FILES_DIR);
    if (!normalizedPath.startsWith(normalizedDir)) {
      return res.status(403).json({ error: 'Invalid file path' });
    }

    // Determine content encoding
    let fileContent = content;
    if (typeof content === 'object') {
      fileContent = JSON.stringify(content, null, 2);
    } else {
      fileContent = String(content);
    }

    // Write the file
    await fs.writeFile(filePath, fileContent, 'utf8');

    // Return success with the public path
    const publicPath = `/uploads/files/${sanitized}`;

    res.status(201).json({
      success: true,
      filename: sanitized,
      filePath: publicPath,
      size: Buffer.byteLength(fileContent, 'utf8'),
    });
  } catch (err) {
    console.error('[file-operations] Upload error:', err);

    if (err.message.includes('Invalid filename')) {
      return res.status(400).json({ error: err.message });
    }

    if (err.code === 'EACCES') {
      return res.status(500).json({ error: 'Permission denied writing to volume' });
    }

    if (err.code === 'ENOSPC') {
      return res.status(507).json({ error: 'Insufficient storage space' });
    }

    res.status(500).json({ error: 'Failed to write file to disk' });
  }
}

/**
 * GET /api/file-operations/file/:filename
 * Read and return the contents of a file from the volume by filename
 */
async function getFile(req, res) {
  try {
    const { filename } = req.params;

    const sanitized = sanitizeFilename(filename);
    const filePath = path.join(FILES_DIR, sanitized);

    // Verify the resolved path is still within FILES_DIR
    const normalizedPath = path.normalize(filePath);
    const normalizedDir = path.normalize(FILES_DIR);
    if (!normalizedPath.startsWith(normalizedDir)) {
      return res.status(403).json({ error: 'Invalid file path' });
    }

    // Check if file exists
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Read the file
    const content = await fs.readFile(filePath, 'utf8');

    // Try to parse as JSON, but return as text if it fails
    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      parsedContent = content;
    }

    res.status(200).json({
      success: true,
      filename: sanitized,
      content: parsedContent,
      size: Buffer.byteLength(content, 'utf8'),
    });
  } catch (err) {
    console.error('[file-operations] Get file error:', err);

    if (err.message.includes('Invalid filename')) {
      return res.status(400).json({ error: err.message });
    }

    if (err.code === 'EACCES') {
      return res.status(500).json({ error: 'Permission denied reading from volume' });
    }

    res.status(500).json({ error: 'Failed to read file from disk' });
  }
}

/**
 * GET /api/file-operations/files
 * List all files currently stored in the volume
 */
async function listFiles(req, res) {
  try {
    // Ensure directory exists
    await ensureFilesDir();

    // Read all files in the directory
    const files = await fs.readdir(FILES_DIR, { withFileTypes: true });

    // Filter for files only (not directories) and get their stats
    const fileList = [];
    for (const file of files) {
      if (file.isFile()) {
        try {
          const filePath = path.join(FILES_DIR, file.name);
          const stats = await fs.stat(filePath);
          fileList.push({
            filename: file.name,
            publicPath: `/uploads/files/${file.name}`,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
          });
        } catch (err) {
          console.error(`[file-operations] Error getting stats for ${file.name}:`, err);
        }
      }
    }

    // Sort by modification time (newest first)
    fileList.sort((a, b) => b.modified - a.modified);

    res.status(200).json({
      success: true,
      count: fileList.length,
      files: fileList,
    });
  } catch (err) {
    console.error('[file-operations] List files error:', err);

    if (err.code === 'EACCES') {
      return res.status(500).json({ error: 'Permission denied reading from volume' });
    }

    res.status(500).json({ error: 'Failed to list files from disk' });
  }
}

module.exports = {
  uploadFile,
  getFile,
  listFiles,
};
