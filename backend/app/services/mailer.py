"""Отправка писем через SMTP — единственное место, где система пишет на почту.

Зачем отдельный модуль
----------------------
До 06.10.2026 почты в системе не было вовсе, и всё, что связано с забытым
паролем, держалось на том, что кто-то из команды передаст ссылку руками.
Первое письмо — ссылка для сброса пароля, но модуль не знает, о чём письмо:
ему дают адресатов, тему и два варианта текста.

Почему stdlib, а не aiosmtplib
------------------------------
Писем мало (единицы в день), а `smtplib` есть всегда. Блокирующий вызов
уносим в поток (`asyncio.to_thread`), чтобы не держать event loop.

Против спама
------------
Попадёт ли письмо во «Входящие», решают в основном SPF/DKIM/DMARC домена
отправителя — это настройка почты компании, а не кода (см. docs/SETUP.md →
«Почта для сброса пароля»). Со своей стороны делаем то, что фильтры проверяют
в самом письме: обе версии (text + html), корректные Date и Message-ID с
доменом отправителя, From совпадает с учёткой SMTP, без вложений и сокращённых
ссылок.
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr

from app.core.config import settings

logger = logging.getLogger(__name__)


class MailNotConfigured(Exception):
    """SMTP не настроен — письма в этой установке не отправляются."""


def is_configured() -> bool:
    return bool(settings.SMTP_HOST and _from_address())


def _from_address() -> str:
    return (settings.SMTP_FROM or settings.SMTP_USERNAME or "").strip()


def build_message(*, to: str, subject: str, text: str, html: str | None = None) -> EmailMessage:
    """Собрать письмо. Отдельно от отправки, чтобы заголовки проверялись тестом."""
    sender = _from_address()
    domain = parseaddr(sender)[1].rpartition("@")[2] or None

    msg = EmailMessage()
    msg["From"] = formataddr((settings.SMTP_FROM_NAME, sender)) if settings.SMTP_FROM_NAME else sender
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=False, usegmt=True)
    msg["Message-ID"] = make_msgid(domain=domain)
    if settings.SMTP_REPLY_TO:
        msg["Reply-To"] = settings.SMTP_REPLY_TO
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    return msg


def _send_sync(messages: list[EmailMessage]) -> None:
    host, port = settings.SMTP_HOST, settings.SMTP_PORT
    timeout = 20
    context = ssl.create_default_context()
    # 465 — SSL с первого байта, остальные порты (587) — STARTTLS.
    # Имя для EHLO задаём сами: иначе smtplib зовёт socket.getfqdn(), который
    # без обратной DNS-записи висит десятки секунд.
    helo = parseaddr(_from_address())[1].rpartition("@")[2] or "localhost"
    if settings.SMTP_USE_SSL or port == 465:
        server: smtplib.SMTP = smtplib.SMTP_SSL(host, port, local_hostname=helo, timeout=timeout, context=context)
    else:
        server = smtplib.SMTP(host, port, local_hostname=helo, timeout=timeout)
    with server:
        if not isinstance(server, smtplib.SMTP_SSL) and settings.SMTP_STARTTLS:
            server.starttls(context=context)
        if settings.SMTP_USERNAME:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        for msg in messages:
            server.send_message(msg)


async def send_mail(*, to: list[str], subject: str, text: str, html: str | None = None) -> None:
    """Отправить одно и то же письмо каждому адресату отдельно.

    Отдельно, а не одним письмом с несколькими To: адреса одного человека
    (рабочий и Gmail) не должны видеть друг друга в заголовках.
    """
    if not is_configured():
        raise MailNotConfigured("Почта не настроена")
    recipients = list(dict.fromkeys(addr.strip().lower() for addr in to if addr and addr.strip()))
    if not recipients:
        return
    messages = [build_message(to=addr, subject=subject, text=text, html=html) for addr in recipients]
    await asyncio.to_thread(_send_sync, messages)
