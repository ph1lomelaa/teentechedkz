"""Automatic, bounded matching against the student named inside a contract."""
from collections import Counter
import re
import unicodedata

_TRANSLATE = str.maketrans('әғқңөұүһіё', 'агкноуухие')


def name_key(value):
    value = unicodedata.normalize('NFKC', value or '').casefold().translate(_TRANSLATE)
    return tuple(sorted(re.findall(r'[^\W\d_]+', value, re.UNICODE)))


def phone_key(value):
    digits = re.sub(r'\D', '', value or '')
    return digits[-10:] if 10 <= len(digits) <= 11 else ''


def phones_in_pages(pages):
    return {phone_key(m.group()) for p in pages for m in re.finditer(r'(?<!\d)(?:\+?[78][\s().-]*)?(?:\d[\s().-]*){10}(?!\d)', p['text'])} - {''}


def match_student(student, profile, pages, all_names):
    """A signer/title alone never proves who receives the service."""
    expected = name_key(student.full_name)
    actual = name_key(profile.get('fields', {}).get('student_name'))
    if not actual:
        return 'review', 'В PDF не удалось однозначно определить студента'
    if actual != expected:
        return 'unrelated', 'В договоре указан другой студент'
    if Counter(name_key(name) for name in all_names)[expected] != 1:
        return 'review', 'В базе несколько студентов с таким ФИО'
    if profile.get('sources', {}).get('student_name', {}).get('kind') != 'pdf':
        return 'review', 'ФИО требует проверки по оригиналу PDF'
    phone = phone_key(student.phone)
    phones = phones_in_pages(pages)
    if len(expected) >= 3 or (len(expected) >= 2 and phone and phone in phones):
        return 'confirmed', 'Студент однозначно указан в тексте договора'
    return 'review', 'Нужно подтвердить принадлежность: неполное ФИО без совпадения телефона'


def likely_candidate(row, names):
    """Rank identity hits before generic partial-name results."""
    title = set(name_key(row.get('contractName', '')))
    for name in names:
        tokens = set(name_key(name))
        if len(tokens) >= 2 and len(tokens & title) >= 2:
            return True
    import json
    for signer in row.get('signers') or []:
        try:
            values = json.loads(signer.get('jsonData') or '[]')
            for field in values:
                if isinstance(field, dict) and field.get('key') in ('fio', 'name'):
                    found = name_key(field.get('value'))
                    if any(len(name_key(n)) >= 2 and name_key(n) == found for n in names):
                        return True
        except (ValueError, TypeError, AttributeError):
            continue
    return False
