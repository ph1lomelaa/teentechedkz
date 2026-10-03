import asyncio
import io
import json
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from xml.sax.saxutils import escape

import pytest
from fastapi import HTTPException, UploadFile
from app.api.v1.endpoints import activity_import as api
from app.models.user import UserRole
from app.services.activity_import import HEADERS, identity, preview_xlsx


def workbook(rows):
    # Minimal XLSX fixture; no workbook authoring dependency needed.
    def row(values, n):
        return '<row r="%s">%s</row>' % (n, ''.join('<c r="%s%s" t="inlineStr"><is><t>%s</t></is></c>' % (chr(65+i), n, escape(str(v))) for i,v in enumerate(values)))
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as z:
        z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>')
        z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="База" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+row(HEADERS,1)+''.join(row(r,n) for n,r in enumerate(rows,2))+'</sheetData></worksheet>')
    return stream.getvalue()


def test_preview_preserves_dates_and_source_without_guessing():
    p=preview_xlsx(workbook([[1,'IT','Конкурс','Проект','Орг','','до сентября / rolling','','','','https://example.com']]), 'base.xlsx')
    r=p['rows'][0]
    assert not r['errors']
    assert r['activity']['publication']=='draft'
    assert r['dates_text']=='до сентября / rolling'
    assert r['source']['row']==2 and r['source']['raw']['Группа']=='IT'


def test_duplicates_url_titles_and_number_only_rows():
    rows=[[1,'','','Проект','','','','','','','https://example.com'],[2,'','','Проект','','','','','','','https://example.com/'],[3],[4,'','','https://example.org']]
    p=preview_xlsx(workbook(rows),'base.xlsx')
    assert p['skipped']==1
    assert 'Дубликат в файле' in p['rows'][1]['errors']
    assert p['rows'][2]['errors']


def test_import_requires_admin_before_reading_file():
    file=SimpleNamespace(read=AsyncMock())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(api.preview(SimpleNamespace(), SimpleNamespace(role=UserRole.student), file))
    assert exc.value.status_code==403
    file.read.assert_not_awaited()


def test_reimport_skips_existing_and_never_overwrites():
    content=workbook([[1,'','','Проект','Орг','','','','','','https://example.com']])
    existing=SimpleNamespace(import_key=identity('Проект','Орг','https://example.com/'))
    db=SimpleNamespace(execute=AsyncMock(side_effect=[None,SimpleNamespace(scalars=lambda:SimpleNamespace(all=lambda:[existing]))]),add=Mock(),commit=AsyncMock())
    result=asyncio.run(api.commit(db,SimpleNamespace(role=UserRole.admin),UploadFile(io.BytesIO(content),filename='base.xlsx'),json.dumps([2])))
    assert result['imported_rows']==[] and result['skipped_rows'][0]['row']==2
    db.add.assert_not_called()


def test_real_source_preview():
    source=Path(__file__).resolve().parents[2]/'База активностей (1).xlsx'
    if not source.exists(): pytest.skip('Local source workbook is not part of repository')
    p=preview_xlsx(source.read_bytes(),source.name)
    assert len(p['rows'])==8 and p['skipped']==5
    assert sum(not r['errors'] for r in p['rows'])==7
