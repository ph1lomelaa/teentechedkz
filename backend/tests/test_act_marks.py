"""Preserve supplied ink bytes while cropping and combining marks in the PDF."""
import hashlib
from io import BytesIO
from pathlib import Path
import unittest
from pypdf import PdfReader
from app.schemas.service_act import ActInput
from app.services.act_pdf import render_act
from app.services.act_marks import ink_geometry
from test_service_acts import payload

ASSETS = Path(__file__).resolve().parents[1]/'app/assets/acts'


class MarkTests(unittest.TestCase):
    def test_empty_paper_margins_are_excluded_from_signature_bounds(self):
        width,height,(left,top,right,bottom),runs = ink_geometry(str(ASSETS/'company-signature.jpeg'))
        self.assertGreater(left,0)
        self.assertGreater(top,0)
        self.assertLess(right-left,width)
        self.assertLess(bottom-top,height)
        self.assertTrue(runs)

    def test_pdf_embeds_the_original_images_and_clips_paper_instead_of_redrawing_ink(self):
        data=ActInput(**{**payload(),'company_signature':True})
        reader=PdfReader(BytesIO(render_act(data)))
        expected={hashlib.sha256((ASSETS/name).read_bytes()).hexdigest() for name in ('company-signature.jpeg','company-stamp.jpeg')}
        embedded=set();clips=0;blend=False
        from pypdf.generic import ContentStream
        for page in reader.pages:
            resources=page['/Resources']
            for value in resources.get('/XObject',{}).values():
                obj=value.get_object()
                if obj.get('/Subtype')=='/Image':embedded.add(hashlib.sha256(obj.get_data()).hexdigest())
            clips+=sum(op in (b'W',b'W*') for _,op in ContentStream(page.get_contents(),reader).operations)
            blend=blend or any(state.get('/BM')=='/Multiply' for state in resources.get('/ExtGState',{}).values())
        self.assertEqual(embedded,expected)
        self.assertGreaterEqual(clips,2)
        self.assertTrue(blend)
