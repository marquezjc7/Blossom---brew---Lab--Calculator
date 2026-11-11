import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_public_catalogue as module


class PublicCatalogueCheckTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.config = {"url": "https://project.supabase.co", "publishableKey": "sb_publishable_test"}
        self.responses = [(200, [])] + [(401, {"code": "42501", "message": "permission denied for " + name}) for name in
                          ["blossom_catalogue_status", "blossom_publish_recipe", "blossom_withdraw_recipe", "blossom_publishers", "blossom_publications"]]

    def opener(self, request, timeout):
        self.requests.append(request)
        status, data = self.responses.pop(0)
        body = io.BytesIO(json.dumps(data).encode())
        if status >= 400:
            raise HTTPError(request.full_url, status, "test response", {}, body)
        body.status = status
        return body

    def run_check(self, require_ready=False):
        with patch.object(module, "cloud_config", return_value=self.config):
            return module.check_public_catalogue(self.opener, require_ready=require_ready)

    def test_ready_catalogue_is_readable_but_cannot_be_written_anonymously(self):
        self.assertTrue(self.run_check(True))
        self.assertEqual(len(self.requests), 6)
        self.assertTrue(all(request.get_header("Authorization") is None for request in self.requests))

    def test_only_a_missing_rpc_can_leave_activation_pending(self):
        self.responses = [(404, {"code": "PGRST202"})]
        self.assertFalse(self.run_check())
        self.responses = [(404, {"code": "PGRST202"})]
        with self.assertRaisesRegex(RuntimeError, "activar"):
            self.run_check(True)
        for status in [401, 403, 500]:
            self.responses = [(status, {"code": "42501"})]
            with self.subTest(status=status), self.assertRaises(RuntimeError):
                self.run_check()

    def test_unprotected_publication_administration_stops_the_check(self):
        for index in range(1, 6):
            self.setUp()
            self.responses[index] = (200, [])
            with self.subTest(index=index), self.assertRaisesRegex(RuntimeError, "protección"):
                self.run_check()
