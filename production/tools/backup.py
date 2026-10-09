#!/usr/bin/env python3
"""Back up live code and the database before a manual production update."""
import argparse
import datetime
import shutil
import sqlite3
import os
from pathlib import Path
import json
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app', required=True)
args = parser.parse_args()
app = Path(args.app).resolve()
if app == Path(app.anchor) or not (app / 'server.js').is_file():
    parser.error('Pass the named application directory containing server.js')
manifest = json.loads((Path(__file__).resolve().parents[1] / 'release.json').read_text(encoding='utf-8'))
destination = app / 'data/backups' / ('before-git-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
destination.mkdir(parents=True, mode=0o700)
for name in [*manifest['sha256'], 'SOURCE_RELEASE.json', 'DEPLOYED_SOURCE.json']:
    source = app / name
    if source.is_file() and not source.is_symlink() and source.resolve().is_relative_to(app):
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
database = app / 'data/home.db'
if database.exists():
    with sqlite3.connect(database) as source, sqlite3.connect(destination / 'home.db') as target:
        source.backup(target)
    os.chmod(destination / 'home.db', 0o600)
print(destination)
