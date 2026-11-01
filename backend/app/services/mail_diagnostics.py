"""Проверка почты: тестовое письмо и понятное объяснение ошибки.

«Ошибка входа» у Google Workspace почти всегда одна из нескольких причин, и
по коду ответа SMTP её можно назвать прямо, а не показывать «535 5.7.8».
"""
from __future__ import annotations

import smtplib
import socket

from app.core.config import settings
from app.services import mailer

_APP_PASSWORD_HINT = (
    "Google не принял логин или пароль. Нужен пароль приложения (16 символов), а не обычный пароль ящика: "
    "включите двухэтапную проверку на ящике-отправителе, создайте пароль на myaccount.google.com/apppasswords "
    "и впишите его в SMTP_PASSWORD без пробелов и кавычек. SMTP_USERNAME — полный адрес (name@teenteched.kz). "
    "Если пароли приложений запрещены администратором, используйте SMTP-релей: SMTP_HOST=smtp-relay.gmail.com, "
    "SMTP_USERNAME и SMTP_PASSWORD пустые, IP сервера добавлен в консоли Google (Gmail → Маршрутизация → SMTP-ретрансляция)."
)


def settings_summary() -> dict:
    """Что сейчас в настройках — без пароля."""
    return {
        "host": settings.SMTP_HOST or None,
        "port": settings.SMTP_PORT,
        "ssl": settings.SMTP_USE_SSL or settings.SMTP_PORT == 465,
        "username": settings.SMTP_USERNAME or None,
        "password_set": bool(settings.SMTP_PASSWORD),
        "password_length": len(settings.SMTP_PASSWORD.replace(" ", "")) if settings.SMTP_PASSWORD else 0,
        "from": settings.SMTP_FROM or settings.SMTP_USERNAME or None,
    }


def explain(error: BaseException) -> str:
    """Человеческое объяснение ошибки отправки."""
    if isinstance(error, mailer.MailNotConfigured):
        return "Почта не настроена: заполните SMTP_HOST и SMTP_FROM в .env на сервере и перезапустите backend и worker."
    if isinstance(error, smtplib.SMTPAuthenticationError):
        if settings.SMTP_PASSWORD and " " in settings.SMTP_PASSWORD.strip():
            return "В SMTP_PASSWORD есть пробелы — Google показывает пароль приложения группами, вписывать нужно слитно. " + _APP_PASSWORD_HINT
        return _APP_PASSWORD_HINT
    if isinstance(error, smtplib.SMTPSenderRefused):
        return ("Сервер не принял адрес отправителя. SMTP_FROM должен совпадать с SMTP_USERNAME или быть его "
                "псевдонимом в Google; для релея — адресом в вашем домене.")
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return "Сервер отказался доставить письмо на этот адрес — проверьте адрес получателя."
    if isinstance(error, smtplib.SMTPNotSupportedError):
        return "Сервер не поддерживает шифрование на этом порту: для 587 — SMTP_STARTTLS=true, для 465 — SMTP_USE_SSL=true."
    if isinstance(error, (socket.timeout, TimeoutError, ConnectionRefusedError, socket.gaierror, OSError)):
        return (f"Не удалось подключиться к {settings.SMTP_HOST}:{settings.SMTP_PORT}. Проверьте адрес и порт "
                "(Google: smtp.gmail.com или smtp-relay.gmail.com, порт 587) и что хостинг не закрывает исходящий порт.")
    return f"Ошибка отправки: {error}"


async def send_test(to: str) -> dict:
    """Отправить тестовое письмо. Возвращает {"ok": True} или {"ok": False, "error", "hint"}."""
    try:
        await mailer.send_mail(
            to=[to],
            subject="TeenTechEd: проверка почты",
            text="Если вы читаете это письмо, почта платформы настроена правильно. "
                 "Уведомления раздела «Финансы» будут приходить на этот адрес.",
        )
    except Exception as error:  # noqa: BLE001 — любую ошибку переводим в подсказку
        return {"ok": False, "error": f"{type(error).__name__}: {error}", "hint": explain(error),
                "settings": settings_summary()}
    return {"ok": True, "settings": settings_summary()}
