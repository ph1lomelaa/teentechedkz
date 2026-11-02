"""Какой карточке платформы принадлежит договор TrustMe.

Общие правила для массовой привязки, фоновой синхронизации и перепроверки
непривязанных договоров. Привязка — только при однозначном совпадении.
"""
import re

from app.services.contract_discovery import _same_word, _words, match_student, name_overlap, phone_key, phones_in_pages, same_person


def _phones(student, guardians):
    return ({phone_key(student.phone)} | {phone_key(g.phone) for g in guardians}) - {''}


def _close_names(a, b):
    """Каждое слово короткого ФИО есть в другом хотя бы по первым трём буквам:
    «Бақдаулет» / «Бакдаулет» — да, сёстры «Айым» / «Перизат» — нет."""
    left, right = _words(a), _words(b)
    short, long = (left, right) if len(left) <= len(right) else (right, left)
    return len(short) >= 2 and all(any(w[:3] == o[:3] for o in long) for w in short)


def _title_names(title, student):
    """Название договора называет студента: хотя бы одно слово ФИО карточки."""
    return any(name_overlap(word, title) for word in student.full_name.split() if len(word) >= 3)


_PATRONYMIC = ('овна', 'евна', 'ична', 'инична', 'ович', 'евич', 'ич', 'улы', 'ұлы', 'кызы', 'қызы')


def _patronymic_base(word):
    for suffix in sorted(_PATRONYMIC, key=len, reverse=True):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[:-len(suffix)]
    return None


def _child_of(customer, student, title):
    """Заказчик — родитель студента: общая фамилия (Себиева = Себиев) и второе
    подтверждение — отчество студента от имени заказчика (Руслан → Руслановна)
    или имя студента в названии договора."""
    parent, child = _words(customer), _words(student.full_name)
    if len(parent) < 2 or len(child) < 2:
        return False
    from_parent = lambda c: bool(_patronymic_base(c)) and any(_same_word(_patronymic_base(c), p) for p in parent)
    shared = [c for c in child if any(_same_word(c, p) for p in parent)]
    if not shared and any(from_parent(c) for c in child):
        # Казахские имена: фамилия сына — от деда («Оралбай» / «Оралбаевич»),
        # поэтому вместе с отчеством хватает общего корня из 5 букв.
        shared = [c for c in child if not from_parent(c) and any(len(c) >= 5 and p[:5] == c[:5] for p in parent)]
    if len(shared) != 1:
        return False
    rest = [c for c in child if c not in shared]
    by_patronymic = any(from_parent(c) for c in rest)
    by_title = any(len(c) >= 3 and name_overlap(c, title) for c in rest if not _patronymic_base(c))
    return by_patronymic or by_title


# Причины «на проверку», которые снимает дополнительное доказательство: полное
# ФИО (3 слова) у подписанта с ЭЦП или упоминание студента в названии договора.
_NAME_ONLY = {'ФИО требует проверки по оригиналу PDF',
              'Нужно подтвердить принадлежность: неполное ФИО без совпадения телефона',
              'Заказчик совпадает со студентом — подтвердите, что договор его'}


def pick_student(profile, pages, students, guardians, all_names, title=''):
    """('link', student, причина) | ('review', [студенты], причина) | ('none', [], причина).

    guardians — {student_id: [родитель с .full_name/.phone/.iin]}."""
    fields = profile.get('fields', {})
    named = fields.get('student_name') or fields.get('customer_name') or ''
    in_pdf = phones_in_pages(pages)
    customer_iin = re.sub(r'\D', '', fields.get('customer_id') or '')
    family = {}
    for s in students:
        own = guardians.get(s.id, ())
        why = (['телефон'] if in_pdf & _phones(s, own) else []) + \
              (['ИИН родителя'] if len(customer_iin) == 12 and any(g.iin == customer_iin for g in own) else [])
        if why:
            family[s.id] = (s, why)
    candidates = [s for s in students if (named and same_person(named, s.full_name)) or s.id in family]
    results = [(s, *match_student(s, profile, pages, all_names, [g.phone for g in guardians.get(s.id, ())])) for s in candidates]
    confirmed = [s for s, outcome, _ in results if outcome == 'confirmed']
    if len(confirmed) == 1:
        return 'link', confirmed[0], 'Студент однозначно указан в договоре'
    if len(confirmed) > 1:
        return 'review', confirmed, 'Договору подходят несколько карточек'
    # 2. Имя совпало, но не хватало подтверждения: полное ФИО или название договора.
    backed = [s for s, outcome, reason in results if outcome == 'review' and reason in _NAME_ONLY
              and (name_overlap(named, s.full_name) >= 3 or _title_names(title, s))]
    if len(backed) == 1:
        return 'link', backed[0], 'ФИО в договоре + полное ФИО или название договора'
    # 3. Семья из карточки: телефон или ИИН родителя есть в договоре, и подходит одна
    # карточка. Если в договоре назван студент — имя и фамилия должны совпасть,
    # иначе это может быть брат или сестра с тем же телефоном родителя.
    student_in_pdf = fields.get('student_name') or ''
    if len(family) == 1:
        s, why = next(iter(family.values()))
        if not student_in_pdf or _close_names(student_in_pdf, s.full_name):
            if sum(same_person(n, s.full_name) for n in all_names) == 1:
                return 'link', s, f'В договоре {" и ".join(why)} из карточки'
    # 4. Заказчик — родитель, студент в договоре не назван.
    customer = fields.get('customer_name') or ''
    if customer and not student_in_pdf and not candidates:
        children = [s for s in students if _child_of(customer, s, title)]
        if len(children) == 1 and sum(same_person(n, children[0].full_name) for n in all_names) == 1:
            return 'link', children[0], 'Заказчик — родитель: фамилия и отчество или имя в названии договора'
    review = [(s, reason) for s, outcome, reason in results if outcome == 'review']
    if review:
        return 'review', [s for s, _ in review], review[0][1]
    if not named:
        return 'none', [], 'В PDF не найден абитуриент'
    return 'none', [], 'Студента из договора нет среди карточек платформы'
