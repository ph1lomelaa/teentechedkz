"""Automatic, bounded matching against the student named inside a contract."""
from collections import Counter
import re
import unicodedata

_TRANSLATE = str.maketrans('әғқңөұүһіёə', 'агкноуухиеа')


def name_key(value):
    value = unicodedata.normalize('NFKC', value or '').casefold().translate(_TRANSLATE)
    return tuple(sorted(re.findall(r'[^\W\d_]+', value, re.UNICODE)))


def phone_key(value):
    digits = re.sub(r'\D', '', value or '')
    return digits[-10:] if 10 <= len(digits) <= 11 else ''


def phone_keys(value):
    """A card may contain several phones and comments such as '(мама)'."""
    direct = phone_key(value)
    return ({direct} if direct else set()) | phones_in_pages([{'text': value or ''}])


def role_phones(pages, role):
    label = r'(?:абитуриента|студента|обучающегося|участника|учащегося)' if role == 'student' else r'(?:подписанта|заказчика|родителя)'
    found = set()
    for page in pages:
        text = re.sub(r'\s+', ' ', page['text'])
        for match in re.finditer(r'(?:Номер\s+)?(?:мобильного\s+)?телефон(?:а)?\s+' + label + r'\s*:\s*([+\d][\d\s()+,;.-]{8,100})', text, re.I):
            found |= phone_keys(match.group(1))
    return found


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


def _single(word):
    """Удвоенные буквы не различают: «Джаппарова» = «Джапарова»."""
    return re.sub(r'(.)\1+', r'\1', word)


def _same_word(a, b):
    a, b = _stem(_single(a)), _stem(_single(b))
    if a == b:
        return True
    # Беглая гласная: Павел / Павлом → «павел» / «павл».
    long, short = (a, b) if len(a) > len(b) else (b, a)
    return len(short) >= 4 and len(long) == len(short) + 1 and any(
        long[i] in _VOWELS and long[:i] + long[i + 1:] == short for i in range(1, len(long)))


def _edit1(a, b):
    if min(len(a), len(b)) < 5 or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) <= 1
    long, short = (a, b) if len(a) > len(b) else (b, a)
    return any(long[:i] + long[i + 1:] == short for i in range(len(long)))


def _one_typo(a, b):
    """Слова от 5 букв, отличающиеся одной вставкой, пропуском или заменой."""
    return _edit1(a, b) or _edit1(_single(a), _single(b))


def fuzzy_overlap(a, b):
    """Как name_overlap, но слово с одной опечаткой считается совпавшим. Только для подсказок."""
    rest, hits = _words(b), 0
    for word in _words(a):
        for i, other in enumerate(rest):
            if _same_word(word, other) or _one_typo(word, other):
                hits += 1
                del rest[i]
                break
    return hits


def name_overlap(a, b):
    rest, hits = _words(b), 0
    for word in _words(a):
        for i, other in enumerate(rest):
            if _same_word(word, other):
                hits += 1
                del rest[i]
                break
    return hits


_ROMAN = dict(zip('абвгдезийклмнопрстуфхыэ', ('a','b','v','g','d','e','z','i','i','k','l','m','n','o','p','r','s','t','u','f','h','y','e')))
_ROMAN.update({'ж':'zh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ю':'yu','я':'ya','ь':'','ъ':''})


def _roman_word(word):
    word = ''.join(_ROMAN.get(c,c) for c in _single(_stem(word)))
    # Latin spelling retains vowels stripped as case endings in Cyrillic.
    return word[:-1] if len(word) >= 5 and word.endswith(('a','y','i','u')) else word


def transliterated_person(a, b):
    left, right = _words(a), _words(b)
    if not (re.search('[а-я]', a, re.I) and re.search('[a-z]', b, re.I) or re.search('[a-z]', a, re.I) and re.search('[а-я]', b, re.I)):
        return False
    short, long = (left,right) if len(left) <= len(right) else (right,left)
    remaining = [_roman_word(w) for w in long]
    if len(short) < 2: return False
    for word in short:
        key = _roman_word(word)
        if key not in remaining: return False
        remaining.remove(key)
    return True


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
    card_phones = set().union(*(phone_keys(p) for p in (student.phone, *extra_phones)))
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
