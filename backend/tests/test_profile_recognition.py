import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from app.services.profile_recognition import recognize_profile_changes
from app.services.student_notes import apply_student_updates
from app.services import student_context_ai, note_sessions

CASES = json.loads((Path(__file__).parent / 'fixtures/profile_recognition_cases.json').read_text())

@pytest.mark.parametrize('case', CASES, ids=lambda c:c['id'])
def test_profile_recognition_accepts_supported_facts_and_rejects_false_updates(case):
    accepted, rejected = recognize_profile_changes(case['proposed'],case['evidence'],source_text=case['source_text'],snapshot=case['snapshot'])
    assert accepted == case['expected']
    if not case['expected'] and case['id'] != 'unchanged_case':
        assert rejected


def test_achievement_review_preserves_additions_made_after_the_draft():
    student = SimpleNamespace(achievements_text='Олимпиада\nНовая статья')
    draft = {'achievements_text':'Олимпиада\nСертификат'}
    apply_student_updates(student,draft)
    assert student.achievements_text == 'Олимпиада\nНовая статья\nСертификат'
    assert apply_student_updates(student,draft) == []


@pytest.mark.parametrize('score',[None,True,'0.99',float('nan'),float('inf'),1.1,.6])
def test_confidence_must_be_a_finite_numeric_probability(score):
    proof=dict(quote='Мой город Алматы',kind='confirmed_fact',subject='student',operation='set',confidence=score)
    assert recognize_profile_changes({'city':'Алматы'},{'city':proof},source_text=proof['quote'],snapshot={})[0] == {}


def test_quote_cannot_be_assembled_from_two_speakers():
    source=json.dumps([{'text':'Мой город','sender_role':'student'},{'text':'Алматы','sender_role':'staff'}],ensure_ascii=False)
    proof=dict(quote='Мой город Алматы',kind='confirmed_fact',subject='student',operation='set',confidence=.99)
    assert recognize_profile_changes({'city':'Алматы'},{'city':proof},source_text=source,snapshot={})[0] == {}


@pytest.mark.parametrize('service',['dialog','meeting'])
def test_both_manual_ai_paths_enforce_evidence_and_keep_the_summary(service):
    proof=dict(quote='Я переехала в Алматы.',kind='confirmed_fact',subject='student',operation='set',confidence=.99)
    payload={'summary':'Обсудили переезд.','summary_markdown':'Обсудили переезд.','profile_updates':[{'field':'city','value':'Алматы','evidence':proof},{'field':'gpa','value':'4.0'}], 'suggested_changes':{'city':'Алматы','gpa':'4.0'},'change_evidence':{'city':proof}}
    module=student_context_ai if service=='dialog' else note_sessions
    with patch.object(module,'provider_chain',return_value=['test']),patch.object(module,'complete_with_fallback',new_callable=AsyncMock,return_value=json.dumps(payload)):
        if service=='dialog':
            result=asyncio.run(module.generate_context_review_draft(source_text=proof['quote'],snapshot={}))
            assert {i['field']:i['value'] for i in result['profile_updates']} == {'city':'Алматы'}
            assert result['summary']=='Обсудили переезд.'
        else:
            result=asyncio.run(module.generate_note_draft(transcript=proof['quote'],title='Встреча',snapshot={}))
            assert result['suggested_changes']=={'city':'Алматы'}
            assert result['summary_markdown']=='Обсудили переезд.'


def test_different_document_ids_are_not_equal_and_phone_formatting_is_not_a_change():
    from app.services.profile_recognition import same_field_value
    assert not same_field_value('transcript_resume_url','https://docs.google.com/d/AbC','https://docs.google.com/d/abc')
    assert same_field_value('phone','+7 700 123 45 67','+77001234567')


