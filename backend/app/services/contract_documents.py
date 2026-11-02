"""Read contract PDFs without replacing absent dates with upload timestamps."""
import re
import shutil
import subprocess
import tempfile
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader


def signing_date(info):
    """Only explicit signing fields; createdAt is never signing evidence."""
    def valid(value):
        if not isinstance(value, str):
            return None
        try:
            if len(value) == 10:
                return date.fromisoformat(value).isoformat()
            timestamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if timestamp.tzinfo:
                timestamp = timestamp.astimezone(ZoneInfo('Asia/Almaty'))
            return timestamp.date().isoformat()
        except ValueError:
            return None
    for key in ('signed_at', 'signedAt', 'signed_date', 'signedDate', 'date_sign'):
        if info.get('contract_status', info.get('contractStatus')) == 3:
            value = valid(info.get(key))
            if value:
                return value
    parties = info.get('doc_parties') or info.get('signers') or []
    dates = []
    for party in parties:
        if not isinstance(party, dict) or party.get('signed') is not True:
            return None
        value = next((valid(party.get(k)) for k in ('signed_at','signedAt','signed_date','signedDate','date_sign') if valid(party.get(k))), None)
        if not value:
            return None
        dates.append(value)
    return max(dates) if len(dates) >= 2 else None


def read_pages(content, *, ocr=True):
    if not content.startswith(b'%PDF-'):
        raise ValueError('Загрузите файл PDF')
    reader = PdfReader(BytesIO(content))
    if reader.is_encrypted or not 1 <= len(reader.pages) <= 80:
        raise ValueError('Нужен PDF без пароля, не более 80 страниц')
    pages = [{'page': i+1, 'text': (page.extract_text() or '')[:12000]} for i, page in enumerate(reader.pages)]
    scanned = [p for p in pages if len(re.sub(r'\W', '', p['text'])) < 30]
    # Bounded OCR; originals remain available and missing fields are editable.
    for page in scanned:
        page['ocr_skipped'] = True
    if ocr and scanned and shutil.which('pdftoppm') and shutil.which('tesseract'):
        with tempfile.TemporaryDirectory(prefix='contract-ocr-') as tmp:
            pdf = Path(tmp) / 'document.pdf'
            pdf.write_bytes(content)
            started = time.monotonic()
            selected = scanned if len(scanned) <= 20 else scanned[:10] + scanned[-10:]
            for page in selected:
                if time.monotonic() - started > 45:
                    break
                prefix = str(Path(tmp) / f"page-{page['page']}")
                try:
                    subprocess.run(['pdftoppm','-f',str(page['page']),'-l',str(page['page']),'-scale-to','1800','-singlefile','-png',str(pdf),prefix], check=True, capture_output=True, timeout=10)
                    result = subprocess.run(['tesseract',prefix+'.png','stdout','-l','rus+kaz+eng'], check=True, capture_output=True, timeout=15)
                    page['text'] = result.stdout.decode('utf-8', errors='replace')[:12000]
                    page['ocr'] = True
                    page.pop('ocr_skipped', None)
                except (subprocess.SubprocessError, OSError):
                    continue
    return pages


def preserve_manual(profile, previous):
    if previous and previous.get('fingerprint') == profile.get('fingerprint'):
        known = {item['id'] for item in profile.get('services',[])}
        profile.setdefault('services',[]).extend(item for item in previous.get('services',[]) if item.get('verbatim_manual') and item['id'] not in known)
    for key, source in (previous or {}).get('sources', {}).items():
        if source.get('kind') == 'manual' and key in previous.get('fields', {}):
            profile['fields'][key] = previous['fields'][key]
            profile['sources'][key] = source
            profile['conflicts'].pop(key, None)
    profile['missing'] = [key for key in profile['missing'] if not profile['fields'].get(key)]
    return profile


def document_signing_date(pages):
    """Accept a labelled signing date, never an unlabelled header date."""
    found = set()
    for page in pages:
        for match in re.finditer(r'(?:Дата\s+подписания(?:\s+договора)?|Signing\s+date)\s*[:—-]?\s*(\d{1,2}[./]\d{1,2}[./]20\d{2}|20\d{2}-\d{2}-\d{2})', page['text'], re.I):
            value = match.group(1)
            try:
                if '-' in value:
                    parsed = date.fromisoformat(value)
                else:
                    d, m, y = re.split(r'[./]', value)
                    parsed = date(int(y), int(m), int(d))
                found.add(parsed.isoformat())
            except ValueError:
                continue
    return next(iter(found)) if len(found) == 1 else None


def apply_document_signing_date(link, pages):
    if not getattr(link, 'signed_date', None) and link.status == 3:
        value = document_signing_date(pages)
        if value:
            link.signed_date = value
            link.signed_date_source = 'pdf'
