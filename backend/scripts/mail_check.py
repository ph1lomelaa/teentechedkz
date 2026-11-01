"""Проверить почту платформы на сервере.

    docker exec tte_backend_prod python scripts/mail_check.py buh@teenteched.kz

Шлёт тестовое письмо с текущими SMTP_* из .env и, если не вышло, объясняет
причину по-человечески (чаще всего — нужен пароль приложения Google).
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import mail_diagnostics  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2 or "@" not in sys.argv[1]:
        print("Использование: python scripts/mail_check.py адрес@почты")
        return 2
    print("Настройки:", mail_diagnostics.settings_summary())
    result = asyncio.run(mail_diagnostics.send_test(sys.argv[1]))
    if result["ok"]:
        print(f"Письмо отправлено на {sys.argv[1]}. Проверьте ящик (и папку «Спам»).")
        return 0
    print("Не отправлено:", result["error"])
    print("Что сделать:", result["hint"])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
