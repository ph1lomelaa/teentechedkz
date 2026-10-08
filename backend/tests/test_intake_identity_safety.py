import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
import uuid

import pandas as pd

from app.services.intake_identity import (
    CandidateSet, is_strong_unique_name_match, pair_cross_source_submissions,
    plausible_student_candidates, source_identity,
)
from app.models.intake_submission import IntakeSource, IntakeStatus
from app.services.intake_promote import automatic_creation_ready
from app.services.sheets_sync import _has_historical_identity_conflict, _ingest_dataframe, _staging_source_key


class _RowsResult:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows


class _StagingSession:
    def __init__(self):
        self.rows = []
        self.commits = 0

    async def execute(self, _query):
        return _RowsResult(self.rows)

    def add(self, row):
        self.rows.append(row)

    async def commit(self):
        self.commits += 1


class IntakeIdentitySafetyTests(unittest.TestCase):
    def test_timestamp_is_stable_when_answer_contents_change(self):
        before = source_identity(
            "cases", ["Timestamp", "ФИО студента", "Номер телефона"],
            ["2026-10-01 12:30:00", "Алия Тест", "+77000000000"],
            {"Timestamp": "2026-10-01 12:30:00", "ФИО студента": "Алия Тест"},
        )
        after = source_identity(
            "cases", ["Timestamp", "ФИО студента", "Номер телефона"],
            ["2026-10-01 12:30:00", "Алия Тест", "+77000000001"],
            {"Timestamp": "2026-10-01 12:30:00", "ФИО студента": "Алия Тест",
             "Номер телефона": "+77000000001"},
        )
        self.assertEqual(before.key, after.key)
        self.assertNotEqual(before.digest, after.digest)
        self.assertFalse(before.review_required)

    def test_row_without_stable_id_or_timestamp_requires_review(self):
        identity = source_identity("package", ["ФИО студента"], ["Алия Тест"], {"ФИО студента": "Алия Тест"})
        self.assertTrue(identity.review_required)
        self.assertTrue(identity.key.startswith("package:content:"))

    def test_all_plausible_candidates_are_returned(self):
        first, second = uuid.uuid4(), uuid.uuid4()
        result = plausible_student_candidates(
            "Алия Садыкова", "+77000000000",
            [
                {"id": first, "full_name": "Алия Садыкова", "phone": "+77000000000"},
                {"id": second, "full_name": "Алия Садыкова", "phone": "+77000000001"},
            ],
        )
        self.assertEqual(set(result.student_ids), {first, second})
        self.assertEqual(result.reason, "multiple_candidates")

    def test_auto_link_requires_one_strong_name_match(self):
        candidate_id = uuid.uuid4()
        self.assertTrue(is_strong_unique_name_match(CandidateSet((candidate_id,), 1.0, "name_exact")))
        self.assertTrue(is_strong_unique_name_match(CandidateSet((candidate_id,), 0.95, "name_translit")))
        self.assertFalse(is_strong_unique_name_match(CandidateSet((candidate_id,), 1.0, "phone_exact")))
        self.assertFalse(is_strong_unique_name_match(CandidateSet((candidate_id, uuid.uuid4()), 1.0, "multiple_candidates")))
        conflict = plausible_student_candidates(
            "Алия Садыкова", "+77000000001",
            [{"id": candidate_id, "full_name": "Алия Садыкова", "phone": "+77000000000"}],
        )
        self.assertFalse(is_strong_unique_name_match(conflict))
        self.assertEqual(conflict.reason, "name_phone_conflict")

    def test_only_reciprocal_cross_form_name_match_is_paired(self):
        package = SimpleNamespace(
            id=uuid.uuid4(), source=IntakeSource.package, full_name="Алия Садыкова",
            phone_normalized="+77000000000", status=IntakeStatus.new,
        )
        cases = SimpleNamespace(
            id=uuid.uuid4(), source=IntakeSource.cases, full_name="Алия Садыкова",
            phone_normalized="+77000000000", status=IntakeStatus.new,
        )
        result = pair_cross_source_submissions([package, cases])
        self.assertEqual(result, {package.id: cases.id, cases.id: package.id})

        cases.phone_normalized = "+77000000001"
        self.assertEqual(pair_cross_source_submissions([package, cases]), {})

    def test_same_source_duplicate_makes_cross_form_pair_ambiguous(self):
        package1 = SimpleNamespace(
            id=uuid.uuid4(), source=IntakeSource.package, full_name="Алия Садыкова",
            phone_normalized="", status=IntakeStatus.new,
        )
        package2 = SimpleNamespace(
            id=uuid.uuid4(), source=IntakeSource.package, full_name="Алия Садыкова",
            phone_normalized="", status=IntakeStatus.new,
        )
        cases = SimpleNamespace(
            id=uuid.uuid4(), source=IntakeSource.cases, full_name="Алия Садыкова",
            phone_normalized="", status=IntakeStatus.new,
        )
        self.assertEqual(pair_cross_source_submissions([package1, package2, cases]), {})

    def test_auto_create_requires_wait_and_both_fresh_sources(self):
        first_seen = datetime(2026, 10, 1, tzinfo=timezone.utc)
        submission = SimpleNamespace(
            first_seen_at=first_seen,
            created_at=first_seen,
            content_changed_at=first_seen,
        )
        now = first_seen + timedelta(hours=24)
        self.assertFalse(automatic_creation_ready(
            submission, first_seen, now, now=now
        ))
        self.assertFalse(automatic_creation_ready(
            submission, first_seen + timedelta(seconds=1), None, now=now
        ))
        self.assertFalse(automatic_creation_ready(
            submission, first_seen + timedelta(seconds=1), now,
            now=now - timedelta(seconds=1),
        ))
        self.assertTrue(automatic_creation_ready(
            submission, first_seen + timedelta(seconds=1), now, now=now
        ))

    def test_content_revision_restarts_wait_window(self):
        first_seen = datetime(2026, 10, 1, tzinfo=timezone.utc)
        changed_at = first_seen + timedelta(hours=23)
        submission = SimpleNamespace(
            first_seen_at=first_seen,
            created_at=first_seen,
            content_changed_at=changed_at,
        )
        now = first_seen + timedelta(hours=24)
        self.assertFalse(automatic_creation_ready(
            submission, now, now, now=now
        ))

    def test_identical_duplicate_key_survives_later_single_row_export(self):
        identity_key = "cases:timestamp:2026-10-01 12:30:00"
        digest = "abc123"
        duplicate_key = _staging_source_key(
            identity_key, digest, duplicate=True,
            conflicting_duplicate_content=False, existing_keys=set(),
        )
        next_sync_key = _staging_source_key(
            identity_key, digest, duplicate=False,
            conflicting_duplicate_content=False, existing_keys={duplicate_key},
        )
        self.assertEqual(duplicate_key, next_sync_key)

    def test_same_timestamp_conflicting_content_has_order_independent_keys(self):
        identity_key = "cases:timestamp:2026-10-01 12:30:00"
        first, second = "digest-a", "digest-b"
        first_key = _staging_source_key(
            identity_key, first, duplicate=True,
            conflicting_duplicate_content=True, existing_keys=set(),
        )
        second_key = _staging_source_key(
            identity_key, second, duplicate=True,
            conflicting_duplicate_content=True, existing_keys={first_key},
        )
        self.assertNotEqual(first_key, second_key)
        self.assertEqual(first_key, _staging_source_key(
            identity_key, first, duplicate=False,
            conflicting_duplicate_content=False, existing_keys={first_key, second_key},
        ))

    def test_conflicting_timestamp_stays_review_required_after_export_changes(self):
        identity_key = "cases:timestamp:2026-10-01 12:30:00"
        first_key = _staging_source_key(
            identity_key, "digest-a", duplicate=True,
            conflicting_duplicate_content=True, existing_keys=set(),
        )
        second_key = _staging_source_key(
            identity_key, "digest-b", duplicate=True,
            conflicting_duplicate_content=True, existing_keys={first_key},
        )

        # The export may later contain only one old revision, or a changed
        # third payload. Either way, prior evidence of a colliding identity
        # remains and must block automatic link/create.
        self.assertTrue(_has_historical_identity_conflict(identity_key, {first_key, second_key}))
        self.assertTrue(_has_historical_identity_conflict(identity_key, {first_key}))
        self.assertFalse(_has_historical_identity_conflict(identity_key, set()))

    def test_ingest_replay_and_collapsed_exact_duplicate_do_not_create_new_staging_rows(self):
        session = _StagingSession()
        timestamp = "2026-10-01 12:30:00"
        duplicated = pd.DataFrame([
            [timestamp, "Алия Садыкова", "+7 700 000 00 00"],
            [timestamp, "Алия Садыкова", "+7 700 000 00 00"],
        ], columns=["Timestamp", "ФИО студента", "Номер телефона"])
        result = asyncio.run(_ingest_dataframe(session, duplicated, IntakeSource.cases, []))
        self.assertEqual(result["new"], 1)
        self.assertEqual(result["duplicate_rows"], 1)
        self.assertEqual(len(session.rows), 1)
        self.assertTrue(session.rows[0].identity_review_required)
        original_key = session.rows[0].source_key
        original_revision = session.rows[0].content_revision

        single = duplicated.iloc[:1].copy()
        replay = asyncio.run(_ingest_dataframe(session, single, IntakeSource.cases, []))
        self.assertEqual(replay["new"], 0)
        self.assertEqual(len(session.rows), 1)
        self.assertEqual(session.rows[0].source_key, original_key)
        self.assertEqual(session.rows[0].content_revision, original_revision)
        self.assertTrue(session.rows[0].identity_review_required)

    def test_ingest_content_edit_updates_revision_and_keeps_identity_on_review(self):
        session = _StagingSession()
        timestamp = "2026-10-01 12:30:00"
        before = pd.DataFrame(
            [[timestamp, "Алия Садыкова", "+7 700 000 00 00"]],
            columns=["Timestamp", "ФИО студента", "Номер телефона"],
        )
        after = before.copy()
        after.loc[0, "Номер телефона"] = "+7 701 111 11 11"
        asyncio.run(_ingest_dataframe(session, before, IntakeSource.cases, []))
        row = session.rows[0]
        original_key = row.source_key
        original_changed_at = row.content_changed_at

        result = asyncio.run(_ingest_dataframe(session, after, IntakeSource.cases, []))
        self.assertEqual(result["new"], 0)
        self.assertEqual(result["updated"], 1)
        self.assertEqual(len(session.rows), 1)
        self.assertEqual(row.source_key, original_key)
        self.assertEqual(row.content_revision, 2)
        self.assertGreaterEqual(row.content_changed_at, original_changed_at)
        self.assertTrue(row.identity_review_required)


if __name__ == "__main__":
    unittest.main()
