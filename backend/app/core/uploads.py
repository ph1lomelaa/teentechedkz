"""Безопасное чтение загружаемых файлов.

`await file.read()` тянет весь файл в память ДО любой проверки размера — прислав
многогигабайтный файл, можно посадить процесс по памяти. `read_upload_capped`
читает чанками и обрывается, как только превышен лимит, поэтому в память попадает
не больше (лимит + один чанк), а не весь запрос.
"""
from __future__ import annotations

from fastapi import HTTPException, UploadFile, status

_CHUNK = 1024 * 1024  # 1 МБ


async def read_upload_capped(file: UploadFile, max_bytes: int) -> bytes:
    """Прочитать файл целиком, но не больше max_bytes. При превышении — 413,
    не дочитывая остаток (память не растёт до размера присланного файла)."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            mb = max_bytes // (1024 * 1024)
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Файл слишком большой (макс. {mb} МБ)",
            )
        chunks.append(chunk)
    return b"".join(chunks)
