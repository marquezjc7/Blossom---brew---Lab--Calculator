import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import check_usage_statistics as module

class UsageStatisticsCheckTests(unittest.TestCase):
    def setUp(self):
        self.config={"url":"https://project.supabase.co","publishableKey":"sb_publishable_test"}
        self.responses=[(401,{"code":"42501"})]*4+[(400,{"code":"22023"})]
        self.requests=[]
    def opener(self,request,timeout):
        self.requests.append(request)
        status,data=self.responses.pop(0)
        raise HTTPError(request.full_url,status,'test',{},io.BytesIO(json.dumps(data).encode()))
    def check(self,required=False):
        with patch.object(module,'cloud_config',return_value=self.config):
            return module.check_usage_statistics(self.opener,require_ready=required)
    def test_private_statistics_and_invalid_event_validation_are_required(self):
        self.assertTrue(self.check(True))
        body=json.loads(self.requests[-1].data)
        self.assertIsNone(body['session_id'])
        self.assertTrue(all(request.get_header('Authorization') is None for request in self.requests))
    def test_missing_setup_is_pending_unless_required(self):
        self.responses=[(404,{"code":"PGRST202"})]
        self.assertFalse(self.check())
        self.responses=[(404,{"code":"PGRST202"})]
        with self.assertRaisesRegex(RuntimeError,'activar'): self.check(True)
    def test_anonymous_read_or_unvalidated_write_blocks_the_check(self):
        for index in range(5):
            self.setUp();self.responses[index]=(200,{})
            with self.subTest(index=index),self.assertRaises(RuntimeError): self.check()
