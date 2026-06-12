/**
 * Deletes generated Jitsi config so containers rebuild config.js on next start.
 * Run after changing docker/jitsi/.env (PUBLIC_URL, DISABLE_HTTPS, etc.).
 */
const fs = require('fs');
const path = require('path');

const jitsiDir = path.join(__dirname, '..', 'docker', 'jitsi');
const cfgDirs = [
  path.join(jitsiDir, 'cfg'),
  path.join(jitsiDir, 'docker', 'jitsi', 'cfg'),
];

function rmDir(dir) {
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

let removed = 0;
for (const dir of cfgDirs) {
  if (rmDir(dir)) {
    console.log(`Removed ${path.relative(process.cwd(), dir)}`);
    removed += 1;
  }
}

if (!removed) {
  console.log('No Jitsi cfg directory found to remove.');
} else {
  require('./sync-jitsi-branding');
  console.log('Restart Jitsi: docker compose up -d jitsi-web jitsi-prosody jitsi-jicofo jitsi-jvb');
}
