/**
 * Copies Archivum Jitsi branding snippets into cfg/web for the /config bind mount.
 * Jitsi init appends these to config.js / interface_config.js on container start.
 */
const fs = require('fs');
const path = require('path');

const jitsiDir = path.join(__dirname, '..', 'docker', 'jitsi');
const brandingDir = path.join(jitsiDir, 'branding');
const cfgWebDir = path.join(jitsiDir, 'cfg', 'web');

const BRANDING_FILES = ['custom-config.js', 'custom-interface_config.js'];

function main() {
  fs.mkdirSync(cfgWebDir, { recursive: true });

  for (const file of BRANDING_FILES) {
    const source = path.join(brandingDir, file);
    const target = path.join(cfgWebDir, file);

    if (!fs.existsSync(source)) {
      console.warn(`Skipping missing branding file: ${path.relative(process.cwd(), source)}`);
      continue;
    }

    fs.copyFileSync(source, target);
    console.log(`Synced ${path.relative(process.cwd(), target)}`);
  }
}

main();
