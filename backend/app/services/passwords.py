"""Генерация временных паролей, которые человек читает глазами и вводит руками.

Почты в системе нет, поэтому временный пароль всегда проходит через человека:
сотрудник видит его один раз на экране и передаёт владельцу аккаунта. Отсюда
требование к алфавиту — ни одного символа, который можно спутать с другим при
чтении вслух или переписывании.
"""
from __future__ import annotations

import secrets

# Без O/0 и I/l/1 — именно на них ломается «продиктуй пароль по телефону».
PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"


def gen_password(length: int = 10) -> str:
    return "".join(secrets.choice(PW_ALPHABET) for _ in range(length))
