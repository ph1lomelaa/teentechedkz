import copy
from decimal import Decimal
from types import SimpleNamespace
import unittest
from app.services.contract_services import strip_quantities, extract_services, validate_service_lines, validate_company_signature, signature_available, normalized
from app.services.contract_profile import extract_profile
from app.schemas.service_act import ActInput
from test_service_acts import payload

PAGES = [
 {'page':1,'text':'ДОГОВОР № 671 г. Алматы «28» июля 2026 г. 1.5. Подготовка к IELTS: сроком 2 месяца. Подготовка к IELTS включает проведение учебных занятий, подготовку к Listening, Reading, Writing и Speaking. 1.6. Другие условия.'},
 {'page':2,'text':'Приложение №1 к Договору. Стоимость услуги, тенге. Оценка профиля студента 2 6 57 500 Анализ академического и личного профиля студента. В услугу входит: Анализ академических показателей и имеющихся документов студента; Предоставление рекомендаций по выбору направления обучения. Профориентация 6 3 50000 Что получает абитуриент: ✅ Осознанность в выборе академического трека. ✅ Представление о возможных карьерных перспективах.'},
]


class QuantityTests(unittest.TestCase):
 def test_counts_removed_from_description(self):
  self.assertEqual(strip_quantities('проводят с вами четыре консультации для редактирования'),'проводят с вами консультации для редактирования')
  self.assertEqual(strip_quantities('занятий 3 (три) раза в неделю в формате, а также Speaking Club 2 (два) раза в неделю'),'занятий в формате, а также Speaking Club')
  self.assertEqual(strip_quantities('до получения оффера (3 ВУЗа * до 5 email) услуги'),'до получения оффера услуги')

 def test_numbered_clause_has_no_lesson_frequency(self):
  pages=[{'page':1,'text':'1.6. Подготовка по английскому языку: курс сроком 3 месяца. Подготовка включает проведение учебных занятий 3 (три) раза в неделю в формате мини-группы. 1.7. Другое.'}]
  english=[x for x in extract_services(pages,'f') if x['category']=='english'][0]
  self.assertNotIn('раза в неделю',english['text'])

 def test_long_result_is_accepted(self):
  raw=payload(); raw['lines'][0]['result']='Описание. '*400
  self.assertGreater(len(ActInput(**raw).lines[0].result),2000)


class MailSubjectTests(unittest.TestCase):
 def test_blank_subject_gets_default(self):
  from app.schemas.service_act import ActMailInput
  import uuid
  for subject in ('', '  '):
   mail=ActMailInput(request_id=uuid.uuid4(),recipient='a@b.kz',subject=subject,body='x')
   self.assertEqual(mail.subject,'Акт выполненных работ')


