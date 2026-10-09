'use strict';
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const name of ['server.js', 'candy.js', 'claude.js', 'emotion.js', 'reading.js', 'stickers.js', 'voice.js', 'life.js', 'isolated.js', 'hooks/hook.cjs']) execFileSync(process.execPath, ['--check', path.join(root, name)], { stdio: 'inherit' });
const release = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
const crypto = require('node:crypto');
for (const [name, hash] of Object.entries(release.sha256)) if (!name.startsWith('public/')) {
  if (crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') !== hash) throw new Error('Release checksum mismatch: ' + name);
}
console.log('Backend syntax and release checksums passed.');
