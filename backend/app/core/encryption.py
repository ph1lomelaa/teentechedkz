"""Symmetric encryption for IIN and confidential notes using Fernet (AES-128-CBC + HMAC).
pgcrypto is used at DB level for at-rest encryption. This module handles
application-level encrypt/decrypt so data travels encrypted in the column.
"""
import base64
import hashlib
from cryptography.fernet import Fernet
from app.core.config import settings


def _get_fernet() -> Fernet:
    # Derive a 32-byte key from the env variable using SHA-256
    key_bytes = hashlib.sha256(settings.PGCRYPTO_KEY.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)


def encrypt(plaintext: str) -> str:
    f = _get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    f = _get_fernet()
    return f.decrypt(ciphertext.encode()).decode()


def mask_iin(iin: str) -> str:
    """Return masked IIN: ●●●●●●0512 (last 4 visible)."""
    if len(iin) < 4:
        return "●" * len(iin)
    return "●" * (len(iin) - 4) + iin[-4:]