class ProvenanceTests(unittest.TestCase):
 def profile(self): return extract_profile(PAGES,{},b'test-contract')
 def data(self):
  profile=self.profile(); service=profile['services'][0]
  line=dict(name=service['name'],result=service['text'],contract_service_id=service['id'],source_fingerprint=profile['fingerprint'],contract_source=service['reference'],unit='услуга',quantity='1')
  return profile, ActInput(**{**payload(),'include_amount':False,'lines':[line]})
 def test_every_activity_is_a_literal_contract_fragment_and_has_a_page(self):
  p=self.profile()
  from app.services.contract_services import DEFAULT_SERVICES
  categories=[s['category'] for s in p['services']]
  # Все виды услуг есть, и ни один не повторяется: своя услуга договора скрывает стандартную.
  self.assertEqual(set(categories),set(DEFAULT_SERVICES))
  self.assertEqual(len(categories),len(set(categories)))
  self.assertEqual({s['category'] for s in p['services'] if s.get('source_kind')!='standard'},{'profile','career','ielts'})
  text=' '.join(normalized(page['text']) for page in PAGES)
  for item in p['services']:
   if item.get('source_kind') == 'standard': continue
   for fragment in item['text'].splitlines(): self.assertIn(normalized(fragment),text)
   self.assertGreater(item['page'],0)
  profile=next(s for s in p['services'] if s['category']=='profile')
  self.assertEqual(profile['confirmed_price']['amount'],'57500')
  self.assertNotIn('Профориентация',profile['text'])
 def test_exact_contract_description_can_generate(self):
  p,data=self.data();validate_service_lines(data,p)
 def test_rejects_invented_work_fake_reference_and_wrong_contract(self):
  for change in ({'contract_source':'Договор №999'},{'source_fingerprint':'another'},{'name':'Выдана виза'}):
   p,data=self.data()
   data.lines[0]=data.lines[0].model_copy(update=change)
   with self.subTest(change=change),self.assertRaises(ValueError):validate_service_lines(data,p)
 def test_edited_result_text_is_allowed(self):
  p,data=self.data()
  data.lines[0]=data.lines[0].model_copy(update={'result':data.lines[0].result+' (уточнено)'})
  validate_service_lines(data,p)
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

 def test_exam_preparation_columns_need_an_actual_contract_service(self):
  pages = [{'page': 1, 'text': 'Экзамены SAT и CSCA оплачиваются заказчиком. Подготовка к IELTS: занятия по Writing и Speaking.'}]
  found = extract_services(pages, 'fingerprint')
  self.assertNotIn('sat', {item['category'] for item in found})
  self.assertNotIn('csca', {item['category'] for item in found})
  pages = [{'page': 1, 'text': 'Приложение №1 к Договору. Подготовка к CSCA. Проведение занятий по математике. Подготовка к вступительным экзаменам. Проведение пробных тестов. Подготовка к SAT. Разбор заданий экзамена.'}]
  found = extract_services(pages, 'fingerprint')
  self.assertEqual({'csca', 'entrance', 'sat'}, {item['category'] for item in found})

 def test_career_does_not_absorb_neighboring_table_rows(self):
  pages = [{'page':1,'text':'Приложение №1 к Договору. Профориентация 3 6 🏛 Шорт-лист университетов и программ: до 10 ВУЗов 4 12 📜 Рекомендательные письма / Academic (2 * Letters of Recommendation) 4 8'}]
  found = extract_services(pages, 'test')
  career = next(s for s in found if s['category'] == 'career')
  self.assertEqual(career['text'], 'Профориентация')
  self.assertNotIn('Рекомендательные', next(s for s in found if s['category'] == 'shortlist')['text'])

 def test_ielts_stops_before_next_top_level_section(self):
  pages = [{'page':1,'text':'1.5. Подготовка к IELTS: Подготовка к IELTS включает проведение учебных занятий по Listening, Reading, Writing и Speaking. 2. СТОИМОСТЬ УСЛУГ И ПОРЯДОК РАСЧЕТОВ 2.1. Оплата.'}]
  found = extract_services(pages, 'test')
  self.assertEqual(len(found), 1)
  self.assertNotIn('СТОИМОСТЬ', found[0]['text'])
  self.assertTrue(found[0]['text'].endswith('Speaking'))

 def test_defaults_are_available_and_valid_without_matching_contract_clauses(self):
  from app.services.contract_services import with_default_services, DEFAULT_SERVICES
  profile=with_default_services({'fingerprint':'student-contract','services':[]})
  self.assertEqual({s['category'] for s in profile['services']},set(DEFAULT_SERVICES))
  for service in profile['services']:
   self.assertEqual(service['source_kind'],'standard')
   for line in service['text'].split('\n'): self.assertIn(normalized(line),normalized(service['excerpt']))
   self.assertNotIn('confirmed_price',service)
   line=dict(name=service['name'],result=service['text'],contract_service_id=service['id'],source_fingerprint=profile['fingerprint'],contract_source=service['reference'],unit='услуга',quantity='1')
   validate_service_lines(ActInput(**{**payload(),'include_amount':False,'lines':[line]}),profile)
  self.assertEqual(profile,with_default_services(copy.deepcopy(profile)))

 def test_contract_description_wins_and_defaults_are_bound_to_current_contract(self):
  from app.services.contract_services import with_default_services
  own={'id':'own','name':'Подготовка к SAT','category':'sat','text':'Индивидуальные занятия по подготовке к SAT с преподавателем','reference':'Договор, стр. 2'}
  first=with_default_services({'fingerprint':'first','services':[own]})
  self.assertEqual([s for s in first['services'] if s['category']=='sat'],[own])
  second=with_default_services({'fingerprint':'second','services':[]})
  first_ids={s['id'] for s in first['services']}
  self.assertFalse(first_ids & {s['id'] for s in second['services']})

 def test_heading_only_uses_default_description_without_losing_existing_act_identity(self):
  from app.services.contract_services import with_default_services
  heading={'id':'existing-career','name':'Профориентация','category':'career','text':'Профориентация'}
  profile=with_default_services({'fingerprint':'contract','services':[heading]})
  service=next(s for s in profile['services'] if s['category']=='career')
  self.assertEqual(service['id'],'existing-career')
  self.assertEqual(service['source_kind'],'standard')
  self.assertGreater(len(service['text']),len(heading['text']))
  self.assertEqual(profile,with_default_services(copy.deepcopy(profile)))


