/**
 * Creates docker/jitsi/.env from .env.example with generated XMPP passwords.
 * Safe to re-run; skips if .env already exists unless FORCE_JITSI_ENV=1.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const jitsiDir = path.join(__dirname, '..', 'docker', 'jitsi');
const examplePath = path.join(jitsiDir, '.env.example');
const targetPath = path.join(jitsiDir, '.env');

const PASSWORD_KEYS = [
  'JICOFO_AUTH_PASSWORD',
  'JVB_AUTH_PASSWORD',
  'JIGASI_XMPP_PASSWORD',
  'JIGASI_TRANSCRIBER_PASSWORD',
  'JIBRI_RECORDER_PASSWORD',
  'JIBRI_XMPP_PASSWORD',
];

function generatePassword() {
  return crypto.randomBytes(16).toString('hex');
}

function main() {
  if (!fs.existsSync(examplePath)) {
    console.error('Missing docker/jitsi/.env.example');
    process.exit(1);
  }

  if (fs.existsSync(targetPath) && process.env.FORCE_JITSI_ENV !== '1') {
    console.log('docker/jitsi/.env already exists (set FORCE_JITSI_ENV=1 to overwrite).');
    return;
  }

  let content = fs.readFileSync(examplePath, 'utf8');

  for (const key of PASSWORD_KEYS) {
    const value = generatePassword();
    const linePattern = new RegExp(`^${key}=.*$`, 'm');
    if (linePattern.test(content)) {
      content = content.replace(linePattern, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }

  fs.mkdirSync(path.join(jitsiDir, 'cfg'), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
  console.log('Wrote docker/jitsi/.env with generated passwords.');
  require('./sync-jitsi-branding');

  if (process.env.FORCE_JITSI_ENV === '1') {
    require('./reset-jitsi-config');
  }
}

main();
