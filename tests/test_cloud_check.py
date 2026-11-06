"""Comprueba los criterios de publicación sin enviar correos ni acceder a datos privados."""

import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_cloud


class CloudCheckTests(unittest.TestCase):
    def setUp(self):
        self.config = {"url": "https://project.supabase.co", "publishableKey": "sb_publishable_test"}
        self.responses = [
            (200, {"name": "GoTrue"}),
            (200, {"external": {"email": True}, "disable_signup": False}),
            (401, {"code": "42501", "message": "permission denied for function blossom_sync"}),
            (401, {"code": "42501", "message": "permission denied for table blossom_records"}),
        ]
        self.requests = []

    def opener(self, request, timeout):
        self.requests.append(request)
        status, data = self.responses.pop(0)
        body = io.BytesIO(json.dumps(data).encode())
        if status >= 400:
            raise HTTPError(request.full_url, status, "test response", {}, body)
        body.status = status
        return body

    def run_check(self):
        with patch.object(check_cloud, "cloud_config", return_value=self.config):
            check_cloud.check_cloud(self.opener)

    def test_accepts_reachable_email_auth_and_denied_anonymous_access(self):
        self.run_check()
        self.assertEqual(len(self.requests), 4)
        self.assertTrue(all(request.get_header("Apikey") == self.config["publishableKey"] for request in self.requests))
        self.assertTrue(all(request.get_header("Authorization") is None for request in self.requests))
        self.assertEqual(json.loads(self.requests[2].data), {"changes": []})
        self.assertTrue(self.requests[3].full_url.endswith("limit=0"))

    def test_missing_variables_stop_publication_before_any_request(self):
        self.config = None
        with self.assertRaisesRegex(RuntimeError, "Faltan BLOSSOM"):
            self.run_check()
        self.assertEqual(self.requests, [])

    def test_invalid_public_key_stops_publication(self):
        self.responses[0] = (401, {"message": "Invalid API key"})
        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            self.run_check()

    def test_disabled_email_stops_publication(self):
        self.responses[1] = (200, {"external": {"email": False}})
        with self.assertRaisesRegex(RuntimeError, "proveedor Email"):
            self.run_check()

    def test_disabled_registration_stops_publication(self):
        self.responses[1] = (200, {"external": {"email": True}, "disable_signup": True})
        with self.assertRaisesRegex(RuntimeError, "registro de usuarios"):
            self.run_check()

    def test_missing_rpc_stops_publication(self):
        self.responses[2] = (404, {"code": "PGRST202"})
        with self.assertRaisesRegex(RuntimeError, "blossom_sync"):
            self.run_check()

    def test_anonymous_rpc_success_stops_publication(self):
        self.responses[2] = (200, {"records": [], "conflicts": []})
        with self.assertRaisesRegex(RuntimeError, "blossom_sync"):
            self.run_check()

    def test_anonymous_table_success_stops_publication(self):
        self.responses[3] = (200, [])
        with self.assertRaisesRegex(RuntimeError, "blossom_records"):
            self.run_check()
