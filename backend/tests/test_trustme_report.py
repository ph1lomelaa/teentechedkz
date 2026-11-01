import argparse
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from scripts import sync_trustme


class LocalReportTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_local_report_requires_no_trustme_credentials_and_is_private(self):
        result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))
        session = AsyncMock()
        session.__aenter__.return_value = SimpleNamespace(execute=AsyncMock(return_value=result))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'report.json'
            args = argparse.Namespace(output=str(path), resume=False, local_only=True,
                include_archived=False, student_id=None, limit=100)
            with patch.object(sync_trustme, 'AsyncSessionLocal', return_value=session), patch.object(sync_trustme.TrustMeClient, 'from_settings') as upstream:
                await sync_trustme.run(args)
            upstream.assert_not_called()
            report = json.loads(path.read_text())
            self.assertEqual(report['mode'], 'local_only')
            self.assertEqual(report['financial_counts'], {'total': 0, 'linked': 0, 'unlinked': 0})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            args.resume = True; args.local_only = False
            with self.assertRaises(ValueError):
                await sync_trustme.run(args)
