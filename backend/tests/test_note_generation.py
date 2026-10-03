import asyncio
from app.services import ai_client, note_sessions

def test_notes_request_detailed_output_and_preserve_sections(monkeypatch):
    seen = {}
    async def complete(system, message, *, max_tokens):
        seen.update(system=system, message=message, tokens=max_tokens)
        return '{"title":"Выбор","summary_markdown":"Итог\\n\\n## Что обсудили\\n- Выбор программы\\n\\n## Следующие шаги\\n- Проверить сроки","student_summary_markdown":"## Что обсудили\\nВыбор программы","suggested_changes":{},"profile_notes":[]}'
    monkeypatch.setattr(note_sessions, 'provider_chain', lambda: ['openai'])
    monkeypatch.setattr(note_sessions, 'complete_with_fallback', complete)
    result = asyncio.run(note_sessions.generate_note_draft(transcript='Обсудили выбор программы и проверку сроков.', title='Встреча', snapshot={}))
    assert seen['tokens'] == 8000
    assert 'student_summary_markdown, suggested_changes, profile_notes' in seen['message']
    assert '## Что обсудили' in result['summary_markdown']
    assert '## Следующие шаги' in result['summary_markdown']
    assert result['__ai_meta']['prompt_version'] == 'note_sessions.v2.structured'

def test_token_budget_passed_to_fallback_provider(monkeypatch):
    calls = []
    async def primary(system, message, *, max_tokens):
        calls.append(max_tokens)
        raise RuntimeError('unavailable')
    async def secondary(system, message, *, max_tokens):
        calls.append(max_tokens)
        return 'result'
    monkeypatch.setattr(ai_client, 'provider_chain', lambda: ['openai', 'anthropic'])
    monkeypatch.setattr(ai_client, '_complete_openai', primary)
    monkeypatch.setattr(ai_client, '_complete_anthropic', secondary)
    assert asyncio.run(ai_client.complete_with_fallback('system', 'message', max_tokens=8000)) == 'result'
    assert calls == [8000, 8000]
