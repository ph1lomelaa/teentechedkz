"""Agreement signature gate (ОС 30/07, Блок C) — самое рискованное место плана.

agreement_gate_applies решает, проверять ли запрос против неподписанных
регламентов, ДО обращения к БД. Ошибка здесь = блокировка всех, включая
админа. Тест обязателен по плану (§ 9.2): «админ входит при неподписанном
регламенте».
"""
import unittest

from app.core.deps import agreement_gate_applies
from app.models.user import UserRole


class AgreementGateTests(unittest.TestCase):
    def test_admin_never_gated_even_when_enabled(self) -> None:
        self.assertFalse(
            agreement_gate_applies(enabled=True, role=UserRole.admin, path="/api/v1/students")
        )

    def test_mzk_manager_gated_on_arbitrary_path_when_enabled(self) -> None:
        self.assertTrue(
            agreement_gate_applies(enabled=True, role=UserRole.mzk_manager, path="/api/v1/students")
        )

    def test_student_gated_on_arbitrary_path_when_enabled(self) -> None:
        # Регламент Академ Хэда: «только после подписи, открывать систему для
        # работы» — распространяется и на студентов, не только менторов.
        self.assertTrue(
            agreement_gate_applies(enabled=True, role=UserRole.student, path="/api/v1/portal/tasks")
        )

    def test_student_can_reach_portal_profile(self) -> None:
        self.assertFalse(
            agreement_gate_applies(enabled=True, role=UserRole.student, path="/api/v1/portal/profile")
        )

    def test_student_can_reach_pending_agreements(self) -> None:
        self.assertFalse(
            agreement_gate_applies(enabled=True, role=UserRole.student, path="/api/v1/agreements/pending")
        )

    def test_student_can_reach_sign_endpoint(self) -> None:
        self.assertFalse(
            agreement_gate_applies(
                enabled=True,
                role=UserRole.student,
                path="/api/v1/agreements/11111111-1111-1111-1111-111111111111/sign",
            )
        )

    def test_student_never_gated_when_disabled(self) -> None:
        self.assertFalse(
            agreement_gate_applies(enabled=False, role=UserRole.student, path="/api/v1/portal/tasks")
        )

    def test_mentor_gated_on_arbitrary_path_when_enabled(self) -> None:
        self.assertTrue(
            agreement_gate_applies(enabled=True, role=UserRole.mentor, path="/api/v1/students")
        )

    def test_disabled_flag_never_gates_anyone(self) -> None:
        self.assertFalse(
            agreement_gate_applies(enabled=False, role=UserRole.mentor, path="/api/v1/students")
        )

    def test_mentor_can_reach_auth_me(self) -> None:
        self.assertFalse(
            agreement_gate_applies(enabled=True, role=UserRole.mentor, path="/api/v1/auth/me")
        )

    def test_mentor_can_reach_logout(self) -> None:
        self.assertFalse(
            agreement_gate_applies(enabled=True, role=UserRole.mentor, path="/api/v1/auth/logout")
        )

    def test_mentor_can_reach_pending_agreements(self) -> None:
        self.assertFalse(
            agreement_gate_applies(enabled=True, role=UserRole.mentor, path="/api/v1/agreements/pending")
        )

    def test_mentor_can_reach_sign_endpoint(self) -> None:
        self.assertFalse(
            agreement_gate_applies(
                enabled=True,
                role=UserRole.mentor,
                path="/api/v1/agreements/11111111-1111-1111-1111-111111111111/sign",
            )
        )

    def test_mentor_cannot_reach_sibling_path_that_merely_contains_sign(self) -> None:
        # Guard against a loose prefix/substring check accidentally widening the allow-list.
        self.assertTrue(
            agreement_gate_applies(
                enabled=True,
                role=UserRole.mentor,
                path="/api/v1/agreements/11111111-1111-1111-1111-111111111111/sign/extra",
            )
        )

    def test_mentor_cannot_reach_unrelated_agreements_path(self) -> None:
        self.assertTrue(
            agreement_gate_applies(enabled=True, role=UserRole.mentor, path="/api/v1/agreements")
        )


if __name__ == "__main__":
    unittest.main()
