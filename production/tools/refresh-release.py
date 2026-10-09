#!/usr/bin/env python3
"""Update both release manifests after intentional source edits."""
import argparse
from pathlib import Path
import json
import hashlib
import datetime
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--frontend', required=True)
args = parser.parse_args()
backend = Path(__file__).resolve().parents[1]
frontend = Path(args.frontend).resolve()
release = json.loads((backend / 'release.json').read_text(encoding='utf-8'))
for name in release['sha256']:
    base = frontend if name.startswith('public/') else backend
    source = base / name
    if source.is_symlink() or not source.resolve().is_relative_to(base):
        parser.error('Unsafe source: ' + name)
    release['sha256'][name] = hashlib.sha256(source.read_bytes()).hexdigest()
release['snapshot'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
requirement = (backend / 'requirements.txt').read_text(encoding='utf-8').strip()
if not requirement.startswith('Pillow==') or '\n' in requirement:
    parser.error('Expected one pinned Pillow requirement')
release['pythonDependencies'] = {'pillow': requirement.split('==', 1)[1]}
for base in [backend, frontend]:
    (base / 'release.json').write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Updated both manifests:', release['snapshot'])
