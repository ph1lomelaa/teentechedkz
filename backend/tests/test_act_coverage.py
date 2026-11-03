import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.act_coverage import SERVICE_COLUMNS, build_coverage

STUDENT = uuid.uuid4()


def link(*services, number='474'):
    return SimpleNamespace(id=uuid.uuid4(), student_id=STUDENT, number=number, name='Договор', status=3, source='trustme',
                           financial_contract_id=None, services_summary=[{'id': i, 'category': c, 'name': c} for i, c in services],
                           profile_encrypted=None)


def act(*service_ids, supersedes=None, date='2026-11-01'):
    return SimpleNamespace(id=uuid.uuid4(), student_id=STUDENT, supersedes_id=supersedes, file_name='Акт.pdf',
                           snapshot={'act_date': date, 'lines': [{'contract_service_id': i} for i in service_ids]})


def cells(*links, acts=(), sent=None):
    row = build_coverage([STUDENT], list(links), list(acts), sent or {})[STUDENT]
    return row, {k: v['state'] for k, v in row['cells'].items()}


def test_three_states_and_percent():
    sent_act, ready_act = act('s1'), act('s2')
    row, state = cells(link(('s1', 'profile'), ('s2', 'career'), ('s3', 'portfolio')), acts=[sent_act, ready_act],
                       sent={sent_act.id: [datetime(2026, 11, 12, tzinfo=timezone.utc)]})
    assert (state['profile'], state['career'], state['portfolio'], state['essays']) == ('sent', 'ready', 'missing', 'none')
    assert row['cells']['profile']['date'] == '2026-11-12' and row['cells']['career']['date'] == '2026-11-01'
    assert (row['services_total'], row['services_closed'], row['percent']) == (3, 2, 67)


def test_replaced_act_does_not_count_but_its_new_version_does():
    old = act('s1')
    row, state = cells(link(('s1', 'profile')), acts=[act('s1', supersedes=old.id), old])
    assert state['profile'] == 'ready' and row['services_closed'] == 1
    row, state = cells(link(('s1', 'profile')), acts=[])
    assert state['profile'] == 'missing' and row['percent'] == 0


def test_services_of_several_contracts_are_combined_and_worst_state_is_shown():
    row, state = cells(link(('s1', 'essays')), link(('s2', 'essays'), number='475'), acts=[act('s1')])
    assert len(row['contracts']) == 2 and row['services_total'] == 2
    assert state['essays'] == 'missing'


def test_student_without_contract_has_no_percent():
    row, state = cells()
    assert row['percent'] is None and set(state.values()) == {'none'}


def test_requested_service_columns_are_visible_without_claiming_they_are_in_every_contract():
    assert SERVICE_COLUMNS[:5] == ['ielts', 'career', 'csca', 'entrance', 'sat']
    _, state = cells(link(('s1', 'ielts')))
    assert state['ielts'] == 'missing'
    assert all(state[key] == 'none' for key in ('career', 'csca', 'entrance', 'sat'))
