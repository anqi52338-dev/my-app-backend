#!/usr/bin/env python3
"""Encrypted daily data backups; verify or extract into a new recovery directory."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile

os.umask(0o077)

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def crypt(source, target, key, decrypt=False):
    cmd = ['gpg', '--batch', '--yes', '--no-symkey-cache', '--pinentry-mode', 'loopback',
           '--passphrase-file', str(key), '--output', str(target)]
    cmd += ['--decrypt', str(source)] if decrypt else ['--symmetric', '--cipher-algo', 'AES256', str(source)]
    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('GPG encryption/decryption failed; archive or recovery key may be invalid')
    target.chmod(0o600)

def unpack(archive, directory, key):
    plain = directory / 'payload.tar.gz'
    crypt(archive, plain, key, decrypt=True)
    root = directory / 'recovered'
    root.mkdir(mode=0o700)
    with tarfile.open(plain, 'r:gz') as bundle:
        for item in bundle.getmembers():
            dest = root / item.name
            if not dest.resolve().is_relative_to(root.resolve()) or not (item.isfile() or item.isdir()):
                raise RuntimeError('Unsafe archive member')
        bundle.extractall(root, filter='data')
    plain.unlink()
    manifest = json.loads((root / 'BACKUP.json').read_text())
    for name, expected in manifest['sha256'].items():
        path = root / name
        if not path.resolve().is_relative_to(root.resolve()) or not path.is_file() or digest(path) != expected:
            raise RuntimeError('Backup checksum mismatch: ' + name)
    db = root / 'data/home.db'
    with sqlite3.connect('file:' + str(db) + '?mode=ro', uri=True) as connection:
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Backup SQLite integrity check failed')
    return root, manifest

def prune(destination):
    archives = sorted(destination.glob('our-home-????????T??????Z.tar.gz.gpg'), reverse=True)
    keep, days, weeks = set(), set(), set()
    for archive in archives:
        timestamp = dt.datetime.strptime(archive.name[9:25], '%Y%m%dT%H%M%SZ')
        day = timestamp.date()
        week = timestamp.isocalendar()[:2]
        if day not in days and len(days) < 7:
            days.add(day)
            keep.add(archive)
        if week not in weeks and len(weeks) < 4:
            weeks.add(week)
            keep.add(archive)
    for archive in archives:
        if archive not in keep:
            archive.unlink()
            archive.with_suffix(archive.suffix + '.sha256').unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', default='/home/ubuntu/our-home')
    parser.add_argument('--destination', default='/home/ubuntu/our-home-backups')
    parser.add_argument('--key', default='/home/ubuntu/.config/our-home-backup/recovery.key')
    parser.add_argument('--verify', type=Path)
    parser.add_argument('--extract', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    app, destination, key = Path(args.app).resolve(), Path(args.destination).resolve(), Path(args.key).absolute()
    if args.verify and args.extract:
        parser.error('Choose verify or extract')
    if args.extract and (not args.output or args.output.exists()):
        parser.error('Extraction requires a new, nonexistent --output directory')
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.chmod(0o700)
    if not key.exists():
        if args.verify or args.extract:
            parser.error('The original recovery key is required')
        key.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with key.open('x') as stream:
            stream.write(secrets.token_urlsafe(48) + '\n')
        key.chmod(0o600)
    if key.is_symlink() or key.stat().st_mode & 0o077:
        parser.error('Recovery key must be private (chmod 600), not a symlink')
    with (destination / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(prefix='.work-', dir=destination) as temporary:
            temp = Path(temporary)
            if args.verify or args.extract:
                root, manifest = unpack((args.verify or args.extract).resolve(), temp, key)
                if args.extract:
                    shutil.copytree(root, args.output)
                    args.output.chmod(0o700)
                print(json.dumps({'verified': True, 'files': len(manifest['sha256']), 'snapshot': manifest['snapshot']}))
                return
            if not (app / 'server.js').is_file() or not (app / 'data/home.db').is_file():
                parser.error('Application and database not found')
            if destination.is_relative_to(app / 'data'):
                parser.error('Backup destination must be outside application data')
            if shutil.disk_usage(destination).free < 100 * 1024 * 1024:
                raise RuntimeError('Less than 100 MiB free for backups')
            stage = temp / 'snapshot'
            data = stage / 'data'
            data.mkdir(parents=True, mode=0o700)
            with sqlite3.connect('file:' + str(app / 'data/home.db') + '?mode=ro', uri=True) as source:
                with sqlite3.connect(data / 'home.db') as target:
                    source.backup(target)
                    if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                        raise RuntimeError('SQLite integrity check failed')
            for path in sorted((app / 'data').rglob('*')):
                relative = path.relative_to(app / 'data')
                if relative.parts[0] == 'backups' or path.name in ('home.db', 'home.db-wal', 'home.db-shm') or (path.name.startswith('.candyjar-') and path.suffix == '.json'):
                    continue
                if path.is_symlink():
                    raise RuntimeError('Data symlink requires an explicit backup decision: ' + str(relative))
                if path.is_file():
                    output = data / relative
                    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    shutil.copy2(path, output)
                    output.chmod(0o600)
            snapshot = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            manifest = {'snapshot': snapshot, 'sha256': {p.relative_to(stage).as_posix(): digest(p) for p in sorted(stage.rglob('*')) if p.is_file()},
                        'scope': 'Application data and uploads; excludes older backups and Claude account credentials'}
            (stage / 'BACKUP.json').write_text(json.dumps(manifest, indent=2))
            plain = temp / 'payload.tar.gz'
            with tarfile.open(plain, 'w:gz') as bundle:
                for path in sorted(stage.rglob('*')):
                    if path.is_file():
                        bundle.add(path, arcname=path.relative_to(stage).as_posix(), recursive=False)
            encrypted = temp / 'payload.gpg'
            crypt(plain, encrypted, key)
            plain.unlink()
            _, checked = unpack(encrypted, temp, key)
            if checked != manifest:
                raise RuntimeError('Backup manifest verification failed')
            final = destination / ('our-home-' + snapshot + '.tar.gz.gpg')
            if final.exists():
                raise RuntimeError('Backup filename already exists; retry in one second')
            encrypted.replace(final)
            final.with_suffix(final.suffix + '.sha256').write_text(digest(final) + '  ' + final.name + '\n')
            prune(destination)
            print(json.dumps({'archive': str(final), 'sha256': digest(final), 'files': len(manifest['sha256']), 'verified': True}))

if __name__ == '__main__':
    main()
