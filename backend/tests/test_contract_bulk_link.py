import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from app.services.contract_matching import pick_student  # noqa: E402


def student(name, phone='', sid=None):
    return SimpleNamespace(id=sid or name, full_name=name, phone=phone)


def profile(student_name=None, customer_name=None, customer_id=None, kind='pdf'):
    fields = {k: v for k, v in (('student_name', student_name), ('customer_name', customer_name), ('customer_id', customer_id)) if v}
    return {'fields': fields, 'sources': {k: {'kind': kind} for k in fields}}


def parent(name='Родитель Тест', phone='', iin=''):
    return SimpleNamespace(full_name=name, phone=phone, iin=iin)


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
    assert pick_student(prof, pages, students, {short.id: [parent(phone='87015554433')]}, [short.full_name])[:2] == ('link', short)


def test_unknown_or_missing_student_is_not_linked():
    assert pick(profile('Неизвестный Человек Иванович'))[0] == 'none'
    assert pick(profile())[0] == 'none'


def test_duplicate_cards_go_to_review_instead_of_guessing():
    twin = student('Атанчаева Перизат Болатбековна', sid='twin')
    students = [PERIZAT, twin]
    decision, found, _ = pick_student(profile('Атанчаева Перизат Болатбековна'), [], students, {}, [s.full_name for s in students])
    assert decision == 'review' and {s.id for s in found} == {PERIZAT.id, 'twin'}


PHONE_PAGE = [{'text': 'Заказчик: телефон +7 701 000 00 01'}]


def test_unnamed_student_is_linked_when_only_one_card_has_the_phone():
    assert pick(profile(customer_name='Исмайлова Меруерт Абдиманасовна'), PHONE_PAGE)[:2] == ('link', PERIZAT)


def test_sibling_named_in_the_contract_is_not_linked_by_the_shared_parent_phone():
    decision, found, _ = pick(profile('Атанчаева Айым Болатбековна'), PHONE_PAGE)
    assert decision != 'link'


def test_parent_iin_from_the_card_identifies_the_family():
    guardians = {PERIZAT.id: [parent(iin='870926402790')]}
    prof = profile(customer_name='Исмайлова Меруерт Абдиманасовна', customer_id='870926402790')
    assert pick(prof, [], guardians)[:2] == ('link', PERIZAT)
    shared = {PERIZAT.id: [parent(iin='870926402790')], SISTER.id: [parent(iin='870926402790')]}
    assert pick(prof, [], shared)[0] != 'link'


def test_short_card_name_is_backed_by_the_contract_title():
    ali = student('Али Жолдаспай')
    prof = profile('Жолдаспай Али')
    assert pick_student(prof, [], [ali], {}, [ali.full_name])[0] == 'review'
    assert pick_student(prof, [], [ali], {}, [ali.full_name], 'договор США Жолдаспай Али')[:2] == ('link', ali)


def test_full_name_of_an_e_signature_signer_is_enough():
    prof = profile(customer_name='Жолдас Нұрай Бекболатқызы', kind='trustme')
    assert pick(prof)[1] is STUDENTS[2]


def test_stored_facts_give_the_same_decision_as_the_pdf():
    from app.services.trustme_sync import decide_from_facts, facts_of
    prof = profile(customer_name='Исмайлова Меруерт Абдиманасовна')
    people = SimpleNamespace(students=STUDENTS, guardians={}, names=NAMES)
    facts = facts_of(prof, PHONE_PAGE)
    assert '7010000001' in facts['phones']
    assert decide_from_facts(facts, people, '')[:2] == pick(prof, PHONE_PAGE)[:2] == ('link', PERIZAT)


def test_parent_customer_is_matched_to_the_child_by_patronymic_or_title():
    kamila = student('Асаубаева Камила Руслановна')
    imana = student('Себиева Имана')
    people = [kamila, imana, student('Себиева Дана')]
    names = [s.full_name for s in people]
    assert pick_student(profile(customer_name='Асаубаев Руслан'), [], people, {}, names)[:2] == ('link', kamila)
    assert pick_student(profile(customer_name='Себиева Марха Эльсиевна'), [], people, {}, names)[0] != 'link'
    assert pick_student(profile(customer_name='Себиева Марха Эльсиевна'), [], people, {}, names,
                        'Admission_договор_Магистратура_Имана')[:2] == ('link', imana)


def test_parent_rule_does_not_fire_when_the_contract_names_another_student():
    kamila = student('Асаубаева Камила Руслановна')
    prof = profile('Асаубаева Алина Руслановна', 'Асаубаев Руслан')
    assert pick_student(prof, [], [kamila], {}, [kamila.full_name])[0] != 'link'


def test_title_or_partial_name_offers_review_candidate_without_auto_linking():
    nurai = student('Жолдас Нұрай Бекболатқызы')
    decision, found, _ = pick_student(profile(), [], [nurai], {}, [nurai.full_name],
                                      'Admission договор Жолдас Нұрай')
    assert decision == 'review' and found == [nurai]
    decision, found, _ = pick_student(profile('Жолдас Нұрай'), [], [nurai], {}, [nurai.full_name])
    assert decision == 'review' and found == [nurai]
