import json
import unittest

import httpx

from app.services.trustme import (
    TrustMeChallengeRequired, TrustMeClient, TrustMeError, TrustMeSessionExpired, name_queries,
)


class NamesTests(unittest.TestCase):
    def test_all_explicit_aliases_are_tried_before_generated_variants(self):
        aliases = tuple(f'Родитель{n} Другоеимя' for n in range(6))
        queries = name_queries('Жолдас Нұрай Бекболатқызы', aliases)
        for alias in aliases:
            self.assertIn(alias, queries)

    def test_spelling_variants_and_parts_do_not_change_original(self):
        queries = name_queries("  Жолдас  Нұрай Бекболатқызы ", ("Нурай Жолдас",))
        self.assertEqual(queries[0], "Жолдас Нұрай Бекболатқызы")
        self.assertIn("жолдас нурай бекболаткызы", queries)
        self.assertIn("Жолдас", queries)
        self.assertIn("Нурай Жолдас", queries)
        self.assertLessEqual(len(queries), 12)


class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_challenge_does_not_retry_login(self):
        for status, headers, content in [
            (403, {'cf-mitigated': 'challenge'}, b'challenge'),
            (200, {'content-type': 'text/html'}, b'<script src="/cdn-cgi/challenge-platform/a"></script>'),
            (503, {'cf-mitigated': 'challenge'}, b'challenge'),
        ]:
            with self.subTest(status=status):
                requests = []
                def handler(request):
                    requests.append(request.url.path)
                    return httpx.Response(status, headers=headers, content=content)
                async with TrustMeClient('token', 'company', login='user', password='secret',
                                         transport=httpx.MockTransport(handler)) as client:
                    with self.assertRaises(TrustMeChallengeRequired):
                        await client.contracts('Нурай')
                self.assertEqual(len(requests), 1)

    async def test_pdf_challenge_is_reported_as_manual_verification(self):
        def handler(request):
            if 'GetContractInfo' in request.url.path:
                return httpx.Response(200, json={'status': 'Ok', 'data': {
                    'company_id': 'company', 'doc_short_url': '4Kuowd19'}})
            return httpx.Response(403, headers={'content-type': 'text/html'},
                                  content=b'<div id="cf-chl-widget">challenge</div>')
        async with TrustMeClient('token', 'company', transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(TrustMeChallengeRequired):
                await client.pdf('4Kuowd19')

    async def test_login_discovers_company_refreshes_and_searches(self):
        calls = []

        def handler(request):
            calls.append(request.url.path)
            if request.url.path.endswith('/login'):
                self.assertIn('multipart/form-data', request.headers['content-type'])
                self.assertIn(b'name="login"', request.content)
                self.assertIn(b'name="password"', request.content)
                return httpx.Response(200, json={'status': 'Ok', 'data': {'token': 'first'}})
            if request.url.path.endswith('/GetCompanies'):
                self.assertEqual(request.headers['Authorization'], 'first')
                return httpx.Response(200, json={'status': 'Ok', 'data': [{'company_id': 'company'}]})
            if request.url.path.endswith('/UpdateToken'):
                return httpx.Response(200, json={'status': 'Ok', 'data': {'token': 'second'}})
            self.assertEqual(request.headers['Authorization'], 'second')
            return httpx.Response(200, json={'status': 'Ok', 'data': []})

        async with TrustMeClient(login='user', password='password', transport=httpx.MockTransport(handler)) as client:
            self.assertEqual(client.company_id, 'company')
            await client.refresh_session()
            self.assertEqual(await client.contracts('Нурай'), [])
        self.assertEqual(len(calls), 4)

    async def test_reauthentication_is_limited_to_one_attempt(self):
        login_count = 0
        search_count = 0

        def handler(request):
            nonlocal login_count, search_count
            if request.url.path.endswith('/login'):
                login_count += 1
                return httpx.Response(200, json={'status': 'Ok', 'data': {'token': 'new'}})
            search_count += 1
            return httpx.Response(401)

        async with TrustMeClient('expired', 'company', login='user', password='password',
                                 transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(TrustMeSessionExpired):
                await client.contracts('Нурай')
        self.assertEqual(login_count, 1)
        self.assertEqual(search_count, 2)

    async def test_multiple_companies_need_explicit_selection(self):
        def handler(request):
            return httpx.Response(200, json={'status': 'Ok', 'data': [
                {'company_id': 'first'}, {'company_id': 'second'}]})
        client = TrustMeClient('token', transport=httpx.MockTransport(handler))
        with self.assertRaisesRegex(TrustMeError, 'TRUSTME_COMPANY_ID'):
            async with client:
                self.fail('ambiguous company accepted')
        self.assertTrue(client._http.is_closed)

    async def test_failed_login_does_not_leak_credentials(self):
        def handler(request):
            return httpx.Response(200, json={'status': 'Error', 'errorText': 'password secret'})
        client = TrustMeClient(login='private', password='secret', transport=httpx.MockTransport(handler))
        with self.assertRaises(TrustMeError) as error:
            async with client:
                self.fail('invalid login accepted')
        self.assertNotIn('secret', str(error.exception))
        self.assertTrue(client._http.is_closed)

    async def test_search_uses_company_filter_and_merges_without_selecting(self):
        calls = []

        def handler(request):
            body = json.loads(request.content)
            calls.append(body)
            self.assertEqual(request.headers["Authorization"], "secret")
            self.assertEqual(body["searchData"][0]["fieldValue"], "company")
            return httpx.Response(200, json={"status": "Ok", "data": [
                {"id": "one", "companyId": "company", "contractStatus": 4},
                {"id": "two", "companyId": "company", "contractStatus": 3},
            ] if body["page"] == 1 else []})

        async with TrustMeClient("secret", "company", transport=httpx.MockTransport(handler)) as client:
            result = await client.search("Жолдас Нұрай")
        self.assertEqual(len(result.candidates), 2)
        self.assertFalse(result.truncated)
        self.assertGreater(len(result.queries), 1)
        self.assertGreater(len(calls), 2)

    async def test_repeating_pages_are_reported_as_incomplete(self):
        def handler(request):
            return httpx.Response(200, json={"status": "Ok", "data": [
                {"id": "one", "companyId": "company"}]})
        async with TrustMeClient("secret", "company", transport=httpx.MockTransport(handler)) as client:
            result = await client.search("Нурай")
        self.assertTrue(result.truncated)

    async def test_http_200_business_failure_is_not_success(self):
        transport = httpx.MockTransport(lambda r: httpx.Response(
            200, json={"status": "Error", "errorText": "private secret"}))
        async with TrustMeClient("secret", "company", transport=transport) as client:
            with self.assertRaises(TrustMeError) as error:
                await client.contracts("Нурай")
        self.assertNotIn("secret", str(error.exception))

    async def test_session_expiry_requires_reconnection(self):
        transport = httpx.MockTransport(lambda r: httpx.Response(401))
        async with TrustMeClient("secret", "company", transport=transport) as client:
            with self.assertRaises(TrustMeSessionExpired):
                await client.contracts("Нурай")

    async def test_foreign_company_cannot_download(self):
        paths = []

        def handler(request):
            paths.append(request.url.path)
            return httpx.Response(200, json={"status": "Ok", "data": {
                "company_id": "other", "doc_short_url": "4Kuowd19"}})

        async with TrustMeClient("secret", "company", transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(TrustMeError):
                await client.pdf("4Kuowd19")
        self.assertEqual(len(paths), 1)

    async def test_pdf_type_signature_and_size(self):
        for content_type, content, maximum, succeeds in [
            ("application/pdf", b"%PDF-example", 100, True),
            ("text/html", b"login", 100, False),
            ("application/pdf", b"not a PDF", 100, False),
            ("application/pdf", b"%PDF-example", 6, False),
        ]:
            with self.subTest(content_type=content_type, maximum=maximum):
                def handler(request):
                    if "GetContractInfo" in request.url.path:
                        return httpx.Response(200, json={"status": "Ok", "data": {
                            "company_id": "company", "doc_short_url": "4Kuowd19"}})
                    self.assertEqual(request.url.params["shortUrl"], "4Kuowd19")
                    return httpx.Response(200, content=content,
                                          headers={"content-type": content_type})
                async with TrustMeClient("secret", "company", transport=httpx.MockTransport(handler)) as client:
                    if succeeds:
                        self.assertEqual(await client.pdf("4Kuowd19", max_bytes=maximum), content)
                    else:
                        with self.assertRaises(TrustMeError):
                            await client.pdf("4Kuowd19", max_bytes=maximum)

    async def test_invalid_identifier_does_not_make_request(self):
        def handler(request):
            self.fail("invalid identifier reached network")
        async with TrustMeClient("secret", "company", transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(ValueError):
                await client.contract("../other")


if __name__ == "__main__":
    unittest.main()
