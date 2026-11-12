"""Release decisions and failure safety, without building or publishing binaries."""
from copy import deepcopy
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import desktop_releases as releases


SHA = 'a' * 40
NEW_SHA = 'b' * 40


def package(release_id, version, tag=None, draft=False):
    names = sorted(releases.REQUIRED) + [f'Lokal-{version}{suffix}' for suffix in
        ('.exe', '.dmg', '.AppImage', '.deb', '-mac.zip')]
    return dict(id=release_id, tag_name=tag or 'v' + version, draft=draft,
                body=f'Existing notes\n<!-- lokal-desktop version:{version} source:{SHA} -->',
                assets=[dict(name=name, size=42) for name in names])


class FakeGitHub:
    repo = 'example/desktop'

    def __init__(self, *items):
        self.items = {item['id']: deepcopy(item) for item in items}
        self.tags = {item['tag_name']: SHA for item in items}
        self.calls = []
        self.fail_publication = False

    def releases(self):
        return deepcopy(list(self.items.values()))

    def move_tag(self, tag, sha):
        self.calls.append(('tag', tag, sha))
        self.tags[tag] = sha

    def api(self, path, method='GET', data=None):
        self.calls.append((path, method, data))
        if path == 'git/matching-refs/tags/':
            return [dict(ref='refs/tags/' + tag) for tag in self.tags]
        release_id = int(path.split('/')[1])
        if method == 'PATCH':
            if self.fail_publication and data.get('draft') is False:
                raise RuntimeError('Publication failed')
            if 'tag_name' in data and any(item['id'] != release_id and item['tag_name'] == data['tag_name']
                                          for item in self.items.values()):
                raise ValueError('Another release already uses that tag')
            self.items[release_id].update(data)
        elif method == 'DELETE':
            del self.items[release_id]
        return deepcopy(self.items.get(release_id))


