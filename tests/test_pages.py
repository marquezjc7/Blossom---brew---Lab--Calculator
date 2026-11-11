"""Public cloud configuration must never publish a server credential."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare_pages", ROOT / "scripts" / "prepare_pages.py")
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


class PagesTests(unittest.TestCase):
    def config(self, url="", key=""):
        with patch.dict(os.environ, {"BLOSSOM_SUPABASE_URL": url, "BLOSSOM_SUPABASE_PUBLISHABLE_KEY": key}, clear=True):
            return pages.cloud_config()

    def test_an_unconfigured_build_keeps_the_local_application(self):
        self.assertIsNone(self.config())

    def test_only_public_publishable_or_anon_keys_can_be_published(self):
        self.assertEqual(self.config("https://project.supabase.co/", "sb_publishable_test")["url"], "https://project.supabase.co")
        for role in ["anon", "service_role"]:
            part = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
            key = "eyJhbGciOiJub25lIn0." + part + ".test"
            if role == "anon":
                self.assertEqual(self.config("https://project.supabase.co", key)["publishableKey"], key)
            else:
                with self.assertRaises(SystemExit) as error:
                    self.config("https://project.supabase.co", key)
                self.assertNotIn(key, str(error.exception))
        with self.assertRaises(SystemExit):
            self.config("https://project.supabase.co", "sb_secret_test")

    def test_partial_or_invalid_configuration_stops_the_build(self):
        for url, key in [("", "sb_publishable_test"), ("https://project.supabase.co", ""),
                         ("http://project.supabase.co", "sb_publishable_test"),
                         ("https://user:password@project.supabase.co", "sb_publishable_test"),
                         ("https://project.supabase.co/path", "sb_publishable_test")]:
            with self.subTest(url=url), self.assertRaises(SystemExit):
                self.config(url, key)

    def test_staging_injects_public_configuration_without_changing_sources(self):
        with tempfile.TemporaryDirectory(prefix="blossom-pages-test-") as directory:
            root = Path(directory)
            (root / "index.html").write_text("<!doctype html><title>Blossom</title>")
            (root / "src").mkdir()
            (root / "assets").mkdir()
            (root / "concepto").mkdir()
            (root / "concepto/index.html").write_text("<!doctype html><title>Propuesta visual</title>")
            (root / "recetario").mkdir()
            (root / "recetario/index.html").write_text('<html data-public-catalogue="blossom"></html>')
            migration = root / "supabase/migrations/202611110001_public_catalogue.sql"
            migration.parent.mkdir(parents=True)
            migration.write_text("-- Activación sin credenciales")
            step_migration = migration.parent / "202611110002_pour_steps.sql"
            step_migration.write_text("-- Indicaciones de vertidos")
            usage_migration = migration.parent / "202611110003_usage_statistics.sql"
            usage_migration.write_text("-- Estadísticas privadas")
            original = "// Local mode\n"
            (root / "src/cloud-config.js").write_text(original)
            with patch.object(pages, "ROOT", root), patch.object(pages, "OUTPUT", root / "_site"), patch.dict(os.environ, {
                "BLOSSOM_SUPABASE_URL": "https://project.supabase.co",
                "BLOSSOM_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
            }, clear=True):
                pages.main()
                self.assertEqual((root / "_site/index.html").read_text(), "<!doctype html><title>Blossom</title>")
                self.assertIn("Propuesta visual", (root / "_site/concepto/index.html").read_text())
                self.assertIn('data-public-catalogue="blossom"', (root / "_site/recetario/index.html").read_text())
                self.assertEqual((root / "_site" / migration.relative_to(root)).read_text(), migration.read_text())
                self.assertEqual((root / "_site" / step_migration.relative_to(root)).read_text(), step_migration.read_text())
                self.assertEqual((root / "_site" / usage_migration.relative_to(root)).read_text(), usage_migration.read_text())
                self.assertIn('"publishableKey": "sb_publishable_test"', (root / "_site/src/cloud-config.js").read_text())
                self.assertEqual((root / "src/cloud-config.js").read_text(), original)
                pages.main()
                with patch.dict(os.environ, {"BLOSSOM_SUPABASE_PUBLISHABLE_KEY": "sb_secret_test"}):
                    with self.assertRaises(SystemExit):
                        pages.main()
                self.assertIn("sb_publishable_test", (root / "_site/src/cloud-config.js").read_text())
