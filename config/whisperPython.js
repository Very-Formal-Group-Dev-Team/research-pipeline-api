const path = require('path');
const { spawnSync } = require('child_process');

const PYTHON_CHECK_TIMEOUT_MS = 30000;

function runPython(command, args, extraArgs = ['--version']) {
  try {
    return spawnSync(command, [...args, ...extraArgs], {
      encoding: 'utf8',
      timeout: PYTHON_CHECK_TIMEOUT_MS,
      windowsHide: true,
      shell: false,
    });
  } catch {
    return null;
  }
}

function runPythonCheck(command, args, extraArgs = ['--version']) {
  const result = runPython(command, args, extraArgs);
  return result?.status === 0;
}

function resolveExecutablePath(command) {
  if (process.platform !== 'win32' || path.isAbsolute(command)) {
    return command;
  }

  try {
    const lookup = spawnSync('where', [command], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      shell: true,
    });
    if (lookup.status !== 0 || !lookup.stdout) return command;
    const first = lookup.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first || command;
  } catch {
    return command;
  }
}

function resolveRealPythonExecutable(command, args = []) {
  const resolvedCommand = resolveExecutablePath(command);
  const result = runPython(resolvedCommand, args, ['-c', 'import sys; print(sys.executable)']);
  if (result?.status !== 0) return null;

  const executable = result.stdout?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!executable) return null;

  // Windows Store Python lives under WindowsApps and may not be visible to fs.existsSync.
  if (!runPythonCheck(executable, [], ['--version'])) return null;
  return executable;
}

function normalizeCandidate(command, args = []) {
  const resolvedCommand = resolveExecutablePath(command);
  if (!runPythonCheck(resolvedCommand, args)) return null;
  if (!runPythonCheck(resolvedCommand, args, ['-c', 'import faster_whisper'])) return null;

  const realExecutable = resolveRealPythonExecutable(resolvedCommand, args);
  if (!realExecutable) return null;

  return { command: realExecutable, args: [] };
}

function parseConfiguredWhisperPython(rawValue) {
  const configured = String(rawValue || '').trim();
  if (!configured) return null;

  const parts = configured.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  const [command, ...args] = parts;
  return normalizeCandidate(command, args);
}

function resolveWhisperPython() {
  const configured = parseConfiguredWhisperPython(process.env.WHISPER_PYTHON);
  if (configured) return configured;

  const candidates = process.platform === 'win32'
    ? [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
      { command: 'py', args: ['-3'] },
    ]
    : [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ];

  for (const candidate of candidates) {
    const resolved = normalizeCandidate(candidate.command, candidate.args);
    if (resolved) return resolved;
  }

  return null;
}

function isWhisperPythonReady(config) {
  if (!config?.command) return false;
  return normalizeCandidate(config.command, config.args || []) !== null;
}

function formatWhisperPythonLabel(config) {
  const configured = String(process.env.WHISPER_PYTHON || '').trim();
  if (configured) return configured;

  const command = config?.command;
  if (!command) return 'python3';

  if (path.isAbsolute(command)) {
    return path.basename(command);
  }

  return [command, ...(config?.args || [])].filter(Boolean).join(' ');
}

function getWhisperSpawnOptions(config, scriptArgs, cwd) {
  const resolved = config?.command
    ? normalizeCandidate(config.command, config.args || []) || config
    : resolveWhisperPython();

  const command = resolved?.command || 'python3';
  const prefixArgs = Array.isArray(resolved?.args) ? resolved.args : [];

  return {
    command,
    args: [...prefixArgs, ...scriptArgs],
    options: {
      cwd,
      windowsHide: true,
      shell: false,
    },
  };
}

module.exports = {
  resolveWhisperPython,
  isWhisperPythonReady,
  formatWhisperPythonLabel,
  getWhisperSpawnOptions,
};
