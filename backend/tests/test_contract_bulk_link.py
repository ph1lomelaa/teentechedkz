import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from contract_bulk_link import pick_student  # noqa: E402


def student(name, phone='', sid=None):
    return SimpleNamespace(id=sid or name, full_name=name, phone=phone)


def profile(student_name=None, customer_name=None):
    fields = {k: v for k, v in (('student_name', student_name), ('customer_name', customer_name)) if v}
    return {'fields': fields, 'sources': {k: {'kind': 'pdf'} for k in fields}}


PERIZAT = student('Атанчаева Перизат Болатбековна', '+77010000001')
SISTER = student('Атанчаева Дина Болатбековна', '+77010000002')
STUDENTS = [PERIZAT, SISTER, student('Жолдас Нұрай Бекболатқызы')]
NAMES = [s.full_name for s in STUDENTS]


def pick(prof, pages=(), guardians=None):
    return pick_student(prof, list(pages), STUDENTS, guardians or {}, NAMES)


def test_student_named_in_genitive_by_parent_is_linked_to_the_right_card():
    decision, found, _ = pick(profile('Атанчаевой Перизат Болатбековны', 'Исмайлова Меруерт Абдиманасовна'))
    assert decision == 'link' and found is PERIZAT


def test_sibling_card_is_never_chosen_for_another_child():
    decision, found, _ = pick(profile('Атанчаева Перизат Болатбековна'))
    assert found is PERIZAT
    assert pick(profile('Атанчаева Айым Болатбековна'))[0] == 'none'


def test_parent_phone_in_pdf_supports_a_two_word_card_name():
    short = student('Жансая Қырқымбай', '')
    students = [short]
    pages = [{'text': 'Номер телефона: +7 701 555 44 33'}]
    prof = profile(customer_name='Қырқымбай Жансая Мейрамбекқызы')
    assert pick_student(prof, pages, students, {}, [short.full_name])[0] == 'review'
    assert pick_student(prof, pages, students, {short.id: ['87015554433']}, [short.full_name])[:2] == ('link', short)


def test_unknown_or_missing_student_is_not_linked():
    assert pick(profile('Неизвестный Человек Иванович'))[0] == 'none'
    assert pick(profile())[0] == 'none'


def test_duplicate_cards_go_to_review_instead_of_guessing():
    twin = student('Атанчаева Перизат Болатбековна', sid='twin')
    students = [PERIZAT, twin]
    decision, found, _ = pick_student(profile('Атанчаева Перизат Болатбековна'), [], students, {}, [s.full_name for s in students])
    assert decision == 'review' and {s.id for s in found} == {PERIZAT.id, 'twin'}
