"""«Забыли пароль?» — ссылка на почту (06.10.2026).

Как устроено
------------
Ссылка из письма — тот же одноразовый инвайт, что админ выдаёт кнопкой
«Ссылка для входа» (`services/invites.py`): человек открывает `/invite/<token>`,
задаёт пароль сам и сразу попадает в кабинет. Отдельной таблицы токенов не
заводим — у инвайта уже есть хеш вместо токена, срок, одноразовость и
«новая ссылка гасит старую».

Куда уходит письмо
------------------
На основную почту аккаунта (её человек указал в заявке или её внёс куратор) и
на каждый подтверждённый дополнительный адрес — обычно привязанный Gmail.
Человек, потерявший доступ к одному ящику, получит ссылку во второй.

Чего не делаем
--------------
* **Неактивным не шлём.** `accept_invite` ставит `is_active=True`; ссылка
  ждущему одобрения открыла бы аккаунт мимо решения админа (та же причина,
  что в `create_login_link`).
* **Не говорим, есть ли такая почта.** Ответ ручки одинаковый в любом случае,
  иначе форма превращается в проверку «зарегистрирован ли этот человек».
"""
from __future__ import annotations

import html
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User
from app.services.invites import invite_url, issue_invite
from app.services.user_emails import list_extra_emails, resolve_user_by_email


@dataclass(frozen=True)
class ResetLetter:
    user: User
    recipients: list[str]
    url: str
    subject: str
    text: str
    html: str


def reset_url(raw_token: str) -> str:
    # ?reset=1 меняет только тексты страницы («Новый пароль» вместо «Активация»).
    return f"{invite_url(raw_token)}?reset=1"


def _hours_label(hours: int) -> str:
    if hours % 10 == 1 and hours % 100 != 11:
        return f"{hours} час"
    if hours % 10 in (2, 3, 4) and hours % 100 not in (12, 13, 14):
        return f"{hours} часа"
    return f"{hours} часов"


def compose_letter(*, name: str, url: str, ttl_hours: int) -> tuple[str, str, str]:
    """Тема, текст и html письма. Без картинок и сокращателей — их режут фильтры."""
    subject = "TeenTechEd: ссылка для нового пароля"
    greeting = f"Здравствуйте, {name}!" if name else "Здравствуйте!"
    ttl = _hours_label(ttl_hours)
    text = (
        f"{greeting}\n\n"
        "Кто-то (скорее всего, вы) запросил сброс пароля в системе TeenTechEd.\n"
        "Чтобы задать новый пароль, откройте ссылку:\n\n"
        f"{url}\n\n"
        f"Ссылка одноразовая и действует {ttl}. Старый пароль перестанет работать, "
        "как только вы зададите новый.\n\n"
        "Если вы не запрашивали сброс — просто проигнорируйте это письмо, пароль останется прежним.\n\n"
        "Если письмо попало в «Спам», отметьте его как «Не спам» — тогда следующие "
        "письма от TeenTechEd будут приходить во «Входящие».\n\n"
        "— Команда TeenTechEd"
    )
    safe_name = html.escape(name) if name else ""
    safe_url = html.escape(url, quote=True)
    body = f"""<!doctype html>
<html lang="ru"><body style="margin:0;padding:24px;background:#f6f6f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<tr><td>
<p style="margin:0 0 16px;font-size:16px">{"Здравствуйте, " + safe_name + "!" if safe_name else "Здравствуйте!"}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">Кто-то (скорее всего, вы) запросил сброс пароля в системе TeenTechEd. Чтобы задать новый пароль, нажмите на кнопку:</p>
<p style="margin:0 0 20px"><a href="{safe_url}" style="display:inline-block;background:#FFD400;color:#000000;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Задать новый пароль</a></p>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#555555">Если кнопка не открывается, скопируйте ссылку в браузер:<br><a href="{safe_url}" style="color:#555555;word-break:break-all">{safe_url}</a></p>
<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#555555">Ссылка одноразовая и действует {ttl}. Если вы не запрашивали сброс — проигнорируйте письмо, пароль останется прежним.</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#555555">Письмо попало в «Спам»? Отметьте его как «Не спам» — следующие письма будут приходить во «Входящие».</p>
</td></tr></table>
<p style="text-align:center;font-size:12px;color:#888888;margin-top:16px">TeenTechEd</p>
</body></html>"""
    return subject, text, body


async def prepare_reset(db: AsyncSession, email: str, *, ttl_hours: int | None = None) -> ResetLetter | None:
    """Выпустить ссылку и собрать письмо. None — писать некому (адреса нет или
    аккаунт не активен); вызывающий отвечает одинаково в обоих случаях.

    Не коммитит: ссылка должна попасть в БД до отправки письма.
    """
    user = await resolve_user_by_email(db, email)
    if user is None or not user.is_active:
        return None

    ttl = ttl_hours or settings.PASSWORD_RESET_TTL_HOURS
    _, raw_token, _ = await issue_invite(db, user_id=user.id, student_id=None, created_by=None, ttl_hours=ttl)

    recipients = [user.email] + [ue.email for ue in await list_extra_emails(db, user.id) if ue.is_verified]
    recipients = list(dict.fromkeys(addr.strip().lower() for addr in recipients if addr))

    url = reset_url(raw_token)
    subject, text, body = compose_letter(name=user.name or "", url=url, ttl_hours=ttl)
    return ResetLetter(user=user, recipients=recipients, url=url, subject=subject, text=text, html=body)