class BrokenWordsTests(unittest.TestCase):
 def test_pdf_word_breaks_are_joined(self):
  from app.services.contract_services import join_broken_words as j
  for raw, fixed in [('участие в исследовательск их проектах','участие в исследовательских проектах'),('сертификационн ых программ','сертификационных программ'),
                     ('кейс-чемпионата х','кейс-чемпионатах'),('конкурентоспосо бно го профиля','конкурентоспособного профиля'),('численностью д о 3 человек','численностью до 3 человек')]:
   self.assertEqual(j(raw),fixed)

 def test_real_words_are_not_glued(self):
  from app.services.contract_services import join_broken_words as j
  for text in ('Мы адаптируем его содержание','оценка их результатов','через их сайт','в и к о у','разбор его результатов'):
   self.assertEqual(j(text),text)

 def test_catalog_has_twenty_clean_services_without_prices(self):
  from app.services.contract_services import DEFAULT_SERVICES
  self.assertEqual(len(DEFAULT_SERVICES),20)
  for key in ('mentor','mock_test','recommendations','ielts_fee','english'): self.assertIn(key,DEFAULT_SERVICES)
  for item in DEFAULT_SERVICES.values():
   self.assertNotIn('confirmed_price',item)
   for bad in (' д о ','исследовательск их','четыре консультации','раза в неделю',' ,'): self.assertNotIn(bad,item['text'])

 def test_contract_service_hides_its_standard_twin_and_edited_text_still_validates(self):
  from app.services.act_pdf import render_act
  from app.services.contract_services import with_default_services
  p=extract_profile(PAGES,{},b'test-contract')
  career=[s for s in p['services'] if s['category']=='career']
  self.assertEqual(len(career),1); self.assertNotEqual(career[0].get('source_kind'),'standard')
  mentor=next(s for s in p['services'] if s['category']=='mentor')
  lines=[dict(name=s['name'],result=s['text']+' (поправлено вручную)',contract_service_id=s['id'],source_fingerprint=p['fingerprint'],contract_source=s['reference'],unit='услуга',quantity='1') for s in (career[0],mentor)]
  data=ActInput(**{**payload(),'include_amount':False,'lines':lines})
  validate_service_lines(data,p)
  self.assertTrue(render_act(data).startswith(b'%PDF'))
  # Повторное применение каталога не меняет идентификаторы: готовые акты не теряют услуги.
  self.assertEqual([s['id'] for s in with_default_services(copy.deepcopy(p))['services']],[s['id'] for s in p['services']])
