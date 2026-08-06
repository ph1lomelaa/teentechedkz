"""Переподпись новой редакции регламента.

`version` не инкрементировался нигде, поэтому проверка
`s.agreement_version != agreement.version` не срабатывала никогда: админ мог
опубликовать новую редакцию, но потребовать её подписать было невозможно —
подпись первой версии закрывала документ навсегда.

Здесь фиксируем правило переподписи и соответствие ролей аудиториям (два
словаря успели разъехаться бы незаметно: у аудиторий ключ `mzk`, у ролей —
`mzk_manager`).
"""
import unittest

from app.api.v1.endpoints.agreements import _audience_for_role
from app.models.agreement import AgreementAudience
from app.models.user import UserRole
from app.services.agreements import (
    audience_for_role,
    roles_for_audience,
    signature_covers_version,
)


class SignatureVersionTests(unittest.TestCase):
    def test_signature_of_current_version_counts(self):
        self.assertTrue(signature_covers_version(signed_version=1, current_version=1))

    def test_old_signature_does_not_cover_new_redaction(self):
        """Главная регрессия: после правки документа подпись v1 не закрывает v2."""
        self.assertFalse(signature_covers_version(signed_version=1, current_version=2))

    def test_missing_signature_never_covers(self):
        self.assertFalse(signature_covers_version(signed_version=None, current_version=1))


class AudienceMappingTests(unittest.TestCase):
    def test_endpoint_and_service_agree(self):
        """Одна таблица на два модуля: копии больше нет, но проверим связь."""
        for role in UserRole:
            with self.subTest(role=role):
                self.assertIs(_audience_for_role(role), audience_for_role(role))

    def test_mzk_manager_maps_to_mzk_audience(self):
        """Разные словари: роль mzk_manager, аудитория mzk."""
        self.assertIs(audience_for_role(UserRole.mzk_manager), AgreementAudience.mzk)

    def test_every_audience_resolves_back_to_its_role(self):
        for audience in AgreementAudience:
            with self.subTest(audience=audience):
                roles = roles_for_audience(audience)
                self.assertTrue(roles, f"у аудитории {audience} нет ролей")
                for role in roles:
                    self.assertIs(audience_for_role(role), audience)


if __name__ == "__main__":
    unittest.main()