class DesktopReleaseTests(unittest.TestCase):
    def test_uploaded_draft_is_resolved_by_id_without_public_tag_lookup(self):
        draft = package(2, '14.3.2', draft=True)
        github = FakeGitHub(draft)
        self.assertEqual(releases.staged_release(github, 'v14.3.2', 2), draft)
        self.assertEqual(github.calls, [('releases/2', 'GET', None)])

    def test_reviewed_draft_can_be_found_in_authenticated_release_listing(self):
        draft = package(2, '14.3.2', draft=True)
        github = FakeGitHub(package(1, '14.3.1', 'desktop'), draft)
        self.assertEqual(releases.staged_release(github, 'v14.3.2'), draft)
        self.assertEqual(github.calls, [])

    def test_wrong_upload_id_cannot_promote_another_tag(self):
        github = FakeGitHub(package(2, '14.3.2', draft=True))
        with self.assertRaisesRegex(ValueError, 'does not match'):
            releases.staged_release(github, 'v14.4.0', 2)

    def test_old_review_draft_cannot_downgrade_stable_release(self):
        draft = package(2, '14.3.0', draft=True)
        github = FakeGitHub(package(1, '14.3.1', 'desktop'), draft)
        with self.assertRaisesRegex(ValueError, 'must be newer'):
            releases.promote(github, draft, 'desktop', '14.3.0', NEW_SHA)
        self.assertEqual(github.calls, [])

    def test_versions_advance_from_published_release_even_when_source_manifest_is_older(self):
        self.assertEqual(releases.plan('14.3.1', '14.3.2'), '14.3.3')
        self.assertEqual(releases.plan('14.3.1', '14.3.2', 'minor'), '14.4.0')
        self.assertEqual(releases.plan('14.3.1', '14.3.2', 'major'), '15.0.0')
        self.assertEqual(releases.plan('14.3.1', '14.3.2', exact='v15.1.0'), '15.1.0')
        self.assertEqual(releases.plan('14.4.0', '14.3.2'), '14.4.0')

    def test_published_version_reuse_and_downgrades_are_rejected(self):
        for value in ('14.3.1', '14.3.0', 'invalid', '14.3.2; echo unsafe'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                releases.plan('14.3.1', '14.3.1', exact=value)

    def test_incomplete_upload_never_changes_public_release_or_tag(self):
        for missing in ('latest-mac.yml', 'Lokal-14.3.2.dmg'):
            staged = package(2, '14.3.2', draft=True)
            staged['assets'] = [a for a in staged['assets'] if a['name'] != missing]
            github = FakeGitHub(package(1, '14.3.1', 'desktop'), staged)
            with self.assertRaises(ValueError):
                releases.promote(github, staged, 'desktop', '14.3.2', NEW_SHA)
            self.assertEqual(github.calls, [])

    def test_promotion_preserves_uploaded_assets_and_sets_public_identity(self):
        staged = package(2, '14.3.2', draft=True)
        github = FakeGitHub(package(1, '14.3.1', 'desktop'), staged)
        releases.promote(github, staged, 'desktop', '14.3.2', NEW_SHA)
        result = github.items[2]
        self.assertFalse(result['draft'])
        self.assertFalse(result['prerelease'])
        self.assertEqual(result['tag_name'], 'desktop')
        self.assertEqual(result['name'], 'Desktop — 14.3.2')
        self.assertEqual(result['assets'], staged['assets'])
        self.assertEqual(releases.identity(result), ('14.3.2', NEW_SHA))
        self.assertEqual(github.tags['desktop'], NEW_SHA)

    def test_failed_publication_restores_original_public_release(self):
        staged = package(2, '14.3.2', draft=True)
        github = FakeGitHub(package(1, '14.3.1', 'desktop'), staged)
        github.fail_publication = True
        with self.assertRaisesRegex(RuntimeError, 'Publication failed'):
            releases.promote(github, staged, 'desktop', '14.3.2', NEW_SHA)
        self.assertEqual(github.items[1]['tag_name'], 'desktop')
        self.assertEqual(github.tags['desktop'], SHA)
        self.assertTrue(github.items[2]['draft'])

    def test_nightly_promotion_cannot_become_latest_stable(self):
        staged = package(2, '14.3.2-nightly.4', draft=True)
        github = FakeGitHub(package(1, '14.3.1', 'desktop'), staged)
        releases.promote(github, staged, 'nightly', '14.3.2-nightly.4', NEW_SHA)
        self.assertTrue(github.items[2]['prerelease'])
        self.assertEqual(github.items[2]['make_latest'], 'false')
        self.assertEqual(github.items[1]['tag_name'], 'desktop')

    def test_rebuilding_same_nightly_version_does_not_collide_with_staging_tag(self):
        version = '14.3.2-nightly.4'
        old = package(2, version, 'nightly')
        staged = package(3, version, draft=True)
        github = FakeGitHub(package(1, '14.3.1', 'desktop'), old, staged)
        releases.promote(github, staged, 'nightly', version, NEW_SHA)
        self.assertEqual(github.items[3]['tag_name'], 'nightly')
        self.assertNotEqual(github.items[2]['tag_name'], staged['tag_name'])

    def test_cleanup_preserves_channels_and_review_drafts(self):
        github = FakeGitHub(package(1, '14.3.1', 'desktop'), package(2, '14.3.0'),
                            package(3, '14.3.2', draft=True), package(4, '14.3.2-nightly.1', 'nightly'))
        github.tags['v1.3'] = SHA
        github.tags['custom-reference'] = SHA
        with patch.object(releases.time, 'sleep'), patch.object(releases.subprocess, 'run') as push:
            releases.cleanup(github)
        self.assertEqual(set(github.items), {1, 3, 4})
        refs = push.call_args.args[0]
        self.assertIn('refs/tags/v1.3', refs)
        self.assertIn('refs/tags/v14.3.0', refs)
        self.assertNotIn('refs/tags/v14.3.2', refs)
        self.assertNotIn('refs/tags/desktop', refs)
        self.assertNotIn('refs/tags/nightly', refs)
        self.assertNotIn('refs/tags/custom-reference', refs)

    def test_cleanup_requires_a_complete_canonical_release(self):
        stable = package(1, '14.3.1', 'desktop')
        stable['assets'] = []
        github = FakeGitHub(stable, package(2, '14.3.0'))
        with self.assertRaises(ValueError):
            releases.cleanup(github)
        self.assertEqual(github.calls, [])

    def test_changelog_links_survive_version_tag_cleanup(self):
        github = FakeGitHub()
        with patch.object(github, 'api', side_effect=[{'object': {'type': 'commit', 'sha': SHA}},
                                                     {'object': {'type': 'commit', 'sha': NEW_SHA}}]):
            body = releases.preserve_compare_links(github,
                'Notes\nhttps://github.com/lokal-music/desktop/compare/v14.3.0...v14.3.1')
        self.assertEqual(body, f'Notes\nhttps://github.com/lokal-music/desktop/compare/{SHA}...{NEW_SHA}')

    def test_build_workflows_are_manual_and_share_publication_lock(self):
        import yaml
        root = Path(__file__).resolve().parents[1]
        workflows = [yaml.load((root / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)
                     for name in ('release.yml', 'nightly.yml')]
        for workflow in workflows:
            self.assertEqual(set(workflow['on']), {'workflow_dispatch'})
        self.assertEqual(workflows[0]['concurrency'], workflows[1]['concurrency'])
        stable = workflows[0]
        self.assertEqual(stable['on']['workflow_dispatch']['inputs']['publish']['default'], 'true')
        promotion = next(s for s in stable['jobs']['release']['steps'] if 'desktop_releases.py promote' in s.get('run', ''))
        self.assertEqual(promotion['if'], 'inputs.publish')
        self.assertEqual(promotion['env']['STAGED_RELEASE_ID'], '${{ steps.create_release.outputs.id }}')
        self.assertIn('--release-id "$STAGED_RELEASE_ID"', promotion['run'])
        nightly_promotion = next(s for s in workflows[1]['jobs']['release']['steps'] if 'desktop_releases.py" promote' in s.get('run', ''))
        self.assertIn('--release-id "$STAGED_RELEASE_ID"', nightly_promotion['run'])
        recovery = yaml.load((root / '.github/workflows/publish-desktop-draft.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(set(recovery['on']), {'workflow_dispatch'})
        self.assertEqual(recovery['concurrency'], stable['concurrency'])


if __name__ == '__main__':
    unittest.main()
