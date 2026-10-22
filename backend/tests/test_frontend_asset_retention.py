"""An old tab must still be able to import its hashed dependencies after deploy."""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


class FrontendAssetRetentionTests(unittest.TestCase):
    def test_deploy_preserves_old_assets_refreshes_current_and_prunes_only_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, cache = Path(tmp)/'new', Path(tmp)/'cache'
            source.mkdir(); cache.mkdir()
            (cache/'old-card-hash.js').write_text('previous release')
            (cache/'expired.js').write_text('ancient release')
            (cache/'shared.js').write_text('same hash')
            (source/'shared.js').write_text('same hash')
            (source/'new-card-hash.js').write_text('new release')
            old = time.time() - 40 * 86400
            for name in ['expired.js', 'shared.js']: os.utime(cache/name, (old, old))
            subprocess.run(['sh', str(ROOT/'frontend/docker/15-retain-assets.sh'), str(source), str(cache)], check=True)
            self.assertEqual((cache/'old-card-hash.js').read_text(), 'previous release')
            self.assertEqual((cache/'new-card-hash.js').read_text(), 'new release')
            self.assertTrue((cache/'shared.js').exists())
            self.assertFalse((cache/'expired.js').exists())

    def test_first_migration_copies_live_container_files_including_recovered_chunks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            live, result, bin_dir = root/'live', root/'result', root/'bin'
            live.mkdir(); result.mkdir(); bin_dir.mkdir()
            (live/'current.js').write_text('current release')
            (live/'recovered.js').write_text('recovered older release')
            docker = bin_dir/'docker'
            docker.write_text('''#!/usr/bin/env python3
import os, subprocess, sys
args = sys.argv[1:]
if args[:2] == ['volume','create']: print('fixture_volume')
elif args[0] == 'inspect':
    if '--format' in args: print('original-image' if '{{.Image}}' in args else '')
elif args[0] == 'exec':
    if os.environ.get('TTE_EXEC_FAIL'): sys.exit(13)
    subprocess.run(['tar','-C',os.environ['TTE_LIVE'],'-cf','-','.'],check=True)
elif args[0] == 'run':
    assert '--network' in args and 'none' in args
    subprocess.run(['tar','-xf','-','-C',os.environ['TTE_RESULT']],check=True)
else: sys.exit(2)
''')
            docker.chmod(0o755)
            env = os.environ | dict(PATH=f'{bin_dir}:{os.environ["PATH"]}', TTE_LIVE=str(live), TTE_RESULT=str(result))
            script = str(ROOT/'scripts/preserve-frontend-assets.sh')
            subprocess.run(['bash',script],env=env,check=True)
            self.assertEqual((result/'recovered.js').read_text(),'recovered older release')
            self.assertEqual((result/'current.js').read_text(),'current release')
            # A failed snapshot must stop deploy, rather than silently lose old tabs.
            failed = subprocess.run(['bash',script],env=env | {'TTE_EXEC_FAIL':'1'},capture_output=True)
            self.assertNotEqual(failed.returncode,0)
