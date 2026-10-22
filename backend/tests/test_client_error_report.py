import asyncio
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from fastapi import Request
from pydantic import ValidationError
from app.api.v1.endpoints.auth import report_client_error
from app.models.user import User, UserRole
from app.schemas.auth import ClientErrorReport


class ClientErrorReportTests(unittest.TestCase):
    def test_logs_only_categorical_diagnostics_for_authenticated_user(self):
        user = User(id=uuid.uuid4(), role=UserRole.mentor)
        body = ClientErrorReport(kind='render', error_type='TypeError',
            route='workspace_student_card', components=['WorkspaceStudentDetailPage'])
        with patch('app.api.v1.endpoints.auth.rate_limit.enforce', new_callable=AsyncMock) as throttle, \
             patch('app.api.v1.endpoints.auth.logger.warning') as log:
            result = asyncio.run(report_client_error(body, Request({'type':'http'}), user))
        self.assertEqual(result, {'accepted':True})
        self.assertEqual(throttle.call_args.kwargs['subject'], str(user.id))
        self.assertEqual(log.call_args.args[-1], 'WorkspaceStudentDetailPage')

    def test_private_messages_urls_and_oversized_component_lists_are_rejected(self):
        basic = dict(kind='render', error_type='TypeError', route='student_card')
        for extra in [dict(message='private data'), dict(route='/students/private-id'),
                      dict(components=['bad\nlog injection']), dict(components=['Card'] * 31)]:
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                ClientErrorReport(**(basic | extra))
