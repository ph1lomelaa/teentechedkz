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


# Падежные окончания: в договоре абитуриент часто в родительном или творительном
# падеже («законного представителя абитуриента Атанчаевой Перизат Болатбековны»).
_ENDINGS = sorted(('ыми', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ой', 'ей', 'ым', 'им', 'ом', 'ем',
                   'ою', 'ею', 'ую', 'юю', 'ая', 'яя', 'ы', 'и', 'а', 'я', 'у', 'ю', 'е', 'о'), key=len, reverse=True)
_VOWELS = set('аеиоуыэюяaeiouy')


def _words(value):
    value = unicodedata.normalize('NFKC', value or '').casefold().translate(_TRANSLATE)
    return re.findall(r'[^\W\d_]+', value, re.UNICODE)


def _stem(word):
    for ending in _ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= 3:
            return word[:-len(ending)]
    return word


def _same_word(a, b):
    a, b = _stem(a), _stem(b)
    if a == b:
        return True
    # Беглая гласная: Павел / Павлом → «павел» / «павл».
    long, short = (a, b) if len(a) > len(b) else (b, a)
    return len(short) >= 4 and len(long) == len(short) + 1 and any(
        long[i] in _VOWELS and long[:i] + long[i + 1:] == short for i in range(1, len(long)))


def name_overlap(a, b):
    rest, hits = _words(b), 0
    for word in _words(a):
        for i, other in enumerate(rest):
            if _same_word(word, other):
                hits += 1
                del rest[i]
                break
    return hits


def same_person(a, b):
    """Все слова более короткого ФИО (минимум два) есть в другом с учётом падежа."""
    shortest = min(len(_words(a)), len(_words(b)))
    return shortest >= 2 and name_overlap(a, b) == shortest


def match_student(student, profile, pages, all_names, extra_phones=()):
    """A signer/title alone never proves who receives the service.

    extra_phones — телефоны родителей из карточки: договор за ребёнка подписывает
    родитель, и в PDF стоит его номер."""
    fields, sources = profile.get('fields', {}), profile.get('sources', {})
    actual, source = fields.get('student_name'), sources.get('student_name', {})
    self_contract = False
    if not actual and fields.get('customer_name') and same_person(fields['customer_name'], student.full_name):
        # Абитуриент не назван отдельно, а заказчик — сам студент.
        actual, source, self_contract = fields['customer_name'], sources.get('customer_name', {}), True
    card_phones = {phone_key(p) for p in (student.phone, *extra_phones)} - {''}
    phone_in_pdf = bool(card_phones & phones_in_pages(pages))
    if not actual:
        return 'review', ('В PDF не найден абитуриент, но телефон из карточки есть в договоре' if phone_in_pdf
                          else 'В PDF не удалось однозначно определить студента')
    if not same_person(actual, student.full_name):
        if phone_in_pdf:
            return 'review', 'ФИО в договоре отличается, но телефон из карточки есть в договоре'
        return 'unrelated', 'В договоре указан другой студент'
    if sum(same_person(name, student.full_name) for name in all_names) != 1:
        return 'review', 'В базе несколько студентов с таким ФИО'
    if source.get('kind') != 'pdf':
        return 'review', 'ФИО требует проверки по оригиналу PDF'
    if self_contract and not phone_in_pdf:
        return 'review', 'Заказчик совпадает со студентом — подтвердите, что договор его'
    if name_overlap(actual, student.full_name) >= 3 or phone_in_pdf:
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
                    if any(same_person(n, field.get('value') or '') for n in names):
                        return True
        except (ValueError, TypeError, AttributeError):
            continue
    return False
