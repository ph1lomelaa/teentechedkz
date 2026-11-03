import unittest
from types import SimpleNamespace
from decimal import Decimal
from pydantic import ValidationError
from app.services.contract_profile import extract_profile, store_profile, cached_profile
from app.services.act_pdf import amount_words
from app.schemas.service_act import ActInput, ActDraftInput
from test_service_acts import payload


def pages(text):
    return [{'page':1,'text':text}]


INTRO = '''ДОГОВОР № 671 г. Алматы «28» июля 2026 г. Настоящий договор заключён между
Товариществом с ограниченной ответственностью «Тестовая компания», в лице директора
Тест Директор, действующего на основании Устава, с одной стороны, и Тест Әлия Нұрланқызы,
индивидуальный идентификационный номер (ИИН) 000000000000, именуемая «Заказчик»
и одновременно являющаяся «Абитуриентом». Стоимость IELTS составляет 90 000 тенге.'''


class ContractProfileTests(unittest.TestCase):
    def test_header_date_is_not_misread_as_city_and_self_customer_is_explicit(self):
        p = extract_profile(pages(INTRO),{},b'pdf')
        self.assertEqual(p['fields']['city'],'Алматы')
        self.assertEqual(p['fields']['contract_number'],'671')
        self.assertEqual(p['fields']['contract_date'],'2026-07-28')
        self.assertEqual(p['fields']['customer_name'],'Тест Әлия Нұрланқызы')
        self.assertEqual(p['fields']['student_name'],p['fields']['customer_name'])
        self.assertEqual(p['fields']['executor_representative'],'директора Тест Директор')
        self.assertEqual(p['service_hints']['ielts']['confirmed_price']['amount'],'90000')
        self.assertEqual(p['missing'],[])
        self.assertEqual(p['sources']['student_name']['page'],1)

    def test_parent_does_not_become_student_and_conflicting_names_are_not_guessed(self):
        text = INTRO.replace('и одновременно являющаяся «Абитуриентом»','в интересах ребёнка')
        p = extract_profile(pages(text),{},b'pdf')
        self.assertNotIn('student_name',p['fields'])
        text += ' Подписант / законный представитель: Бекенов Ерлан Абитуриент: Тест Ребёнок ИИН абитуриента: 111111111111'
        p = extract_profile(pages(text),{},b'pdf')
        self.assertNotIn('customer_name',p['fields'])
        self.assertIn('customer_name',p['conflicts'])
        self.assertEqual(p['fields']['student_name'],'Тест Ребёнок')

    def test_total_contract_price_is_never_assigned_to_a_service(self):
        text = INTRO.replace('Стоимость IELTS составляет 90 000 тенге','Общая стоимость договора 1 400 000 тенге. Включает IELTS и портфолио.')
        p = extract_profile(pages(text),{},b'pdf')
        self.assertIsNone(p['service_hints']['ielts']['confirmed_price'])
        self.assertIsNone(p['service_hints']['portfolio']['confirmed_price'])

    def test_company_signatory_does_not_replace_the_legal_director(self):
        info = {'doc_parties':[{'isCreator':True,'requisites':'[{"key":"fio","value":"Другой Сотрудник"}]'}]}
        p = extract_profile(pages(INTRO),info,b'pdf')
        self.assertEqual(p['fields']['executor_representative'],'директора Тест Директор')

    def test_profile_is_encrypted_and_round_trips(self):
        link = SimpleNamespace(profile_encrypted=None)
        p = extract_profile(pages(INTRO),{},b'pdf')
        store_profile(link,p)
        self.assertNotIn('000000000000',link.profile_encrypted)
        self.assertNotIn('Әлия',link.profile_encrypted)
        self.assertEqual(cached_profile(link),p)
        link.profile_encrypted = 'invalid'
        self.assertIsNone(cached_profile(link))

    def test_incomplete_draft_is_saveable_but_not_a_generatable_act(self):
        data = {'contract_link_id':payload()['contract_link_id'],'contract_date':'','period_start':'','lines':[{'name':'','result':''}]}
        draft = ActDraftInput(**data)
        self.assertIsNone(draft.contract_date)
        with self.assertRaises(ValidationError):
            ActInput.model_validate(draft.model_dump())

    def test_amount_words(self):
        self.assertEqual(amount_words(Decimal('200000')),'двести тысяч')
        self.assertEqual(amount_words(Decimal('90000')),'девяносто тысяч')
        self.assertEqual(amount_words(Decimal('21001.45')),'двадцать одна тысяча один 45/100')

class ApplicantLabelTests(unittest.TestCase):
    def test_full_name_label_and_glued_colon_are_supported(self):
        p=extract_profile(pages('Реквизиты Заказчика: ФИО подписанта: Тест Родитель. ФИО абитуриента:Тест Амина Есимовна ИИН подписанта: 000000000000 ИИН абитуриента: 000000000001'),{},b'test')
        self.assertEqual(p['fields']['student_name'],'Тест Амина Есимовна')

    def test_current_template_names_child_after_in_interests(self):
        text='Заказчик, действующая в качестве законного представителя и в интересах Тест Әбілқайыр, индивидуальный идентификационный номер (ИИН) 000000000001, именуемого в дальнейшем «Абитуриент»'
        p=extract_profile(pages(text),{},b'test')
        self.assertEqual(p['fields']['student_name'],'Тест Әбілқайыр')
        self.assertEqual(p['fields']['student_id_number'],'000000000001')

    def test_old_template_uses_uchashchiysya_label(self):
        p=extract_profile(pages('1.3. Учащийся: Тест Кристина Александровна. 2. Права и обязанности Сторон'),{},b'test')
        self.assertEqual(p['fields']['student_name'],'Тест Кристина Александровна')

    def test_service_outcome_heading_does_not_conflict_with_applicant(self):
        p=extract_profile(pages('Абитуриент: Тест Алинур Даулетулы ИИН абитуриента: 000000000001. Что получает абитуриент: ✅Осознанность в выборе академического трека. Понимание направлений.'),{},b'test')
        self.assertEqual(p['fields']['student_name'],'Тест Алинур Даулетулы')
        self.assertNotIn('student_name',p['conflicts'])

    def test_camp_participant_and_intern_labels(self):
        for label in ['ФИО Участника','Стажирующийся','ФИО (стажирующегося)']:
            p=extract_profile(pages(f'{label}: Тест Арлан Телефон номер: +77000000000 ИИН Участника: 000000000001'),{},b'test')
            self.assertEqual(p['fields']['student_name'],'Тест Арлан')
            self.assertEqual(p['fields']['student_id_number'],'000000000001')

    def test_unnamed_minor_role_before_iin_names_participant(self):
        p=extract_profile(pages('в качестве законного представителя несовершеннолетнего Тест Алидар ИИН 000000000001, именуемого в дальнейшем «Участник»'),{},b'test')
        self.assertEqual(p['fields']['student_name'],'Тест Алидар')
