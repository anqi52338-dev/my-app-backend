#!/usr/bin/env python3
"""Assemble matching frontend/backend releases without touching runtime data."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--frontend', required=True, help='qianduanku/production directory')
parser.add_argument('--output', required=True, help='application directory, e.g. /home/ubuntu/our-home')
args = parser.parse_args()
backend = Path(__file__).resolve().parents[1]
frontend = Path(args.frontend).resolve()
output = Path(args.output).resolve()
if output == Path(output.anchor) or output in [backend, frontend]:
    parser.error('Output must be a separate named application directory')
release = json.loads((backend / 'release.json').read_text(encoding='utf-8'))
front_release = json.loads((frontend / 'release.json').read_text(encoding='utf-8'))
if release != front_release:
    parser.error('Frontend/backend releases differ; check out the matching snapshot in both repositories')
files = []
for name, digest in release['sha256'].items():
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts or relative.parts[0] in ['data', 'vendor', '.git', 'node_modules']:
        parser.error('Unsafe release path: ' + name)
    base = frontend if name.startswith('public/') else backend
    source = base / relative
    if source.is_symlink() or not source.resolve().is_relative_to(base) or not source.is_file():
        parser.error('Missing or unsafe source: ' + name)
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        parser.error('Source checksum changed: ' + name + '; regenerate release manifests before deploying edits')
    target = output / relative
    if target.is_symlink() or not target.resolve().is_relative_to(output):
        parser.error('Unsafe target: ' + name)
    files.append((source, target))
for source, target in files:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
for name in ['requirements.txt', 'package.json']:
    target = output / name
    if target.is_symlink():
        parser.error('Unsafe target: ' + name)
    shutil.copy2(backend / name, target)
(output / 'SOURCE_RELEASE.json').write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f"Assembled snapshot {release['snapshot']}: {len(files)} runtime files into {output}")
print('Existing data/, uploads, vendor/, credentials, and backups were left in place.')
