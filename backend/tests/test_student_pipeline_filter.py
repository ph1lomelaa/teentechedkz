"""Contract-status filters keep their meaning before SQL is constructed."""
import unittest

from fastapi import HTTPException

from app.api.v1.endpoints.students import _parse_pipeline_status_filter
from app.models.contract import PipelineStatus


class PipelineStatusFilterTests(unittest.TestCase):
    def test_multiple_values_are_deduplicated_in_order(self) -> None:
        values, operator = _parse_pipeline_status_filter(
            "active_work,problem,active_work", None, "is_not"
        )
        self.assertEqual(values, [PipelineStatus.active_work, PipelineStatus.problem])
        self.assertEqual(operator, "is_not")

    def test_legacy_single_value_still_works(self) -> None:
        values, operator = _parse_pipeline_status_filter(None, "on_visa", "is")
        self.assertEqual(values, [PipelineStatus.on_visa])
        self.assertEqual(operator, "is")

    def test_unknown_value_is_not_silently_ignored(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            _parse_pipeline_status_filter("active_work,typo", None, "is")
        self.assertEqual(raised.exception.status_code, 422)

    def test_unknown_operator_is_rejected(self) -> None:
        with self.assertRaises(HTTPException):
            _parse_pipeline_status_filter("active_work", None, "contains")


if __name__ == "__main__":
    unittest.main()