def test_conflicting_dialog_values_are_not_silently_resolved_by_list_order():
    items=[]
    for city in ['Алматы','Астана']:
        items.append({'field':'city','value':city,'evidence':dict(quote='Мой город '+city,kind='confirmed_fact',subject='student',confidence=.99,operation='set')})
    reasons={}
    assert student_context_ai._profile_updates(items,'Мой город Алматы. Мой город Астана.',{},reasons) == []
    assert reasons == {'city':'conflicting_values'}


def test_short_answer_uses_only_the_adjacent_recent_question_about_the_student():
    proof=dict(quote='Алматы',context_quote='В каком городе вы живёте?',kind='confirmed_fact',subject='student',confidence=.99,operation='set')
    context=json.dumps([{'message_id':'q','created_at':'2026-10-20T10:00:00+00:00','sender_role':'staff','text':proof['context_quote']},{'message_id':'a','created_at':'2026-10-20T10:01:00+00:00','sender_role':'student','text':'Алматы'}],ensure_ascii=False)
    args=dict(source_text='Алматы',snapshot={},context_text=context,message_id='a')
    assert recognize_profile_changes({'city':'Алматы'},{'city':proof},**args)[0] == {'city':'Алматы'}
    rows=json.loads(context);rows[0]['created_at']='2026-10-19T10:00:00+00:00'
    assert recognize_profile_changes({'city':'Алматы'},{'city':proof},**(args|{'context_text':json.dumps(rows)}))[0] == {}
    rows[0]['created_at']='2026-10-20T10:00:00+00:00';rows[0]['text']='В каком городе находится университет?'
    proof['context_quote']=rows[0]['text']
    assert recognize_profile_changes({'city':'Алматы'},{'city':proof},**(args|{'context_text':json.dumps(rows,ensure_ascii=False)}))[0] == {}


def test_a_thank_you_does_not_confirm_a_value_suggested_in_a_question():
    proof=dict(quote='Спасибо',context_quote='Ваш город проживания Алматы?',kind='confirmed_fact',subject='student',confidence=.99,operation='set')
    rows=[{'message_id':'q','created_at':'2026-10-20T10:00:00+00:00','sender_role':'staff','text':proof['context_quote']},{'message_id':'a','created_at':'2026-10-20T10:01:00+00:00','sender_role':'student','text':'Спасибо'}]
    assert recognize_profile_changes({'city':'Алматы'},{'city':proof},source_text='Спасибо',snapshot={},context_text=json.dumps(rows,ensure_ascii=False),message_id='a')[0] == {}


def test_question_mark_inside_a_shared_document_url_is_not_a_question():
    url='https://docs.google.com/document/d/example/edit?usp=sharing'
    quote='Вот мой транскрипт: '+url
    proof=dict(quote=quote,kind='confirmed_fact',subject='student',operation='set',confidence=.99)
    assert recognize_profile_changes({'transcript_resume_url':url},{'transcript_resume_url':proof},source_text=quote,snapshot={})[0] == {'transcript_resume_url':url}


def test_equivalent_spellings_are_one_update_and_separate_achievements_are_additive():
    def item(field,value,quote,operation='set'):
        return {'field':field,'value':value,'evidence':dict(quote=quote,kind='confirmed_fact',subject='student',confidence=.99,operation=operation)}
    source='Моя специальность Political Science. Моя специальность POLITICAL SCIENCE. Я получила сертификат. Я получила диплом.'
    updates=[item('specialty','Political Science','Моя специальность Political Science.'),item('specialty','POLITICAL SCIENCE','Моя специальность POLITICAL SCIENCE.'),item('achievements_text','сертификат','Я получила сертификат.','append'),item('achievements_text','диплом','Я получила диплом.','append')]
    reasons={}
    result={i['field']:i['value'] for i in student_context_ai._profile_updates(updates,source,{'achievements_text':'Олимпиада'},reasons)}
    assert result['specialty'].casefold()=='political science'
    assert result['achievements_text']=='Олимпиада\nсертификат\nдиплом'
    assert not reasons
