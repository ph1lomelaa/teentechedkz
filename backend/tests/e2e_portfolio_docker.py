"""Real HTTP + PostgreSQL + Redis + MinIO smoke test for the local Docker stack.

Run inside tte_portfolio_backend after startup. Creates synthetic test work only.
"""
import asyncio
import uuid
import httpx
from app.core.config import settings


async def main():
    if settings.ENVIRONMENT == 'production' or not settings.DATABASE_URL.endswith('/tte_portfolio_check_docker'):
        raise RuntimeError('Only the disposable Portfolio Docker database is allowed')
    base = 'http://127.0.0.1:8000/api/v1'
    async with httpx.AsyncClient(base_url=base, timeout=30) as client:
        async def login(role):
            response = await client.post('/auth/login', json={'email': f'portfolio.preview.{role}@example.test', 'password': 'PortfolioPreview2026!'})
            assert response.status_code == 200, response.text
            return {'Authorization': 'Bearer ' + response.json()['access_token']}
        mentor, learner = await login('mentor'), await login('student')
        async def call(method, path, role, expected=200, **kwargs):
            response = await client.request(method, path, headers=role, **kwargs)
            assert response.status_code == expected, (path, response.status_code, response.text[:800])
            return response
        plan = (await call('GET', '/activities/my/participations', learner)).json()
        active = next(p for p in plan if p['status'] == 'in_progress' and p['decision'] == 'selected' and p['result_review_status'] == 'none')
        task = (await call('POST', '/learner-tasks', mentor, expected=201, json={
            'student_id': active['student_id'], 'activity_participation_id': active['id'],
            'title': 'Docker upload verification ' + uuid.uuid4().hex[:6],
            'requires_review': False, 'requires_evidence': True,
        })).json()
        content = b'Portfolio UP Docker upload and download verification\n'
        doc = (await call('POST', '/portfolio-documents/upload', learner,
            data={'task_id': task['id'], 'doc_type': 'other'},
            files={'file': ('registration.txt', content, 'text/plain')})).json()
        download = await call('GET', f"/documents/portal/{doc['id']}/download", learner)
        assert download.content == content
        await call('POST', f"/learner-tasks/{task['id']}/complete", learner, json={'result_text': 'File uploaded and verified'})
        await call('DELETE', f"/documents/portal/{doc['id']}", learner, expected=409)
        result = next(p for p in plan if p['status'] == 'completed' and p['certificates_count'])
        files = (await call('GET', f"/portfolio-documents?participation_id={result['id']}", learner)).json()
        assert files and result['certificates_count'] >= 1
        certificate = await call('GET', f"/documents/portal/{files[0]['id']}/download", learner)
        assert certificate.content.startswith(b'%PDF-')
        queue = (await call('GET', '/workspace/roadmap-tasks', mentor)).json()
        assert any(t['id'] == task['id'] and t['status'] == 'done' for t in queue['items'])

        # Сводка портфолио: фокус ментора, «Сейчас», типы опыта, обзор по ученикам.
        summary = (await call('GET', '/activities/my/portfolio-summary', learner)).json()
        assert summary['focus'] and summary['actions'][0]['kind'] == 'fix_step'
        before = {t['key']: t['confirmed'] for t in summary['experience']}
        overview = (await call('GET', '/activities/staff/students-overview', mentor)).json()
        assert len(overview) >= 3 and any(r['counts']['waiting_mentor'] for r in overview)
        sent = next(p for p in plan if p['result_review_status'] == 'pending')
        waiting = (await call('GET', '/activities/staff/participations?view=waiting', mentor)).json()
        assert any(i['id'] == sent['id'] for i in waiting['items'])
        await call('POST', f"/activities/participations/{sent['id']}/result/review", mentor, json={'action': 'approve', 'comment': ''})
        after = (await call('GET', '/activities/my/portfolio-summary', learner)).json()
        kind = sent['activity']['experience_type']
        assert after['counts']['confirmed'] == summary['counts']['confirmed'] + 1
        assert {t['key']: t['confirmed'] for t in after['experience']}[kind] == before[kind] + 1
        await call('PUT', f"/activities/students/{sent['student_id']}/portfolio-focus", learner, expected=403, json={'text': 'x'})
    print('PASS: logins, MinIO upload/download, evidence, completion, certificate, workspace queue, portfolio summary, focus and result approval')


if __name__ == '__main__':
    asyncio.run(main())
