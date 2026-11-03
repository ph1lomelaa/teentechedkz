import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scripts import audit_contract_matching as audit


def test_cache_path_cannot_escape_private_directory():
    with TemporaryDirectory() as tmp:
        root=Path(tmp)
        assert audit.folder_for(root,'../../outside').parent==root
        audit.save_json(root/'report.json',{'read':1})
        assert (root/'report.json').stat().st_mode & 0o777==0o600
        assert json.loads((root/'report.json').read_text())=={'read':1}


@pytest.mark.parametrize('apply',[False,True])
def test_audit_preserves_manual_detach_and_read_only_mode(apply):
    async def scenario():
        sid=uuid.uuid4(); student=SimpleNamespace(id=sid,full_name='Тест Студент',phone='')
        people=SimpleNamespace(students=[student],guardians={},names=[student.full_name])
        profile={'fields':{'student_name':student.full_name},'sources':{'student_name':{'kind':'pdf'}}}
        db=SimpleNamespace(execute=AsyncMock(return_value=MagicMock()),commit=AsyncMock(),rollback=AsyncMock())
        db.execute.return_value.scalar_one_or_none.return_value=SimpleNamespace(decision='detached')
        db.execute.return_value.first.return_value=None
        with TemporaryDirectory() as tmp:
            root=Path(tmp); folder=audit.folder_for(root,'external')
            audit.save_json(folder/'pages.json',[{'page':1,'text':'Абитуриент: Тест Студент'}])
            audit.save_json(folder/'info.json',{'contract_status':3})
            (folder/'document.pdf').write_bytes(b'cached-pdf')
            row={'id':str(uuid.uuid4()),'external_id':'external','short_url':'example','company_id':'company','name':'Договор'}
            with patch.object(audit,'load_people',AsyncMock(return_value=people)), patch.object(audit,'extract_profile',return_value=profile), patch.object(audit,'pick_student',return_value=('link',student,'ФИО')), patch.object(audit,'_link',AsyncMock()) as link:
                result=await audit.analyze(db,SimpleNamespace(),[row],root,apply)
            assert result['link']==1
            link.assert_not_awaited()
            if apply:
                assert result['applied:skipped_existing_or_manual']==1
            else:
                db.execute.assert_not_awaited();db.commit.assert_not_awaited()

    asyncio.run(scenario())
