import copy
from decimal import Decimal
from types import SimpleNamespace
import unittest
from app.services.contract_services import extract_services, validate_service_lines, validate_company_signature, signature_available, normalized
from app.services.contract_profile import extract_profile
from app.schemas.service_act import ActInput
from test_service_acts import payload

PAGES = [
 {'page':1,'text':'ДОГОВОР № 671 г. Алматы «28» июля 2026 г. 1.5. Подготовка к IELTS: сроком 2 месяца. Подготовка к IELTS включает проведение учебных занятий, подготовку к Listening, Reading, Writing и Speaking. 1.6. Другие условия.'},
 {'page':2,'text':'Приложение №1 к Договору. Стоимость услуги, тенге. Оценка профиля студента 2 6 57 500 Анализ академического и личного профиля студента. В услугу входит: Анализ академических показателей и имеющихся документов студента; Предоставление рекомендаций по выбору направления обучения. Профориентация 6 3 50000 Что получает абитуриент: ✅ Осознанность в выборе академического трека. ✅ Представление о возможных карьерных перспективах.'},
]


class ProvenanceTests(unittest.TestCase):
 def profile(self): return extract_profile(PAGES,{},b'test-contract')
 def data(self):
  profile=self.profile(); service=profile['services'][0]
  line=dict(name=service['name'],result=service['text'],contract_service_id=service['id'],source_fingerprint=profile['fingerprint'],contract_source=service['reference'],unit='услуга',quantity='1')
  return profile, ActInput(**{**payload(),'include_amount':False,'lines':[line]})
 def test_every_activity_is_a_literal_contract_fragment_and_has_a_page(self):
  p=self.profile()
  self.assertEqual({s['category'] for s in p['services']},{'profile','career','ielts'})
  text=' '.join(normalized(page['text']) for page in PAGES)
  for item in p['services']:
   for fragment in item['text'].splitlines(): self.assertIn(normalized(fragment),text)
   self.assertGreater(item['page'],0)
  profile=next(s for s in p['services'] if s['category']=='profile')
  self.assertEqual(profile['confirmed_price']['amount'],'57500')
  self.assertNotIn('Профориентация',profile['text'])
 def test_exact_contract_description_can_generate(self):
  p,data=self.data();validate_service_lines(data,p)
 def test_rejects_invented_work_fake_reference_and_wrong_contract(self):
  for change in ({'result':'Проведено сто новых занятий без договора'},{'contract_source':'Договор №999'},{'source_fingerprint':'another'},{'name':'Выдана виза'}):
   p,data=self.data()
   data.lines[0]=data.lines[0].model_copy(update=change)
   with self.subTest(change=change),self.assertRaises(ValueError):validate_service_lines(data,p)
 def test_duplicate_and_unproven_amount_or_meeting_counts_are_blocked(self):
  p,data=self.data();data.lines.append(copy.deepcopy(data.lines[0]))
  with self.assertRaises(ValueError):validate_service_lines(data,p)
  p,data=self.data();data.calls_count=5
  with self.assertRaises(ValueError):validate_service_lines(data,p)
  p,data=self.data();data.include_amount=True;data.lines[0].unit_price=Decimal('123')
  with self.assertRaises(ValueError):validate_service_lines(data,p)
 def test_real_row_price_is_used_once_not_for_every_activity(self):
  p,data=self.data();self.assertGreater(len(data.lines[0].result.splitlines()),1)
  data.include_amount=True;data.lines[0].unit_price=Decimal('57500.00')
  validate_service_lines(data,p);self.assertEqual(data.total,Decimal('57500'))
 def test_signature_cannot_be_applied_to_an_unrelated_company_or_representative(self):
  p,data=self.data();data.company_signature=True
  with self.assertRaises(ValueError):validate_company_signature(data,p)
  p['company_signature_available']=True;p['company_signature_identity']={'executor_name':data.executor_name,'executor_representative':data.executor_representative}
  validate_company_signature(data,p)
  data.executor_representative='Другой Директор'
  with self.assertRaises(ValueError):validate_company_signature(data,p)
 def test_company_identity_requires_bin_and_representative(self):
  self.assertTrue(signature_available([{'text':'БИН 210240033224'}],{'executor_representative':'директора Жұман Ботагөз'}))
  self.assertFalse(signature_available([{'text':'БИН 000000000000'}],{'executor_representative':'Жұман'}))
