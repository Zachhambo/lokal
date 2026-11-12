#!/usr/bin/env python3
"""Manual version planning and verified rolling desktop/nightly releases."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time

VERSION = re.compile(r'\d+\.\d+\.\d+')
MANAGED = re.compile(r'(?:v?\d+(?:\.\d+)+(?:[-.][\w.-]+)?|nightly-[\w.-]+)')
MARKER = re.compile(r'<!-- lokal-desktop version:(\d+\.\d+\.\d+(?:-nightly\.\d+)?) source:([0-9a-f]{40}) -->')
REQUIRED = {'latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml'}


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


class GitHub:
    def __init__(self, repo):
        self.repo = repo

    def api(self, path, method='GET', data=None):
        command = ['gh', 'api', f'repos/{self.repo}/{path}', '--method', method]
        if data is not None:
            command += ['--input', '-']
        result = subprocess.check_output(command, input=json.dumps(data) if data is not None else None, text=True)
        return json.loads(result) if result.strip() else None

    def releases(self):
        result, page = [], 1
        while True:
            rows = self.api(f'releases?per_page=100&page={page}')
            result.extend(rows)
            if len(rows) < 100:
                return result
            page += 1

    def move_tag(self, tag, sha):
        refs = self.api(f'git/matching-refs/tags/{tag}')
        if any(r['ref'] == f'refs/tags/{tag}' for r in refs):
            self.api(f'git/refs/tags/{tag}', 'PATCH', {'sha': sha, 'force': True})
        else:
            self.api('git/refs', 'POST', {'ref': f'refs/tags/{tag}', 'sha': sha})


def version_tuple(version):
    if not VERSION.fullmatch(version):
        raise ValueError(f'Expected a version like 14.3.2: {version}')
    return tuple(map(int, version.split('.')))


def identity(release):
    match = MARKER.search(release.get('body') or '')
    if not match:
        raise ValueError('Rolling release lacks its version/source marker')
    return match.groups()


def plan(current, published, bump='patch', exact=''):
    base = max((current, published), key=version_tuple) if published else current
    if exact:
        new = exact.removeprefix('v')
    elif published and bump == 'patch' and version_tuple(current) > version_tuple(published):
        new = current
    else:
        major, minor, patch = version_tuple(base)
        new = '.'.join(map(str, (major + 1, 0, 0) if bump == 'major' else
                               (major, minor + 1, 0) if bump == 'minor' else (major, minor, patch + 1)))
    if version_tuple(new) < version_tuple(current) or (published and version_tuple(new) <= version_tuple(published)):
        raise ValueError('The release version must exceed the published version and cannot downgrade package.json')
    return new


def prepare(github, args):
    releases = github.releases()
    stable = next((r for r in releases if r['tag_name'] == 'desktop' and not r['draft']), None)
    published, previous = identity(stable) if stable else ('', '')
    current = json.loads(Path('package.json').read_text())['version'].split('-')[0]
    sha = git('rev-parse', 'HEAD')
    if args.command == 'nightly':
        base = plan(current, published)
        number = int(git('rev-list', '--count', '--first-parent', f'{previous}..HEAD')) if previous else int(os.environ['GITHUB_RUN_NUMBER'])
        if not number:
            raise ValueError('No source changes since the stable release')
        version = f'{base}-nightly.{number}'
    else:
        version = plan(current, published, args.bump, args.version)
    tag = 'v' + version
    # Never overwrite an existing version draft or reuse its assets.
    if any(r['tag_name'] == tag for r in releases):
        raise ValueError(f'{tag} already has a release; publish that draft or choose another version')
    values = dict(version=version, tag=tag, sha=sha, previous=previous)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(''.join(f'{key}={value}\n' for key, value in values.items()))
    print(json.dumps(values))


def verify(release, version):
    assets = {asset['name']: asset for asset in release['assets']}
    if not REQUIRED <= assets.keys() or any(not assets[n]['size'] for n in REQUIRED):
        raise ValueError('All four platform updater manifests must be uploaded before publication/cleanup')
    for suffix in ('.exe', '.dmg', '.AppImage', '.deb', '-mac.zip'):
        if not any(version in name and name.endswith(suffix) and asset['size'] > 0 for name, asset in assets.items()):
            raise ValueError(f'Missing completed {suffix} package for {version}')


def marked_body(release, version, sha):
    return MARKER.sub('', release.get('body') or '').rstrip() + f'\n\n<!-- lokal-desktop version:{version} source:{sha} -->\n'


def staged_release(github, tag, release_id=None):
    # GitHub's releases/tags endpoint excludes unpublished drafts, even when
    # their metadata already has tag_name. Prefer the upload action's ID.
    if release_id is not None:
        release = github.api(f'releases/{release_id}')
        if release['tag_name'] != tag:
            raise ValueError('The uploaded release ID does not match the requested tag')
        return release
    matches = [release for release in github.releases() if release['tag_name'] == tag]
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one release/draft for {tag}')
    return matches[0]


def preserve_compare_links(github, body):
    def replace(match):
        commits = []
        for tag in match.groups()[1:]:
            target = github.api(f'git/ref/tags/{tag}')['object']
            while target['type'] == 'tag':
                target = github.api(f'git/tags/{target["sha"]}')['object']
            if target['type'] != 'commit' or not re.fullmatch(r'[0-9a-f]{40}', target['sha']):
                raise ValueError('Changelog tags must resolve to commits before deletion')
            commits.append(target['sha'])
        return match[1] + '...'.join(commits)
    return re.sub(r'(https://github\.com/[^/]+/[^/]+/compare/)(v\d+(?:\.\d+)+)\.\.\.(v\d+(?:\.\d+)+)', replace, body)


def promote(github, staged, channel, version, sha):
    if channel not in ('desktop', 'nightly') or not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Invalid rolling channel/source')
    verify(staged, version)
    releases = github.releases()
    old = next((r for r in releases if r['tag_name'] == channel and r['id'] != staged['id']), None)
    if old and channel == 'desktop' and version_tuple(version) <= version_tuple(identity(old)[0]):
        raise ValueError('The stable draft must be newer than the published desktop release')
    old_sha = identity(old)[1] if old else None
    # Keep the old release/assets recoverable until the replacement publishes.
    if old:
        backup = f'v{identity(old)[0]}-retired.{old["id"]}'
        github.move_tag(backup, old_sha)
        github.api(f'releases/{old["id"]}', 'PATCH', {'tag_name': backup})
    try:
        github.move_tag(channel, sha)
        github.api(f'releases/{staged["id"]}', 'PATCH', {
            'tag_name': channel, 'target_commitish': sha,
            'name': f'{"Desktop" if channel == "desktop" else "Desktop Nightly"} — {version}',
            'body': marked_body(staged, version, sha), 'draft': False,
            'prerelease': channel == 'nightly', 'make_latest': 'true' if channel == 'desktop' else 'false',
        })
    except Exception:
        if old:
            github.move_tag(channel, old_sha)
            github.api(f'releases/{old["id"]}', 'PATCH', {'tag_name': channel})
        raise


def cleanup(github, dry_run=False):
    releases = github.releases()
    stable = next(r for r in releases if r['tag_name'] == 'desktop' and not r['draft'])
    verify(stable, identity(stable)[0])
    # Drafts are intentional review results, and must keep their source tags.
    keep = {'desktop', 'nightly'} | {r['tag_name'] for r in releases if r['draft']}
    obsolete = [r for r in releases if r['tag_name'] not in keep and MANAGED.fullmatch(r['tag_name'])]
    tags = [r['ref'] for r in github.api('git/matching-refs/tags/')
            if r['ref'].removeprefix('refs/tags/') not in keep and MANAGED.fullmatch(r['ref'].removeprefix('refs/tags/'))]
    print(json.dumps({'keep': sorted(keep), 'delete_releases': len(obsolete), 'delete_tags': len(tags)}), flush=True)
    if dry_run:
        return
    for release in obsolete:
        print(f'Removing superseded release: {release["tag_name"]}', flush=True)
        github.api(f'releases/{release["id"]}', 'DELETE')
        time.sleep(1)  # Stay below GitHub's content-mutation rate limit.
    for index in range(0, len(tags), 25):
        subprocess.run(['git', 'push', f'https://github.com/{github.repo}.git', '--delete', *tags[index:index + 25]], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'nightly', 'promote', 'consolidate', 'cleanup'])
    parser.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY', 'lokal-music/desktop'))
    parser.add_argument('--bump', choices=['patch', 'minor', 'major'], default='patch')
    parser.add_argument('--version', default='')
    parser.add_argument('--tag')
    parser.add_argument('--release-id', type=int)
    parser.add_argument('--sha')
    parser.add_argument('--channel', choices=['desktop', 'nightly'], default='desktop')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    github = GitHub(args.repo)
    if args.command in ('prepare', 'nightly'):
        prepare(github, args)
    elif args.command == 'cleanup':
        cleanup(github, args.dry_run)
    else:
        release = staged_release(github, args.tag, args.release_id)
        version = args.version or args.tag.removeprefix('v')
        target = release.get('target_commitish', '')
        sha = args.sha or (target if re.fullmatch(r'[0-9a-f]{40}', target) else
                           git('rev-parse', f'refs/tags/{args.tag}^{{commit}}'))
        if args.dry_run:
            verify(release, version)
            print(json.dumps({'release': release['id'], 'channel': args.channel, 'version': version, 'sha': sha}))
            return
        if args.command == 'consolidate':
            release['body'] = preserve_compare_links(github, release.get('body') or '')
        promote(github, release, args.channel, version, sha)
        cleanup(github)


if __name__ == '__main__':
    main()
