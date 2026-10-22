import asyncio
import unittest
import uuid
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from pydantic import ValidationError
from app.api.v1.endpoints.universities import create_university, start_university_import
from app.core.permissions import Action, allows
from app.models.university import University
from app.models.user import User, UserRole
from app.schemas.university import UniversityCreate


class Result:
    def __init__(self, rows): self.rows = rows
    def scalars(self): return self
    def all(self): return self.rows


class DB:
    def __init__(self, existing=None): self.existing=existing or []; self.added=[]; self.committed=False
    async def execute(self, statement, params=None): return Result(self.existing)
    def add(self, value): self.added.append(value)
    async def commit(self):
        self.committed=True
        for row in self.added: row.id=uuid.uuid4()
    async def refresh(self, value): pass


class UniversityCreationTests(unittest.TestCase):
    def test_every_staff_role_can_add_a_missing_university(self):
        for role in [UserRole.admin,UserRole.mzk_manager,UserRole.academic_head,UserRole.mentor]:
            with self.subTest(role=role), patch('app.api.v1.endpoints.universities.attach_flags',new_callable=AsyncMock):
                db=DB(); user=User(id=uuid.uuid4(),role=role)
                university=asyncio.run(create_university(UniversityCreate(name='  Missing University  '),user,db))
                self.assertEqual(university.name,'Missing University')
                self.assertTrue(db.committed)

    def test_creation_is_separate_from_edit_delete_and_bulk_import(self):
        self.assertTrue(allows(role=UserRole.mentor,resource='universities',action=Action.create))
        self.assertFalse(allows(role=UserRole.mentor,resource='universities',action=Action.manage))
        for role in [UserRole.mentor,UserRole.mzk_manager,UserRole.academic_head,UserRole.student]:
            with self.subTest(role=role), self.assertRaises(HTTPException) as caught:
                asyncio.run(start_university_import(User(id=uuid.uuid4(),role=role)))
            self.assertEqual(caught.exception.status_code,403)

    def test_duplicate_is_detected_even_when_country_is_not_supplied(self):
        old=University(id=uuid.uuid4(),name='Université Paris-Saclay',country_name='France')
        db=DB([old])
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(create_university(UniversityCreate(name='Universite Paris Saclay'),User(role=UserRole.mentor),db))
        self.assertEqual(caught.exception.status_code,409)
        self.assertEqual(caught.exception.detail['matches'][0]['id'],str(old.id))
        self.assertFalse(db.committed)
        self.assertFalse(db.added)

    def test_abbreviation_offers_the_existing_full_name(self):
        old=University(id=uuid.uuid4(),name='Massachusetts Institute of Technology',country_name='USA')
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(create_university(UniversityCreate(name='MIT'),User(role=UserRole.mentor),DB([old])))
        self.assertEqual(caught.exception.status_code,409)

    def test_empty_and_punctuation_only_names_are_rejected(self):
        with self.assertRaises(ValidationError): UniversityCreate(name='   ')
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(create_university(UniversityCreate(name='...'),User(role=UserRole.mentor),DB()))
        self.assertEqual(caught.exception.status_code,422)
