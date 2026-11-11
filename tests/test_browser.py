"""Pruebas funcionales con un servidor y perfiles de navegador temporales."""

import csv
import functools
import io
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading
import unittest

from playwright.sync_api import Error, sync_playwright, expect
from cloud_mock import MockCloud


ROOT = Path(__file__).resolve().parents[1]
RECIPE_KEY = "blossom-brew-recipes-v1"
SESSION_KEY = "blossom-brew-sessions-v1"
LEGACY_RECIPE = {
    "id": "custom-anterior", "name": "Mi receta anterior", "coffee": "Café de Julio",
    "method": "V60", "dose": 18, "water": 288, "ratio": 16, "temp": 91,
    "bloom": 45, "time": "3:00", "grind": "120", "pours": [54, 174, 288],
    "notes": "Receta guardada antes de reorganizar el código.",
}
LEGACY_SESSION = {
    "id": "sesion-anterior", "date": "2026-10-14T12:00:00.000Z",
    "coffee": "Café de Julio", "method": "V60", "dose": 18, "water": 288,
    "realRatio": 16, "temp": 91, "time": "3:00", "grind": "120",
    "tds": None, "cup": None, "extraction": None,
    "score": {"sweet": 0, "acid": 6, "body": 5}, "notes": "Respaldo anterior",
}
INCOMPLETE_RECIPE = {
    **LEGACY_RECIPE,
    "id": "custom-incomplete", "name": "Mi receta sin plan completo",
    "dose": 15, "water": 240, "pours": None, "bloomWater": 50,
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(QuietHandler, directory=str(ROOT))
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}/"
        cls.playwright = sync_playwright().start()
        options = {"headless": True}
        executable = os.environ.get("BLOSSOM_BROWSER_EXECUTABLE")
        if executable:
            options["executable_path"] = executable
        try:
            engine = os.environ.get("BLOSSOM_BROWSER", "chromium")
            if engine not in ["chromium", "webkit"]:
                raise ValueError("BLOSSOM_BROWSER debe ser chromium o webkit")
            cls.browser = getattr(cls.playwright, engine).launch(**options)
        except Exception:
            cls.playwright.stop()
            cls.server.shutdown()
            cls.server.server_close()
            cls.thread.join()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context(
            accept_downloads=True, locale="es-ES", viewport={"width": 1280, "height": 900},
        )
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        response = self.page.goto(self.base_url)
        self.assertEqual(response.status, 200)

    def tearDown(self):
        self.assertEqual(self.errors, [], "Errores JavaScript durante la prueba")

    def tab(self, name):
        self.page.locator(f'[data-tab="{name}"]').click()
        expect(self.page.locator(f"#{name}")).to_be_visible()

    def stored(self, key):
        return self.page.evaluate("key => JSON.parse(localStorage.getItem(key))", key)

    def download_text(self, button):
        with self.page.expect_download() as event:
            self.page.locator(button).click()
        return event.value.path().read_text(encoding="utf-8-sig")

    def seed_legacy_data(self):
        self.page.evaluate(
            """data => {
                localStorage.setItem('blossom-brew-recipes-v1', JSON.stringify(data.recipes));
                localStorage.setItem('blossom-brew-sessions-v1', JSON.stringify(data.sessions));
            }""",
            {"recipes": [LEGACY_RECIPE], "sessions": [LEGACY_SESSION]},
        )
        self.page.reload()

    def create_custom_recipe(self, name="Mi receta de prueba"):
        self.page.fill("#recipeName", name)
        self.page.click("#saveRecipe")
        expect(self.page.locator("#recipeName")).to_have_value(name)
        return self.stored(RECIPE_KEY)[-1]["id"]

    def seed_incomplete_recipe(self, select=True):
        self.page.evaluate(
            "recipe => localStorage.setItem('blossom-brew-recipes-v1', JSON.stringify([recipe]))",
            INCOMPLETE_RECIPE,
        )
        self.page.reload()
        if select:
            self.page.select_option("#preset", INCOMPLETE_RECIPE["id"])

    def edit_plan(self, weights, times=None):
        self.page.click("#editPours")
        rows = self.page.locator("#pourRows .pour-row")
        while rows.count() > len(weights):
            rows.last.locator(".remove-pour").click()
        while rows.count() < len(weights):
            self.page.click("#addPour")
        for index, weight in enumerate(weights):
            rows.nth(index).locator(".pour-weight").fill(str(weight))
            rows.nth(index).locator(".pour-start").fill((times or [""] * len(weights))[index])
        self.page.click("#applyPours")

    def test_only_remaining_reference_is_available(self):
        expect(self.page.locator("#preset option")).to_have_text(["Bourbon Lavado · Baseline"])
        expect(self.page.locator("#preset")).to_have_value("bourbon-lavado")
        expect(self.page.locator("#coffee")).to_have_value("Bourbon Lavado")
        expect(self.page.locator("#temp")).to_have_value("93")
        expect(self.page.locator("#waterOut")).to_have_text("240")

    def test_removed_reference_selection_falls_back_without_changing_saved_data(self):
        self.seed_legacy_data()
        for removed in ["bourbon-natural", "pacas-natural"]:
            with self.subTest(removed=removed):
                self.page.evaluate(
                    "id => localStorage.setItem('blossom-brew-selected-recipe-v1', JSON.stringify(id))",
                    removed,
                )
                self.page.reload()
                expect(self.page.locator("#preset option")).to_have_text([
                    "Bourbon Lavado · Baseline", LEGACY_RECIPE["name"],
                ])
                expect(self.page.locator("#preset")).to_have_value("bourbon-lavado")
                self.assertEqual(self.stored(RECIPE_KEY), [LEGACY_RECIPE])
                self.assertEqual(self.stored(SESSION_KEY), [LEGACY_SESSION])

    def test_target_water_and_scaled_pours(self):
        self.page.fill("#dose", "18")
        self.page.click("#matchRatio")
        expect(self.page.locator("#water")).to_have_value("288")
        expect(self.page.locator("#ratioOut")).to_have_text("1:16")
        expect(self.page.locator("#pours strong")).to_have_text([
            "54 g acumulados", "174 g acumulados", "288 g acumulados",
        ])
        expect(self.page.locator("#pours .mini")).to_have_text(["+54 g", "+120 g", "+114 g"])

    def test_manual_water_and_invalid_dose(self):
        self.page.fill("#water", "255")
        expect(self.page.locator("#ratioOut")).to_have_text("1:17")
        expect(self.page.locator("#waterOut")).to_have_text("240")
        self.page.fill("#dose", "0")
        expect(self.page.locator("#ratioOut")).to_have_text("—")
        self.page.click("#matchRatio")
        expect(self.page.locator("#water")).to_have_value("255")
        self.tab("journal")
        self.page.click("#saveSession")
        expect(self.page.locator("#count")).to_have_text("0 sesiones")

    def test_extraction_requires_measurements_and_demo_is_correct(self):
        self.tab("extraction")
        expect(self.page.locator("#ey")).to_have_text("— %")
        self.page.click("#demoEy")
        expect(self.page.locator("#ey")).to_have_text("19,88 %")
        expect(self.page.locator("#solubles")).to_have_text("Sólidos disueltos en taza: 2,98 g")
        self.page.fill("#tds", "31")
        expect(self.page.locator("#ey")).to_have_text("— %")
        self.page.fill("#tds", "")
        expect(self.page.locator("#ey")).to_have_text("— %")

    def test_journal_persists_and_does_not_invent_extraction(self):
        self.tab("journal")
        self.page.fill("#notes", "Naranja, chocolate y textura cremosa")
        self.page.click("#saveSession")
        expect(self.page.locator("#count")).to_have_text("1 sesión")
        self.assertIsNone(self.stored(SESSION_KEY)[0]["extraction"])
        self.page.reload()
        self.tab("journal")
        expect(self.page.locator("#sessions")).to_contain_text("Naranja, chocolate y textura cremosa")
        expect(self.page.locator("#sessions")).to_contain_text("EY no medido")

    def test_dose_mismatch_prevents_saving_until_synchronized(self):
        self.page.fill("#dose", "18")
        self.tab("extraction")
        self.page.click("#demoEy")
        self.tab("journal")
        self.page.click("#saveSession")
        expect(self.page.locator("#count")).to_have_text("0 sesiones")
        expect(self.page.locator("#toast")).to_contain_text("no coincide")
        self.tab("extraction")
        self.page.click("#syncDose")
        self.tab("journal")
        self.page.click("#saveSession")
        expect(self.page.locator("#count")).to_have_text("1 sesión")
        self.assertAlmostEqual(self.stored(SESSION_KEY)[0]["extraction"], 1.42 * 210 / 18)

    def test_custom_recipe_keeps_scaled_pours_after_reload(self):
        self.page.fill("#dose", "18")
        self.page.click("#matchRatio")
        self.page.fill("#recipeName", "Mi Bourbon 18 g")
        self.page.click("#saveRecipe")
        recipe = self.stored(RECIPE_KEY)[0]
        self.assertEqual(recipe["pours"], [54, 174, 288])
        self.page.reload()
        self.page.select_option("#preset", recipe["id"])
        expect(self.page.locator("#dose")).to_have_value("18")
        expect(self.page.locator("#pours strong")).to_have_text([
            "54 g acumulados", "174 g acumulados", "288 g acumulados",
        ])

    def test_existing_v1_recipes_and_sessions_remain_usable(self):
        self.seed_legacy_data()
        expect(self.page.locator("#preset option")).to_have_count(2)
        self.page.select_option("#preset", LEGACY_RECIPE["id"])
        expect(self.page.locator("#coffee")).to_have_value("Café de Julio")
        expect(self.page.locator("#waterOut")).to_have_text("288")
        self.tab("journal")
        expect(self.page.locator("#sessions")).to_contain_text("Respaldo anterior")
        self.assertEqual(self.stored(RECIPE_KEY), [LEGACY_RECIPE])
        self.assertEqual(self.stored(SESSION_KEY), [LEGACY_SESSION])

    def test_json_export_clear_and_import_restore_legacy_data(self):
        self.seed_legacy_data()
        self.tab("journal")
        backup_text = self.download_text("#exportJson")
        backup = json.loads(backup_text)
        self.assertEqual(backup["format"], "blossom-brew-lab-v1")
        self.assertEqual(backup["recipes"], [LEGACY_RECIPE])
        self.assertEqual(backup["sessions"], [LEGACY_SESSION])
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.click("#clearSessions")
        expect(self.page.locator("#count")).to_have_text("0 sesiones")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#fileImport").set_input_files({
            "name": "respaldo-v1.json", "mimeType": "application/json", "buffer": backup_text.encode(),
        })
        expect(self.page.locator("#count")).to_have_text("1 sesión")
        self.assertEqual(self.stored(RECIPE_KEY), [LEGACY_RECIPE])
        self.assertEqual(self.stored(SESSION_KEY), [LEGACY_SESSION])

    def test_csv_export_is_readable_with_accents_quotes_and_newlines(self):
        self.tab("journal")
        notes = 'Dulzor "alto", piña\nChocolate'
        self.page.fill("#notes", notes)
        self.page.click("#saveSession")
        rows = list(csv.reader(io.StringIO(self.download_text("#downloadCsv"))))
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(rows[1]), 29)
        self.assertEqual(rows[0][15:24], ["notas", "molino", "grosor_molienda", "vertidos_despues_bloom", "temperatura_2_C", "grosor_molienda_um", "tiempo_real_s", "inicios_reales_s", "temperaturas_vertidos_C"])
        self.assertEqual(rows[1][15], notes)
        self.assertEqual(rows[1][9:12], ["", "", ""])

    def test_invalid_or_cancelled_import_preserves_existing_data(self):
        self.seed_legacy_data()
        self.tab("journal")
        self.page.locator("#fileImport").set_input_files({
            "name": "dañado.json", "mimeType": "application/json", "buffer": b'{"invalido":true}',
        })
        expect(self.page.locator("#toast")).to_contain_text("No se pudo importar")
        self.assertEqual(self.stored(SESSION_KEY), [LEGACY_SESSION])
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        self.page.locator("#fileImport").set_input_files({
            "name": "vacio.json", "mimeType": "application/json",
            "buffer": b'{"format":"blossom-brew-lab-v1","recipes":[],"sessions":[]}',
        })
        # Wait until the asynchronous import handler has processed the file.
        expect(self.page.locator("#fileImport")).to_have_value("")
        self.assertEqual(self.stored(SESSION_KEY), [LEGACY_SESSION])

    def test_mobile_layout_and_tabs(self):
        self.page.set_viewport_size({"width": 375, "height": 812})
        for tab in ["recipe", "extraction", "journal"]:
            with self.subTest(tab=tab):
                self.tab(tab)
                self.assertTrue(self.page.evaluate(
                    "document.documentElement.scrollWidth <= window.innerWidth",
                ))

    def test_local_file_opens_without_network_and_calculates(self):
        # Blocking network requests proves local-file independence without
        # WebKit's offline emulation also disabling the file navigation itself.
        self.context.route("http://**/*", lambda route: route.abort())
        self.context.route("https://**/*", lambda route: route.abort())
        try:
            self.page.goto((ROOT / "index.html").as_uri())
        except Error as error:
            if "net::ERR_BLOCKED_BY_ADMINISTRATOR" in str(error):
                self.skipTest("La política del navegador administrado bloquea file://; no se altera esa política")
            if os.environ.get("BLOSSOM_BROWSER") == "webkit" and "internal error" in str(error):
                # Only classify this as a runner limitation if an independent,
                # minimal HTML file also fails. An application-only failure
                # must remain a failure of this test.
                with TemporaryDirectory(prefix="blossom-file-probe-") as directory:
                    minimal = Path(directory) / "probe.html"
                    minimal.write_text("<!doctype html><title>File probe</title><p>Local file</p>")
                    probe = self.context.new_page()
                    try:
                        probe.goto(minimal.as_uri())
                    except Error as minimal_error:
                        if "internal error" in str(minimal_error):
                            self.skipTest("El WebKit del runner no abre file:// ni con HTML mínimo; los flujos web siguen comprobándose")
                        raise
                    finally:
                        probe.close()
            raise
        expect(self.page.locator("#preset option")).to_have_count(1)
        self.page.fill("#dose", "18")
        self.page.click("#matchRatio")
        expect(self.page.locator("#water")).to_have_value("288")
        self.assertEqual(self.page.locator(".layout").first.evaluate(
            "element => getComputedStyle(element).display",
        ), "grid")

    def test_loaded_app_calculates_and_exports_without_network(self):
        self.context.set_offline(True)
        self.page.fill("#dose", "18")
        self.page.click("#matchRatio")
        expect(self.page.locator("#water")).to_have_value("288")
        self.tab("journal")
        self.page.fill("#notes", "Prueba sin conexión")
        self.page.click("#saveSession")
        expect(self.page.locator("#count")).to_have_text("1 sesión")
        backup = json.loads(self.download_text("#exportJson"))
        self.assertEqual(backup["sessions"][0]["water"], 288)
        self.assertEqual(backup["sessions"][0]["notes"], "Prueba sin conexión")

    def test_update_legacy_recipe_name_parameters_and_timed_pours(self):
        self.seed_legacy_data()
        self.page.select_option("#preset", LEGACY_RECIPE["id"])
        self.page.fill("#recipeName", "Julio · V60 actualizado")
        self.page.fill("#dose", "20")
        self.page.click("#matchRatio")
        self.page.fill("#temp", "90")
        self.edit_plan([60, 200, 320], ["0:00", "0:45", "1:30"])
        expect(self.page.locator("#pourEditor")).to_be_hidden()
        self.page.click("#updateRecipe")
        recipes = self.stored(RECIPE_KEY)
        self.assertEqual(len(recipes), 1)
        recipe = recipes[0]
        self.assertEqual(recipe["id"], LEGACY_RECIPE["id"])
        self.assertEqual(recipe["name"], "Julio · V60 actualizado")
        self.assertEqual(recipe["pours"], [60, 200, 320])
        self.assertEqual(recipe["pourTimes"], [0, 45, 90])
        self.page.reload()
        self.page.select_option("#preset", recipe["id"])
        expect(self.page.locator("#dose")).to_have_value("20")
        expect(self.page.locator("#water")).to_have_value("320")
        expect(self.page.locator("#temp")).to_have_value("90")
        expect(self.page.locator("#pours .pour-time")).to_have_text(["Inicio 0:00", "Inicio 0:45", "Inicio 1:30"])
        self.assertEqual(self.stored(SESSION_KEY), [LEGACY_SESSION])

    def test_reference_recipe_stays_original_after_saving_edited_copy(self):
        expect(self.page.locator("#updateRecipe")).to_be_disabled()
        expect(self.page.locator("#recipeNameField")).to_be_visible()
        expect(self.page.locator("#recipeName")).to_have_value("")
        self.edit_plan([50, 150, 240], ["0:00", "", "1:30"])
        expect(self.page.locator("#updateRecipe")).to_be_disabled()
        self.create_custom_recipe("Mi versión")
        self.page.select_option("#preset", "bourbon-lavado")
        expect(self.page.locator("#pours strong")).to_have_text([
            "45 g acumulados", "145 g acumulados", "240 g acumulados",
        ])
        expect(self.page.locator("#pours .pour-time")).to_have_count(0)

    def test_editor_rejects_invalid_weights_and_keeps_original_preview(self):
        self.page.click("#editPours")
        for weights in [[0, 145, 240], [45, 45, 240], [100, 90, 240], [45, 145, 241], [45, 145, 239]]:
            with self.subTest(weights=weights):
                for index, weight in enumerate(weights):
                    self.page.locator(".pour-weight").nth(index).fill(str(weight))
                self.page.click("#applyPours")
                expect(self.page.locator("#pourError")).to_be_visible()
                expect(self.page.locator("#pourEditor")).to_be_visible()
                expect(self.page.locator("#pours strong")).to_have_text([
                    "45 g acumulados", "145 g acumulados", "240 g acumulados",
                ])
        self.page.click("#cancelPours")
        expect(self.page.locator("#pourEditor")).to_be_hidden()
        self.assertIsNone(self.stored(RECIPE_KEY))

    def test_editor_rejects_bad_time_order_format_and_start_after_finish(self):
        self.page.click("#editPours")
        for times in [["0:00", "0:75", "1:30"], ["0:00", "1:00", "0:45"], ["0:00", "0:45", "2:47"]]:
            with self.subTest(times=times):
                for index, time in enumerate(times):
                    self.page.locator(".pour-start").nth(index).fill(time)
                self.page.click("#applyPours")
                expect(self.page.locator("#pourError")).to_be_visible()
                expect(self.page.locator("#pourEditor")).to_be_visible()
        self.assertIsNone(self.stored(RECIPE_KEY))

    def test_incomplete_recipe_editor_never_fills_unknown_pours_or_times(self):
        self.seed_incomplete_recipe()
        self.page.click("#editPours")
        expect(self.page.locator(".pour-row")).to_have_count(1)
        expect(self.page.locator(".pour-weight")).to_have_value("50")
        expect(self.page.locator(".pour-start")).to_have_value("")
        self.page.click("#applyPours")
        expect(self.page.locator("#pourError")).to_contain_text("último peso")
        self.page.click("#cancelPours")
        expect(self.page.locator("#pours strong")).to_have_text(["50 g", "190 g"])
        self.edit_plan([50, 150, 240], ["0:00", "0:45", ""])
        self.page.click("#updateRecipe")
        self.assertEqual(self.stored(RECIPE_KEY)[0]["pourTimes"], [0, 45, None])

    def test_scaling_preserves_times_and_journal_keeps_its_own_snapshot(self):
        self.edit_plan([45, 145, 240], ["0:00", "0:45", "1:30"])
        self.create_custom_recipe()
        self.page.fill("#dose", "18")
        self.page.click("#matchRatio")
        self.page.click("#updateRecipe")
        recipe = self.stored(RECIPE_KEY)[0]
        self.assertEqual(recipe["pours"], [54, 174, 288])
        self.assertEqual(recipe["pourTimes"], [0, 45, 90])
        self.tab("journal")
        self.page.click("#saveSession")
        session = self.stored(SESSION_KEY)[0]
        self.assertEqual(session["pours"], [54, 174, 288])
        self.assertEqual(session["pourTimes"], [0, 45, 90])
        self.page.locator(".session-plan summary").click()
        expect(self.page.locator(".session-plan li")).to_have_text([
            "54 g acumulados · inicio 0:00", "174 g acumulados · inicio 0:45", "288 g acumulados · inicio 1:30",
        ])
        self.tab("recipe")
        self.edit_plan([60, 180, 288], ["0:00", "0:50", "1:40"])
        self.page.click("#updateRecipe")
        self.assertEqual(self.stored(SESSION_KEY)[0], session)

    def test_timed_recipes_and_sessions_survive_json_round_trip(self):
        self.edit_plan([45, 145, 240], ["0:00", "", "1:30"])
        self.create_custom_recipe("Plan con un inicio desconocido")
        self.tab("journal")
        self.page.click("#saveSession")
        backup_text = self.download_text("#exportJson")
        backup = json.loads(backup_text)
        self.assertEqual(backup["recipes"][0]["pourTimes"], [0, None, 90])
        self.assertEqual(backup["sessions"][0]["pourTimes"], [0, None, 90])
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.click("#clearSessions")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#fileImport").set_input_files({
            "name": "plan.json", "mimeType": "application/json", "buffer": backup_text.encode(),
        })
        expect(self.page.locator("#count")).to_have_text("1 sesión")
        self.assertEqual(self.stored(RECIPE_KEY), backup["recipes"])
        self.assertEqual(self.stored(SESSION_KEY), backup["sessions"])
        self.tab("recipe")
        self.page.select_option("#preset", backup["recipes"][0]["id"])
        self.page.click("#editPours")
        expect(self.page.locator(".pour-start").nth(1)).to_have_value("")

    def test_failed_update_preserves_saved_data_and_keeps_edit_for_retry(self):
        self.create_custom_recipe()
        original = self.stored(RECIPE_KEY)
        self.page.evaluate("""() => {
            window.originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (key === 'blossom-brew-recipes-v1') throw new Error('QuotaExceededError');
                return window.originalSetItem.call(this, key, value);
            };
        }""")
        self.page.fill("#recipeName", "Edición pendiente")
        self.page.click("#updateRecipe")
        expect(self.page.locator("#toast")).to_contain_text("No se pudo guardar")
        self.assertEqual(self.stored(RECIPE_KEY), original)
        expect(self.page.locator("#recipeName")).to_have_value("Edición pendiente")
        expect(self.page.locator("#recipeStatus")).to_contain_text("Cambios sin guardar")
        self.page.evaluate("() => { Storage.prototype.setItem = window.originalSetItem; }")
        self.page.click("#updateRecipe")
        self.assertEqual(self.stored(RECIPE_KEY)[0]["id"], original[0]["id"])
        self.assertEqual(self.stored(RECIPE_KEY)[0]["name"], "Edición pendiente")

    def test_switching_recipe_can_cancel_or_confirm_discarding_edits(self):
        self.seed_incomplete_recipe(select=False)
        self.page.fill("#dose", "18")
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        self.page.select_option("#preset", INCOMPLETE_RECIPE["id"])
        expect(self.page.locator("#preset")).to_have_value("bourbon-lavado")
        expect(self.page.locator("#dose")).to_have_value("18")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.select_option("#preset", INCOMPLETE_RECIPE["id"])
        expect(self.page.locator("#preset")).to_have_value(INCOMPLETE_RECIPE["id"])
        expect(self.page.locator("#dose")).to_have_value("15")

    def test_open_plan_draft_blocks_recipe_and_session_save_until_applied_or_cancelled(self):
        self.page.click("#editPours")
        self.page.locator(".pour-weight").first.fill("50")
        self.page.click("#saveRecipe")
        expect(self.page.locator("#toast")).to_contain_text("Aplica o cancela")
        self.tab("journal")
        self.page.click("#saveSession")
        expect(self.page.locator("#count")).to_have_text("0 sesiones")
        self.tab("recipe")
        self.page.click("#cancelPours")
        expect(self.page.locator("#pours strong").first).to_have_text("45 g acumulados")

    def test_unchanged_open_plan_does_not_block_save(self):
        self.page.fill("#recipeName", "Editor abierto sin cambios")
        self.page.click("#editPours")
        self.page.click("#saveRecipe")
        expect(self.page.locator("#pourEditor")).to_be_hidden()
        expect(self.page.locator("#recipeFeedback")).to_contain_text("guardada en este navegador")
        self.assertEqual(self.stored(RECIPE_KEY)[0]["pours"], [45, 145, 240])

    def test_pending_plan_actions_are_visible_and_apply_allows_saving(self):
        self.page.fill("#recipeName", "Plan pendiente")
        self.page.fill("#temp2", "85")
        self.page.click("#editPours")
        self.page.locator(".pour-weight").first.fill("50")
        expect(self.page.locator("#reviewPours")).to_be_visible()
        self.page.click("#saveRecipe")
        expect(self.page.locator("#recipeFeedback")).to_contain_text("Aplicar plan")
        expect(self.page.locator("#applyPours")).to_be_focused()
        expect(self.page.locator("#applyPours")).to_be_in_viewport()
        self.assertIsNone(self.stored(RECIPE_KEY))
        self.page.click("#applyPours")
        expect(self.page.locator("#reviewPours")).to_be_hidden()
        self.page.click("#saveRecipe")
        saved = self.stored(RECIPE_KEY)[0]
        self.assertEqual(saved["pours"], [50, 145, 240])
        self.assertEqual(saved["temp2"], 85)
        self.assertEqual(saved["name"], "Plan pendiente")

    def test_pending_editor_can_be_cancelled_without_losing_other_recipe_fields(self):
        self.page.fill("#recipeName", "Conservar parámetros")
        self.page.fill("#temp2", "80")
        self.page.click("#editPours")
        self.page.locator(".pour-weight").first.fill("50")
        self.page.click("#saveRecipe")
        self.page.click("#cancelPours")
        expect(self.page.locator("#recipeFeedback")).to_be_hidden()
        self.page.click("#saveRecipe")
        saved = self.stored(RECIPE_KEY)[0]
        self.assertEqual(saved["pours"], [45, 145, 240])
        self.assertEqual(saved["temp2"], 80)

    def test_update_button_handles_pending_plan_edits(self):
        self.create_custom_recipe()
        self.page.click("#editPours")
        self.page.locator(".pour-weight").first.fill("50")
        expect(self.page.locator("#updateRecipe")).to_be_enabled()
        self.page.click("#updateRecipe")
        expect(self.page.locator("#applyPours")).to_be_focused()
        self.page.click("#applyPours")
        self.page.click("#updateRecipe")
        self.assertEqual(len(self.stored(RECIPE_KEY)), 1)
        self.assertEqual(self.stored(RECIPE_KEY)[0]["pours"], [50, 145, 240])

    def test_incompatible_new_backup_does_not_replace_legacy_data(self):
        self.seed_legacy_data()
        self.tab("journal")
        invalid = {**LEGACY_RECIPE, "pourTimes": [0, 90, 45]}
        self.page.locator("#fileImport").set_input_files({
            "name": "tiempos-invalidos.json", "mimeType": "application/json",
            "buffer": json.dumps({"format": "blossom-brew-lab-v1", "recipes": [invalid], "sessions": []}).encode(),
        })
        expect(self.page.locator("#toast")).to_contain_text("No se pudo importar")
        self.assertEqual(self.stored(RECIPE_KEY), [LEGACY_RECIPE])
        self.assertEqual(self.stored(SESSION_KEY), [LEGACY_SESSION])

    def test_mobile_editor_can_add_and_remove_rows_without_horizontal_scroll(self):
        self.page.set_viewport_size({"width": 320, "height": 740})
        self.page.click("#editPours")
        self.page.click("#addPour")
        expect(self.page.locator(".pour-row")).to_have_count(4)
        self.page.locator(".pour-row").last.locator(".pour-weight").fill("240")
        self.page.locator(".pour-row").nth(2).locator(".pour-weight").fill("200")
        self.page.click("#applyPours")
        expect(self.page.locator("#pourEditor")).to_be_hidden()
        expect(self.page.locator("#pours strong")).to_have_count(4)
        self.page.click("#editPours")
        self.page.locator(".pour-row").nth(2).locator(".remove-pour").click()
        self.page.click("#applyPours")
        expect(self.page.locator("#pours strong")).to_have_count(3)
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))

    def test_removing_all_times_or_the_whole_plan_clears_previous_metadata(self):
        self.edit_plan([45, 145, 240], ["0:00", "0:45", "1:30"])
        self.create_custom_recipe()
        self.edit_plan([45, 145, 240])
        self.page.click("#updateRecipe")
        self.assertNotIn("pourTimes", self.stored(RECIPE_KEY)[0])
        self.edit_plan([])
        self.page.click("#updateRecipe")
        saved = self.stored(RECIPE_KEY)[0]
        self.assertIsNone(saved["pours"])
        self.assertNotIn("bloomWater", saved)
        self.assertNotIn("pourTimes", saved)
        self.page.reload()
        self.page.select_option("#preset", saved["id"])
        expect(self.page.locator("#pours")).to_have_text("No hay un plan documentado de vertidos para esta receta.")

    def test_invalid_recipe_fields_do_not_replace_the_saved_recipe(self):
        self.create_custom_recipe()
        original = self.stored(RECIPE_KEY)
        for selector, value, restored in [
            ("#temp", "", "93"), ("#bloom", "", "45"),
            ("#bloom", "10.5", "45"), ("#time", "2:75", "2:47"),
            ("#recipeName", "   ", "Mi receta de prueba"),
        ]:
            with self.subTest(selector=selector, value=value):
                self.page.fill(selector, value)
                self.page.click("#updateRecipe")
                self.assertEqual(self.stored(RECIPE_KEY), original)
                self.page.fill(selector, restored)
        self.page.click("#updateRecipe")
        expect(self.page.locator("#recipeStatus")).not_to_contain_text("Cambios sin guardar")

    def test_grinder_choices_and_six_grind_sizes_without_assumed_conversion(self):
        expect(self.page.locator("#grinder option")).to_have_text([
            "Sin especificar", "Comandante C40", "Mazzer Philos I200D", "Otro molino",
        ])
        expect(self.page.locator("#grindSize option")).to_have_text([
            "Sin especificar", "Fina", "Media fina", "Media", "Media gruesa", "Gruesa", "Extra gruesa",
        ])
        self.seed_legacy_data()
        self.page.select_option("#preset", LEGACY_RECIPE["id"])
        expect(self.page.locator("#grinder")).to_have_value("")
        expect(self.page.locator("#grindSize")).to_have_value("")
        expect(self.page.locator("#grind")).to_have_value("120")
        expect(self.page.locator("#grindMicrons")).to_have_value("")
        expect(self.page.locator("#grindMicrons")).to_be_hidden()
        self.assertEqual(self.stored(RECIPE_KEY), [LEGACY_RECIPE])

    def test_grinder_and_size_persist_and_switching_model_clears_only_the_setting(self):
        self.page.select_option("#grinder", "Comandante C40")
        expect(self.page.locator("#grind")).to_have_value("")
        expect(self.page.locator("#grindLabel")).to_contain_text("clics")
        self.page.fill("#grind", "24 clics, configuración de prueba")
        self.page.select_option("#grindSize", "Media fina")
        recipe_id = self.create_custom_recipe("Receta con molino")
        self.page.reload()
        self.page.select_option("#preset", recipe_id)
        expect(self.page.locator("#grinder")).to_have_value("Comandante C40")
        expect(self.page.locator("#grindSize")).to_have_value("Media fina")
        expect(self.page.locator("#grind")).to_have_value("24 clics, configuración de prueba")
        self.tab("journal")
        self.page.click("#saveSession")
        session = self.stored(SESSION_KEY)[0]
        expect(self.page.locator(".grinding-summary")).to_contain_text("Comandante C40")
        expect(self.page.locator(".grinding-summary")).to_contain_text("Media fina")
        self.tab("recipe")
        self.page.select_option("#grinder", "Mazzer Philos I200D")
        expect(self.page.locator("#grindLabel")).to_contain_text("dial")
        expect(self.page.locator("#grind")).to_have_value("")
        expect(self.page.locator("#grindSize")).to_have_value("Media fina")
        self.page.fill("#grind", "116")
        self.page.click("#updateRecipe")
        self.assertEqual(self.stored(RECIPE_KEY)[0]["grinder"], "Mazzer Philos I200D")
        self.assertEqual(self.stored(SESSION_KEY)[0], session)

    def test_grinding_metadata_survives_json_and_is_exported_in_csv(self):
        self.page.select_option("#grinder", "Mazzer Philos I200D")
        self.page.select_option("#grindSize", "Media gruesa")
        self.page.fill("#grind", "116")
        self.create_custom_recipe("Philos de prueba")
        self.tab("journal")
        self.page.click("#saveSession")
        backup_text = self.download_text("#exportJson")
        backup = json.loads(backup_text)
        for data in [backup["recipes"][0], backup["sessions"][0]]:
            self.assertEqual(data["grinder"], "Mazzer Philos I200D")
            self.assertEqual(data["grindSize"], "Media gruesa")
            self.assertEqual(data["grind"], "116")
        rows = list(csv.reader(io.StringIO(self.download_text("#downloadCsv"))))
        self.assertEqual(rows[1][7], "116")
        self.assertEqual(rows[1][16:18], ["Mazzer Philos I200D", "Media gruesa"])
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#fileImport").set_input_files({
            "name": "molino.json", "mimeType": "application/json", "buffer": backup_text.encode(),
        })
        expect(self.page.locator("#toast")).to_contain_text("Respaldo importado con éxito")
        self.tab("recipe")
        self.page.select_option("#preset", backup["recipes"][0]["id"])
        expect(self.page.locator("#grinder")).to_have_value("Mazzer Philos I200D")
        expect(self.page.locator("#grindSize")).to_have_value("Media gruesa")
        expect(self.page.locator("#grind")).to_have_value("116")

    def test_other_grinder_can_be_named_and_is_safe_to_display(self):
        self.page.set_viewport_size({"width": 320, "height": 740})
        self.page.select_option("#grinder", "other")
        expect(self.page.locator("#otherGrinderField")).to_be_visible()
        self.page.click("#saveRecipe")
        expect(self.page.locator("#toast")).to_contain_text("marca y el modelo")
        name = '<img src=x onerror="window.injected=true">'
        self.page.fill("#otherGrinder", name)
        self.page.select_option("#grindSize", "Gruesa")
        self.page.fill("#grind", "Ajuste propio")
        recipe_id = self.create_custom_recipe("Otro molino")
        self.page.reload()
        self.page.select_option("#preset", recipe_id)
        expect(self.page.locator("#grinder")).to_have_value("other")
        expect(self.page.locator("#otherGrinder")).to_have_value(name)
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
        self.tab("journal")
        self.page.click("#saveSession")
        expect(self.page.locator(".grinding-summary")).to_contain_text(name)
        expect(self.page.locator(".grinding-summary img")).to_have_count(0)
        self.assertIsNone(self.page.evaluate("window.injected"))

    def test_all_grind_sizes_save_without_changing_the_numeric_setting(self):
        self.page.select_option("#grinder", "Comandante C40")
        self.page.fill("#grind", "24")
        self.create_custom_recipe()
        for size in ["Fina", "Media fina", "Media", "Media gruesa", "Gruesa", "Extra gruesa"]:
            with self.subTest(size=size):
                self.page.select_option("#grindSize", size)
                self.page.click("#updateRecipe")
                saved = self.stored(RECIPE_KEY)[0]
                self.assertEqual(saved["grindSize"], size)
                self.assertEqual(saved["grind"], "24")

    def test_microns_can_be_used_without_a_grind_category_and_keep_history(self):
        self.page.set_viewport_size({"width": 375, "height": 812})
        expect(self.page.locator("#grindingAdvanced summary")).to_have_text("Avanzado (opcional)")
        expect(self.page.locator("#grindMicrons")).to_be_hidden()
        self.page.click("#grindingAdvanced summary")
        expect(self.page.locator('label[for="grindMicrons"]')).to_have_text("Grosor de molienda en µm")
        self.page.fill("#grindMicrons", "700.5")
        recipe_id = self.create_custom_recipe("Receta en micrones")
        self.page.reload()
        expect(self.page.locator("#preset")).to_have_value(recipe_id)
        expect(self.page.locator("#grindMicrons")).to_be_visible()
        expect(self.page.locator("#grindMicrons")).to_have_value("700.5")
        expect(self.page.locator("#grindSize")).to_have_value("")
        expect(self.page.locator("#grinder")).to_have_value("")
        expect(self.page.locator("#grind")).to_have_value("116")
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.tab("journal")
        self.page.click("#saveSession")
        session = self.stored(SESSION_KEY)[0]
        self.assertEqual(session["grindMicrons"], 700.5)
        expect(self.page.locator(".grinding-summary")).to_contain_text("700,5 µm")
        self.tab("recipe")
        self.page.fill("#grindMicrons", "800")
        self.page.click("#updateRecipe")
        self.assertEqual(self.stored(RECIPE_KEY)[0]["grindMicrons"], 800)
        self.assertEqual(self.stored(SESSION_KEY)[0], session)

    def test_microns_survive_grinder_changes_and_json_csv_round_trip(self):
        self.page.click("#grindingAdvanced summary")
        self.page.fill("#grindMicrons", "650")
        self.page.select_option("#grinder", "Comandante C40")
        self.page.fill("#grind", "24")
        self.page.select_option("#grindSize", "Media fina")
        expect(self.page.locator("#grindMicrons")).to_have_value("650")
        recipe_id = self.create_custom_recipe("Referencia orientativa")
        self.tab("journal")
        self.page.click("#saveSession")
        text = self.download_text("#exportJson")
        backup = json.loads(text)
        for data in [backup["recipes"][0], backup["sessions"][0]]:
            self.assertEqual(data["grindMicrons"], 650)
        rows = list(csv.reader(io.StringIO(self.download_text("#downloadCsv"))))
        self.assertEqual(rows[0][20], "grosor_molienda_um")
        self.assertEqual(rows[1][20], "650")
        self.assertEqual(rows[1][7], "24")
        self.tab("recipe")
        self.page.fill("#grindMicrons", "900")
        self.page.click("#updateRecipe")
        self.tab("journal")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#fileImport").set_input_files({
            "name": "micrones.json", "mimeType": "application/json", "buffer": text.encode(),
        })
        expect(self.page.locator("#toast")).to_contain_text("Respaldo importado con éxito")
        self.tab("recipe")
        self.page.select_option("#preset", recipe_id)
        expect(self.page.locator("#grindMicrons")).to_have_value("650")
        expect(self.page.locator("#grindSize")).to_have_value("Media fina")

    def test_invalid_microns_reopen_advanced_without_overwriting_and_can_be_cleared(self):
        self.create_custom_recipe("Micrones opcionales")
        original = self.stored(RECIPE_KEY)
        self.assertIsNone(original[0]["grindMicrons"])
        self.page.click("#grindingAdvanced summary")
        for invalid in ["0", "-10"]:
            self.page.fill("#grindMicrons", invalid)
            self.page.click("#grindingAdvanced summary")
            self.page.click("#updateRecipe")
            expect(self.page.locator("#grindMicrons")).to_be_visible()
            expect(self.page.locator("#grindMicrons")).to_be_focused()
            expect(self.page.locator("#recipeFeedback")).to_contain_text("mayor que 0")
            self.assertEqual(self.stored(RECIPE_KEY), original)
        self.page.fill("#grindMicrons", "650")
        self.page.click("#updateRecipe")
        self.assertEqual(self.stored(RECIPE_KEY)[0]["grindMicrons"], 650)
        self.page.fill("#grindMicrons", "")
        self.page.click("#updateRecipe")
        self.assertIsNone(self.stored(RECIPE_KEY)[0]["grindMicrons"])
        self.page.reload()
        expect(self.page.locator("#grindMicrons")).to_have_value("")
        expect(self.page.locator("#grindMicrons")).to_be_hidden()
        self.tab("journal")
        self.page.click("#saveSession")
        expect(self.page.locator(".grinding-summary")).not_to_contain_text("µm")

    def test_new_methods_can_be_saved_reloaded_and_recorded(self):
        for method in ["Solo Spin", "Orea", "Paragon"]:
            with self.subTest(method=method):
                self.page.select_option("#method", method)
                recipe_id = self.create_custom_recipe(f"Receta {method}")
                self.page.reload()
                self.page.select_option("#preset", recipe_id)
                expect(self.page.locator("#method")).to_have_value(method)
                self.tab("journal")
                self.page.click("#saveSession")
                self.assertEqual(self.stored(SESSION_KEY)[0]["method"], method)
                rows = list(csv.reader(io.StringIO(self.download_text("#downloadCsv"))))
                self.assertEqual(rows[1][2], method)
                self.tab("recipe")

    def test_pour_count_is_after_bloom_and_unknown_for_incomplete_reference(self):
        self.assertTrue(self.page.locator("#bloom").evaluate(
            "element => element.parentElement.nextElementSibling.querySelector('#pourCount') !== null",
        ))
        expect(self.page.locator("#pourCount")).to_have_value("2")
        expect(self.page.locator("#pourCountHint")).to_contain_text("Sin incluir el bloom")
        self.seed_incomplete_recipe()
        expect(self.page.locator("#pourCount")).to_have_value("")
        self.assertEqual(self.stored(RECIPE_KEY), [INCOMPLETE_RECIPE])

    def test_applying_a_plan_updates_count_and_history_keeps_its_own_number(self):
        self.edit_plan([45, 110, 180, 240])
        expect(self.page.locator("#pourCount")).to_have_value("3")
        self.create_custom_recipe()
        self.assertEqual(self.stored(RECIPE_KEY)[0]["pourCount"], 3)
        self.tab("journal")
        self.page.click("#saveSession")
        self.assertEqual(self.stored(SESSION_KEY)[0]["pourCount"], 3)
        expect(self.page.locator(".pour-count-summary")).to_have_text("Vertidos después del bloom: 3")
        self.tab("recipe")
        self.edit_plan([45, 145, 240])
        expect(self.page.locator("#pourCount")).to_have_value("2")
        self.page.click("#updateRecipe")
        self.assertEqual(self.stored(SESSION_KEY)[0]["pourCount"], 3)

    def test_count_validation_prevents_invalid_or_inconsistent_recipe_updates(self):
        self.create_custom_recipe()
        original = self.stored(RECIPE_KEY)
        for count in ["-1", "1.5", "50", "3"]:
            with self.subTest(count=count):
                self.page.fill("#pourCount", count)
                self.page.click("#updateRecipe")
                self.assertEqual(self.stored(RECIPE_KEY), original)
                expect(self.page.locator("#pourCountHint")).not_to_contain_text("El plan actual tiene")
        self.page.fill("#pourCount", "")
        self.page.click("#updateRecipe")
        expect(self.page.locator("#pourCount")).to_have_value("2")
        self.assertEqual(self.stored(RECIPE_KEY)[0]["pourCount"], 2)

    def test_declared_count_survives_backup_without_inventing_pour_weights(self):
        self.seed_incomplete_recipe()
        self.page.fill("#pourCount", "3")
        self.page.click("#updateRecipe")
        recipe_id = INCOMPLETE_RECIPE["id"]
        self.page.reload()
        self.page.select_option("#preset", recipe_id)
        expect(self.page.locator("#pourCount")).to_have_value("3")
        self.page.click("#editPours")
        expect(self.page.locator(".pour-row")).to_have_count(1)
        expect(self.page.locator(".pour-weight")).to_have_value("50")
        self.page.click("#cancelPours")
        self.tab("journal")
        self.page.click("#saveSession")
        backup_text = self.download_text("#exportJson")
        backup = json.loads(backup_text)
        for data in [backup["recipes"][0], backup["sessions"][0]]:
            self.assertEqual(data["pourCount"], 3)
            self.assertIsNone(data["pours"])
            self.assertEqual(data["bloomWater"], 50)
        rows = list(csv.reader(io.StringIO(self.download_text("#downloadCsv"))))
        self.assertEqual(rows[1][18], "3")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#fileImport").set_input_files({
            "name": "vertidos.json", "mimeType": "application/json", "buffer": backup_text.encode(),
        })
        expect(self.page.locator("#toast")).to_contain_text("Respaldo importado con éxito")
        self.tab("recipe")
        self.page.select_option("#preset", recipe_id)
        expect(self.page.locator("#pourCount")).to_have_value("3")
        self.assertIsNone(self.stored(RECIPE_KEY)[0]["pours"])

    def test_two_temperatures_persist_in_recipe_session_and_backups(self):
        self.page.fill("#temp", "94")
        self.page.fill("#temp2", "85")
        expect(self.page.locator("#temp2Metric")).to_be_visible()
        expect(self.page.locator("#temp2Out")).to_have_text("85°")
        recipe_id = self.create_custom_recipe("Dos temperaturas")
        self.page.reload()
        expect(self.page.locator("#preset")).to_have_value(recipe_id)
        expect(self.page.locator("#temp")).to_have_value("94")
        expect(self.page.locator("#temp2")).to_have_value("85")
        self.tab("journal")
        self.page.click("#saveSession")
        expect(self.page.locator("#sessions")).to_contain_text("T1 94 °C · T2 85 °C")
        text = self.download_text("#exportJson")
        backup = json.loads(text)
        for data in [backup["recipes"][0], backup["sessions"][0]]:
            self.assertEqual(data["temp"], 94)
            self.assertEqual(data["temp2"], 85)
        rows = list(csv.reader(io.StringIO(self.download_text("#downloadCsv"))))
        self.assertEqual(rows[1][6], "94")
        self.assertEqual(rows[1][19], "85")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#fileImport").set_input_files({
            "name": "temperaturas.json", "mimeType": "application/json", "buffer": text.encode(),
        })
        expect(self.page.locator("#toast")).to_contain_text("Respaldo importado")
        self.tab("recipe")
        self.page.select_option("#preset", recipe_id)
        expect(self.page.locator("#temp2")).to_have_value("85")

    def test_optional_second_temperature_is_unknown_in_v1_and_can_be_zero_or_cleared(self):
        self.seed_legacy_data()
        self.page.select_option("#preset", LEGACY_RECIPE["id"])
        expect(self.page.locator("#temp")).to_have_value("91")
        expect(self.page.locator("#temp2")).to_have_value("")
        expect(self.page.locator("#temp2Metric")).to_be_hidden()
        for invalid in ["-1", "101"]:
            self.page.fill("#temp2", invalid)
            self.page.click("#updateRecipe")
            expect(self.page.locator("#recipeFeedback")).to_contain_text("temperatura 2")
            self.assertEqual(self.stored(RECIPE_KEY), [LEGACY_RECIPE])
        self.page.fill("#temp2", "0")
        self.page.click("#updateRecipe")
        self.assertEqual(self.stored(RECIPE_KEY)[0]["temp2"], 0)
        self.page.fill("#temp2", "")
        self.page.click("#updateRecipe")
        self.assertIsNone(self.stored(RECIPE_KEY)[0]["temp2"])

    def test_save_has_no_native_prompt_and_restores_selection_in_new_tab(self):
        self.page.evaluate("() => { window.prompt = () => { throw new Error('No debe usarse prompt'); }; }")
        recipe_id = self.create_custom_recipe("Guardado sin ventanas emergentes")
        expect(self.page.locator("#recipeFeedback")).to_contain_text("guardada en este navegador")
        self.page.reload()
        expect(self.page.locator("#preset")).to_have_value(recipe_id)
        new_tab = self.context.new_page()
        new_tab.goto(self.base_url)
        expect(new_tab.locator("#preset")).to_have_value(recipe_id)
        expect(new_tab.locator("#recipeName")).to_have_value("Guardado sin ventanas emergentes")

    def test_missing_name_shows_persistent_inline_error_and_can_be_corrected(self):
        expect(self.page.locator("#recipeNameField")).to_be_visible()
        self.page.click("#saveRecipe")
        expect(self.page.locator("#recipeFeedback")).to_contain_text("Escribe un nombre")
        expect(self.page.locator("#recipeName")).to_have_attribute("aria-invalid", "true")
        self.page.evaluate("document.getElementById('toast').style.display = 'none'")
        expect(self.page.locator("#recipeFeedback")).to_be_visible()
        self.assertIsNone(self.stored(RECIPE_KEY))
        self.create_custom_recipe("Nombre corregido")
        expect(self.page.locator("#recipeFeedback")).to_contain_text("guardada en este navegador")
        expect(self.page.locator("#recipeName")).not_to_have_attribute("aria-invalid", "true")

    def test_failed_save_offers_backup_of_pending_recipe_without_claiming_it_was_saved(self):
        self.page.fill("#recipeName", "Pendiente de guardar")
        self.page.fill("#temp2", "85")
        self.page.evaluate("""() => {
            window.originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function() { throw new Error('QuotaExceededError'); };
        }""")
        self.page.click("#saveRecipe")
        expect(self.page.locator("#recipeFeedback")).to_contain_text("No se pudo guardar")
        self.assertIsNone(self.stored(RECIPE_KEY))
        backup = json.loads(self.download_text("#downloadPendingRecipe"))
        self.assertEqual(backup["recipes"][0]["name"], "Pendiente de guardar")
        self.assertEqual(backup["recipes"][0]["temp2"], 85)
        self.page.evaluate("() => { Storage.prototype.setItem = window.originalSetItem; }")
        self.page.click("#saveRecipe")
        expect(self.page.locator("#recipeFeedback")).to_contain_text("guardada en este navegador")
        self.assertEqual(len(self.stored(RECIPE_KEY)), 1)

    def test_touch_mobile_can_save_without_dialog_and_recover_both_temperatures(self):
        context = self.browser.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, locale="es-ES",
        )
        self.addCleanup(context.close)
        page = context.new_page()
        page.goto(self.base_url)
        page.evaluate("() => { window.prompt = () => null; }")
        page.fill("#recipeName", "Prueba táctil")
        page.fill("#temp2", "80")
        page.locator("#saveRecipe").tap()
        expect(page.locator("#recipeFeedback")).to_contain_text("guardada en este navegador")
        page.reload()
        expect(page.locator("#recipeName")).to_have_value("Prueba táctil")
        expect(page.locator("#temp2")).to_have_value("80")
        self.assertTrue(page.evaluate("document.documentElement.scrollWidth <= innerWidth"))

    def test_delete_saved_recipe_requires_confirmation_and_persists_after_reload(self):
        expect(self.page.locator("#deleteRecipe")).to_be_disabled()
        self.page.evaluate("() => { window.confirm = () => { throw new Error('No native confirmation expected'); }; }")
        recipe_id = self.create_custom_recipe("Receta a eliminar")
        self.page.click("#deleteRecipe")
        expect(self.page.locator("#deleteRecipePanel")).to_be_visible()
        expect(self.page.locator("#deleteRecipeTitle")).to_contain_text("Receta a eliminar")
        self.assertEqual(self.stored(RECIPE_KEY)[0]["id"], recipe_id)
        self.page.click("#confirmDeleteRecipe")
        self.assertEqual(self.stored(RECIPE_KEY), [])
        expect(self.page.locator("#recipeFeedback")).to_contain_text("eliminada de este navegador")
        expect(self.page.locator("#preset")).to_have_value("bourbon-lavado")
        self.page.reload()
        expect(self.page.locator("#preset option")).to_have_count(1)
        expect(self.page.locator("#deleteRecipe")).to_be_disabled()

    def test_cancelling_deletion_preserves_unsaved_recipe_and_pour_edits(self):
        self.page.set_viewport_size({"width": 375, "height": 812})
        self.create_custom_recipe("Conservar esta receta")
        original = self.stored(RECIPE_KEY)
        self.page.fill("#recipeName", "Cambios pendientes")
        self.page.fill("#temp2", "85")
        self.page.click("#editPours")
        self.page.locator(".pour-weight").first.fill("50")
        self.page.click("#deleteRecipe")
        self.page.click("#cancelDeleteRecipe")
        expect(self.page.locator("#deleteRecipePanel")).to_be_hidden()
        expect(self.page.locator("#recipeName")).to_have_value("Cambios pendientes")
        expect(self.page.locator("#temp2")).to_have_value("85")
        expect(self.page.locator(".pour-weight").first).to_have_value("50")
        self.assertEqual(self.stored(RECIPE_KEY), original)
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))

    def test_deleting_recipe_keeps_other_recipes_and_historical_sessions(self):
        self.page.fill("#temp2", "85")
        first = self.create_custom_recipe("Primera receta")
        self.tab("journal")
        self.page.fill("#notes", "Sesión que se conserva")
        self.page.click("#saveSession")
        sessions = self.stored(SESSION_KEY)
        self.tab("recipe")
        second = self.create_custom_recipe("Segunda receta")
        self.page.select_option("#preset", first)
        self.page.click("#deleteRecipe")
        self.page.click("#confirmDeleteRecipe")
        self.assertEqual([r["id"] for r in self.stored(RECIPE_KEY)], [second])
        self.assertEqual(self.stored(SESSION_KEY), sessions)
        expect(self.page.locator("#preset")).to_have_value(second)
        self.page.reload()
        expect(self.page.locator("#preset")).to_have_value(second)
        self.tab("journal")
        expect(self.page.locator("#sessions")).to_contain_text("Sesión que se conserva")
        backup = json.loads(self.download_text("#exportJson"))
        self.assertEqual([r["id"] for r in backup["recipes"]], [second])
        self.assertEqual(backup["sessions"], sessions)

    def test_failed_deletion_keeps_recipe_and_can_be_retried(self):
        self.create_custom_recipe("Debe conservarse si falla")
        original = self.stored(RECIPE_KEY)
        self.page.evaluate("""() => {
            window.originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (key === 'blossom-brew-recipes-v1') throw new Error('QuotaExceededError');
                return window.originalSetItem.call(this, key, value);
            };
        }""")
        self.page.click("#deleteRecipe")
        self.page.click("#confirmDeleteRecipe")
        expect(self.page.locator("#recipeFeedback")).to_contain_text("No se pudo eliminar")
        self.assertEqual(self.stored(RECIPE_KEY), original)
        expect(self.page.locator("#deleteRecipePanel")).to_be_visible()
        self.page.evaluate("() => { Storage.prototype.setItem = window.originalSetItem; }")
        self.page.click("#confirmDeleteRecipe")
        self.assertEqual(self.stored(RECIPE_KEY), [])

    def test_changing_selected_recipe_cancels_the_pending_deletion(self):
        first = self.create_custom_recipe("Primera")
        second = self.create_custom_recipe("Segunda")
        self.page.select_option("#preset", first)
        self.page.click("#deleteRecipe")
        self.page.select_option("#preset", second)
        expect(self.page.locator("#deleteRecipePanel")).to_be_hidden()
        self.assertEqual(len(self.stored(RECIPE_KEY)), 2)

    def test_failed_import_does_not_partially_replace_existing_collections(self):
        self.seed_legacy_data()
        self.page.evaluate("""() => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (key === 'blossom-brew-sessions-v1') throw new Error('QuotaExceededError');
                return original.call(this, key, value);
            };
        }""")
        self.tab("journal")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#fileImport").set_input_files({
            "name": "otra-copia.json", "mimeType": "application/json",
            "buffer": json.dumps({"format": "blossom-brew-lab-v1", "recipes": [{**LEGACY_RECIPE, "name": "Otra receta"}], "sessions": []}).encode(),
        })
        expect(self.page.locator("#toast")).to_contain_text("No se pudo guardar el respaldo")
        self.assertEqual(self.stored(RECIPE_KEY), [LEGACY_RECIPE])
        self.assertEqual(self.stored(SESSION_KEY), [LEGACY_SESSION])

    def preparation_clock(self):
        self.page.clock.install(time=1_800_000_000_000)
        self.page.clock.pause_at(1_800_000_001_000)

    def test_guided_preparation_tracks_manual_pours_pause_and_real_time(self):
        self.edit_plan([45, 145, 240], ["0:00", "0:45", "1:30"])
        self.create_custom_recipe("Mi preparación guiada")
        self.preparation_clock()
        self.page.click("#prepareRecipe")
        expect(self.page.locator("#preparation")).to_be_visible()
        self.page.click("#brewStart")
        expect(self.page.locator("#brewAmount")).to_have_text("Añade 45 g")
        expect(self.page.locator("#brewBloom")).to_have_text("Bloom de referencia: 45 s.")
        expect(self.page.locator("#brewCumulative")).to_contain_text("45 g acumulados")
        self.page.clock.fast_forward(45000)
        expect(self.page.locator("#brewClock")).to_have_text("0:45")
        expect(self.page.locator("#brewCurrentLabel")).to_have_text("Bloom")
        expect(self.page.locator("#brewCue")).to_contain_text("Ya llegó el inicio previsto")
        self.page.click("#brewNext")
        expect(self.page.locator("#brewAmount")).to_have_text("Añade 100 g")
        expect(self.page.locator("#brewCumulative")).to_contain_text("145 g acumulados")
        self.page.clock.fast_forward(10000)
        self.page.click("#brewPause")
        self.page.clock.fast_forward(30000)
        expect(self.page.locator("#brewClock")).to_have_text("0:55")
        expect(self.page.locator("#brewNext")).to_be_disabled()
        self.page.click("#brewPause")
        self.page.clock.fast_forward(35000)
        self.page.click("#brewNext")
        expect(self.page.locator("#brewAmount")).to_have_text("Añade 95 g")
        self.page.clock.fast_forward(87000)
        self.page.click("#brewFinish")
        expect(self.page.locator("#brewResultSummary")).to_contain_text("2:57")
        self.page.fill("#brewResult_sweet", "8")
        self.page.fill("#brewResult_cup", "210")
        self.page.fill("#brewResult_tds", "1.42")
        self.page.fill("#brewResult_notes", "Dulce, repetir esta receta")
        self.page.click("#brewSave")
        expect(self.page.locator("#brewFeedback")).to_contain_text("Sesión guardada")
        session = self.stored(SESSION_KEY)[0]
        self.assertEqual(session["preparation"]["actualStarts"], [0, 45, 90])
        self.assertEqual(session["preparation"]["durationSeconds"], 177)
        self.assertEqual(session["pourTimes"], [0, 45, 90])
        self.assertEqual(session["time"], "2:47")
        self.assertEqual(session["score"], {"sweet": 8, "acid": None, "body": None})
        self.assertAlmostEqual(session["extraction"], 19.88)
        self.tab("journal")
        expect(self.page.locator("#sessions")).to_contain_text("Tiempo real 2:57")
        self.page.locator("#sessions summary").click()
        expect(self.page.locator("#sessions")).to_contain_text("inicio real 0:45 · 93 °C")
        backup = json.loads(self.download_text("#exportJson"))
        self.assertEqual(backup["sessions"][0], session)
        rows = list(csv.reader(io.StringIO(self.download_text("#downloadCsv"))))
        self.assertEqual(rows[1][21:24], ["177", "0 / 45 / 90", "93 / 93 / 93"])

    def test_guided_preparation_recovers_background_time_notes_and_immutable_recipe(self):
        self.create_custom_recipe("Receta para recuperar")
        self.preparation_clock()
        self.page.click("#prepareRecipe")
        self.page.click("#brewStart")
        self.page.clock.fast_forward(45000)
        self.page.reload()
        expect(self.page.locator("#preparation")).to_be_visible()
        expect(self.page.locator("#brewClock")).to_have_text("0:45")
        expect(self.page.locator("#brewFeedback")).to_contain_text("Recuperamos tu preparación")
        self.page.click("#brewNext")
        self.page.clock.fast_forward(45000)
        self.page.click("#brewNext")
        self.page.clock.fast_forward(60000)
        self.page.click("#brewFinish")
        self.page.fill("#brewResult_notes", "Evaluación pendiente de guardar")
        self.page.reload()
        expect(self.page.locator("#brewResult_notes")).to_have_value("Evaluación pendiente de guardar")
        self.tab("recipe")
        self.page.fill("#dose", "20")
        self.page.fill("#temp", "80")
        self.tab("preparation")
        self.page.click("#brewSave")
        session = self.stored(SESSION_KEY)[0]
        self.assertEqual(session["dose"], 15)
        self.assertEqual(session["temp"], 93)
        self.assertIsNone(session["extraction"])
        self.assertEqual(session["score"], {"sweet": None, "acid": None, "body": None})
        self.assertEqual(session["notes"], "Evaluación pendiente de guardar")

    def test_guided_preparation_requires_explicit_two_temperature_plan_on_mobile(self):
        self.page.set_viewport_size({"width": 375, "height": 812})
        self.page.fill("#temp2", "85")
        self.create_custom_recipe("Dos temperaturas para guiar")
        self.preparation_clock()
        self.page.click("#prepareRecipe")
        self.page.click("#brewStart")
        expect(self.page.locator("#brewFeedback")).to_contain_text("Selecciona la temperatura")
        expect(self.page.locator("#brewLive")).to_be_hidden()
        for i, value in enumerate(["1", "2", "2"]):
            self.page.select_option(f"#brewTemp{i}", value)
        self.page.reload()
        expect(self.page.locator("#brewTemp1")).to_have_value("2")
        self.page.click("#brewStart")
        expect(self.page.locator("#brewTemperature")).to_have_text("Usa agua a 93 °C")
        self.page.clock.fast_forward(45000)
        self.page.click("#brewNext")
        expect(self.page.locator("#brewTemperature")).to_have_text("Usa agua a 85 °C")
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.page.clock.fast_forward(45000)
        self.page.click("#brewNext")
        self.page.clock.fast_forward(60000)
        self.page.click("#brewFinish")
        self.page.click("#brewSave")
        self.assertEqual(self.stored(SESSION_KEY)[0]["preparation"]["temperatures"], [93, 85, 85])

    def test_guided_preparation_does_not_guess_missing_plan_and_discard_preserves_recipes(self):
        self.seed_incomplete_recipe()
        self.page.click("#prepareRecipe")
        expect(self.page.locator("#brewFeedback")).to_contain_text("necesita un plan completo")
        expect(self.page.locator("#brewContent")).to_be_hidden()
        self.tab("recipe")
        self.page.select_option("#preset", "bourbon-lavado")
        self.page.click("#prepareRecipe")
        self.page.click("#brewDiscard")
        self.page.click("#brewKeep")
        expect(self.page.locator("#brewContent")).to_be_visible()
        self.page.click("#brewDiscard")
        self.page.click("#brewConfirmDiscard")
        expect(self.page.locator("#brewContent")).to_be_hidden()
        self.assertEqual(self.stored(RECIPE_KEY), [INCOMPLETE_RECIPE])
        self.assertIsNone(self.stored(SESSION_KEY))

    def test_guided_result_storage_error_preserves_result_and_offers_backup(self):
        self.preparation_clock()
        self.page.click("#prepareRecipe")
        self.page.click("#brewStart")
        self.page.click("#brewNext")
        self.page.click("#brewNext")
        self.page.clock.fast_forward(10000)
        self.page.click("#brewFinish")
        self.page.fill("#brewResult_notes", "Conservar aunque falle el guardado")
        self.page.evaluate("""() => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (key === 'blossom-brew-sessions-v1') throw new Error('QuotaExceededError');
                return original.call(this, key, value);
            };
        }""")
        self.page.click("#brewSave")
        expect(self.page.locator("#brewFeedback")).to_contain_text("No se pudo guardar la sesión")
        expect(self.page.locator("#brewResult_notes")).to_have_value("Conservar aunque falle el guardado")
        backup = json.loads(self.download_text("#brewPendingBackup"))
        self.assertEqual(backup["sessions"][0]["preparation"]["durationSeconds"], 10)
        self.assertEqual(backup["sessions"][0]["notes"], "Conservar aunque falle el guardado")
        self.assertIsNone(self.stored(SESSION_KEY))

    def test_guided_result_retry_after_reload_does_not_duplicate_a_saved_session(self):
        self.preparation_clock()
        self.page.click("#prepareRecipe")
        self.page.click("#brewStart")
        self.page.click("#brewNext")
        self.page.click("#brewNext")
        self.page.clock.fast_forward(10000)
        self.page.click("#brewFinish")
        self.page.evaluate("""() => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (key === 'blossom-brew-preparation-v1' && value === 'null') throw new Error('test');
                return original.call(this, key, value);
            };
        }""")
        self.page.click("#brewSave")
        self.assertEqual(len(self.stored(SESSION_KEY)), 1)
        self.page.reload()
        self.page.click("#brewSave")
        self.assertEqual(len(self.stored(SESSION_KEY)), 1)

    def test_guided_result_syncs_between_devices_and_keeps_in_progress_draft_local(self):
        backend = self.enable_cloud()
        self.create_custom_recipe("Guía sincronizada")
        self.wait_cloud_saved()
        phone = self.cloud_phone(backend)
        self.page.click("#prepareRecipe")
        self.page.click("#brewStart")
        self.assertEqual(len([r for r in backend.records.values() if r["kind"] == "session"]), 0)
        phone.select_option("#preset", self.stored(RECIPE_KEY)[0]["id"])
        phone.fill("#dose", "20")
        phone.click("#updateRecipe")
        self.wait_cloud_saved(phone)
        self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        self.page.wait_for_function("JSON.parse(localStorage.getItem('blossom-brew-recipes-v1'))[0].dose === 20")
        expect(self.page.locator("#brewRecipeSummary")).to_contain_text("15 g de café")
        self.page.click("#brewNext")
        self.page.click("#brewNext")
        self.page.wait_for_timeout(1100)
        self.page.click("#brewFinish")
        self.page.fill("#brewResult_notes", "Resultado de preparación que viaja al teléfono")
        self.page.click("#brewSave")
        self.wait_cloud_saved()
        phone.evaluate("window.dispatchEvent(new Event('focus'))")
        self.wait_cloud_saved(phone)
        phone.locator('[data-tab="journal"]').click()
        expect(phone.locator("#sessions")).to_contain_text("Resultado de preparación que viaja al teléfono")
        expect(phone.locator("#sessions")).to_contain_text("Preparación guiada · Tiempo real")
        self.assertIsNone(phone.evaluate("JSON.parse(localStorage.getItem('blossom-brew-preparation-v1'))"))
        remote = phone.evaluate("JSON.parse(localStorage.getItem('blossom-brew-sessions-v1'))")[0]
        self.assertEqual(remote["dose"], 15)
        self.assertEqual(remote["preparation"], self.stored(SESSION_KEY)[0]["preparation"])

    def test_water_references_volume_and_sliders_match_the_shared_example(self):
        self.tab("waterLab")
        expect(self.page.locator("#waterPreset")).to_have_value("woc-budapest")
        expect(self.page.locator("#waterGH")).to_have_value("51.2")
        expect(self.page.locator("#waterAlkalinity")).to_have_value("40.1")
        self.page.click('[data-water-volume="4.5"]')
        expect(self.page.locator("#waterAmount_buffer")).to_have_text("180,5 g")
        expect(self.page.locator("#waterAmount_hardness")).to_have_text("230,4 g")
        expect(self.page.locator("#waterAmount_distilled")).to_have_text("4089,1 g")
        expect(self.page.locator("#waterAmount_total")).to_have_text("4500,0 g")
        self.page.locator("#waterGHRange").focus()
        self.page.locator("#waterGHRange").press("ArrowRight")
        expect(self.page.locator("#waterGH")).to_have_value("51.3")
        expect(self.page.locator("#waterPreset")).to_have_value("custom")
        expect(self.page.locator("#waterName")).to_have_value("Agua personalizada")
        self.page.reload()
        self.tab("waterLab")
        expect(self.page.locator("#waterGH")).to_have_value("51.3")
        expect(self.page.locator("#waterLiters")).to_have_value("4.5")
        self.page.select_option("#waterPreset", "sca-bh-2019")
        expect(self.page.locator("#waterGH")).to_have_value("69")

    def test_water_invalid_targets_clear_results_and_do_not_offer_negative_masses(self):
        self.tab("waterLab")
        self.page.fill("#waterGH", "800")
        self.page.fill("#waterAlkalinity", "300")
        expect(self.page.locator("#waterFeedback")).to_contain_text("más concentrados")
        expect(self.page.locator("#waterAmount_distilled")).to_have_text("—")
        expect(self.page.locator("#waterApply")).to_be_disabled()
        expect(self.page.locator("#waterCopy")).to_be_disabled()
        self.page.fill("#waterGH", "70")
        self.page.fill("#waterAlkalinity", "40")
        expect(self.page.locator("#waterAmount_distilled")).to_have_text("890,0 g")
        self.page.fill("#waterLiters", "")
        expect(self.page.locator("#waterDownload")).to_be_disabled()
        expect(self.page.locator("#waterAmount_buffer")).to_have_text("—")

    def test_water_profiles_persist_in_recipes_sessions_and_json_and_removal_keeps_history(self):
        self.tab("waterLab")
        self.page.fill("#waterGH", "70")
        self.page.fill("#waterAlkalinity", "40")
        self.page.fill("#waterName", "Mi agua para filtrados")
        self.page.click("#waterApply")
        expect(self.page.locator("#recipe")).to_be_visible()
        expect(self.page.locator("#recipeFeedback")).to_contain_text("Guarda una receta nueva")
        recipe_id = self.create_custom_recipe("Receta con mi agua")
        profile = self.stored(RECIPE_KEY)[0]["waterProfile"]
        self.page.reload()
        expect(self.page.locator("#recipeWaterSummary")).to_contain_text("Mi agua para filtrados")
        self.tab("journal")
        self.page.click("#saveSession")
        expect(self.page.locator("#sessions .water-summary")).to_contain_text("GH ≈ 70 · Alcalinidad ≈ 40")
        backup = self.download_text("#exportJson")
        self.assertEqual(json.loads(backup)["sessions"][0]["waterProfile"], profile)
        rows = list(csv.reader(io.StringIO(self.download_text("#downloadCsv"))))
        self.assertEqual(rows[1][24:], ["Mi agua para filtrados", "70", "40", "1", "bh-1.68-2.45-v1"])
        self.tab("recipe")
        self.page.click("#removeRecipeWater")
        self.page.click("#updateRecipe")
        self.assertNotIn("waterProfile", self.stored(RECIPE_KEY)[0])
        self.assertEqual(self.stored(SESSION_KEY)[0]["waterProfile"], profile)
        self.tab("waterLab")
        expect(self.page.locator("#waterPreset")).to_contain_text("Mi agua para filtrados · GH 70,0 / KH 40,0")
        self.tab("journal")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#fileImport").set_input_files({"name": "agua.json", "mimeType": "application/json", "buffer": backup.encode()})
        expect(self.page.locator("#toast")).to_contain_text("Respaldo importado con éxito")
        self.tab("recipe")
        self.page.select_option("#preset", recipe_id)
        expect(self.page.locator("#recipeWaterSummary")).to_contain_text("Mi agua para filtrados")

    def test_water_guided_session_keeps_the_water_used_when_recipe_water_changes(self):
        self.tab("waterLab")
        self.page.fill("#waterGH", "70")
        self.page.fill("#waterAlkalinity", "40")
        self.page.fill("#waterName", "Agua original")
        self.page.click("#waterApply")
        self.create_custom_recipe("Con agua original")
        self.preparation_clock()
        self.page.click("#prepareRecipe")
        expect(self.page.locator("#brewWaterProfile")).to_contain_text("Agua original")
        self.page.click("#brewStart")
        self.page.click("#brewNext")
        self.page.click("#brewNext")
        self.page.clock.fast_forward(10000)
        self.page.click("#brewFinish")
        self.tab("waterLab")
        self.page.fill("#waterAlkalinity", "60")
        self.page.fill("#waterName", "Agua siguiente")
        self.page.click("#waterApply")
        self.page.click("#updateRecipe")
        self.tab("preparation")
        self.page.click("#brewSave")
        self.assertEqual(self.stored(SESSION_KEY)[0]["waterProfile"]["alkalinity"], 40)
        self.assertEqual(self.stored(RECIPE_KEY)[0]["waterProfile"]["alkalinity"], 60)

    def test_water_copy_fallback_and_download_include_ingredients_and_units(self):
        self.tab("waterLab")
        self.page.fill("#waterLiters", "1.25")
        self.page.evaluate("""Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: {writeText: async () => {throw new Error('Denied in test')}}
        })""")
        self.page.click("#waterCopy")
        expect(self.page.locator("#waterCopyText")).to_be_visible()
        text = self.page.locator("#waterCopyText").input_value()
        self.assertIn("1,25 L", text)
        self.assertIn("NaHCO₃ a 1.68 g/L", text)
        self.assertIn("MgSO₄·7H₂O a 2.45 g/L", text)
        self.assertEqual(self.download_text("#waterDownload"), text)

    def test_water_profile_syncs_to_mobile_and_remote_changes_keep_session_water(self):
        backend = self.enable_cloud()
        recipe_id = self.create_custom_recipe("Café y agua sincronizados")
        self.wait_cloud_saved()
        self.tab("waterLab")
        self.page.fill("#waterGH", "70")
        self.page.fill("#waterAlkalinity", "40")
        self.page.fill("#waterName", "Agua sincronizada")
        self.page.click("#waterApply")
        self.page.click("#updateRecipe")
        self.wait_cloud_saved()
        self.tab("journal")
        self.page.click("#saveSession")
        self.wait_cloud_saved()
        phone = self.cloud_phone(backend)
        phone.select_option("#preset", recipe_id)
        expect(phone.locator("#recipeWaterSummary")).to_contain_text("Agua sincronizada")
        phone.click("#editRecipeWater")
        expect(phone.locator("#waterGH")).to_have_value("70")
        self.assertTrue(phone.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        phone.fill("#waterAlkalinity", "60")
        phone.click("#waterApply")
        phone.click("#updateRecipe")
        self.wait_cloud_saved(phone)
        self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        self.page.wait_for_function("JSON.parse(localStorage.getItem('blossom-brew-recipes-v1'))[0].waterProfile.alkalinity === 60")
        self.assertEqual(self.stored(SESSION_KEY)[0]["waterProfile"]["alkalinity"], 40)

    def test_design_preview_scales_recipe_and_pours_without_changing_saved_data(self):
        self.seed_legacy_data()
        before = self.page.evaluate("Object.fromEntries(Object.entries(localStorage))")
        self.page.goto(self.base_url + "concepto/")
        self.page.fill("#dose", "18")
        expect(self.page.locator("#water")).to_have_value("288")
        expect(self.page.locator("#ratioResult")).to_have_text("1:16")
        expect(self.page.locator(".pour-total")).to_have_text(["Hasta 54 g", "Hasta 174 g", "Hasta 288 g"])
        self.page.fill("#water", "300")
        expect(self.page.locator("#ratioResult")).to_have_text("1:16,67")
        self.page.fill("#dose", "0")
        expect(self.page.locator("#copyRecipe")).to_be_disabled()
        expect(self.page.locator("#ratioResult")).to_have_text("—")
        self.page.click("#resetRecipe")
        expect(self.page.locator("#water")).to_have_value("240")
        self.assertEqual(self.page.evaluate("Object.fromEntries(Object.entries(localStorage))"), before)

    def test_design_preview_copy_fallback_preserves_two_temperatures_and_units(self):
        self.page.goto(self.base_url + "concepto/")
        self.page.locator(".optional-temperature summary").click()
        self.page.fill("#temperature2", "85")
        expect(self.page.locator("#secondTempResult")).to_contain_text("85 °C")
        self.page.evaluate("""Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: {writeText: async () => {throw new Error('Denied in test')}}
        })""")
        self.page.click("#copyRecipe")
        expect(self.page.locator("#copyFallback")).to_be_visible()
        text = self.page.locator("#copyFallback").input_value()
        self.assertIn("Temperatura 2: 85 °C", text)
        self.assertIn("hasta 240 g acumulados", text)
        self.assertIn("Molino: sin especificar", text)
        self.assertEqual(self.page.locator(".account-link").get_attribute("href"), "../")

    def test_design_preview_loads_fonts_and_photo_on_desktop_and_mobile(self):
        for width in [320, 375, 768, 1440]:
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 900})
                self.page.goto(self.base_url + "concepto/")
                self.page.evaluate("document.fonts.ready")
                self.page.wait_for_function("document.querySelector('.hero-photo').complete && document.querySelector('.hero-photo').naturalWidth > 0")
                self.assertTrue(self.page.evaluate("document.fonts.check('14px Manrope') && document.fonts.check('italic 40px Cormorant')"))
                self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
                if width <= 730:
                    self.assertGreaterEqual(self.page.locator("#dose").evaluate("el => parseFloat(getComputedStyle(el).fontSize)"), 16)

    def test_editorial_recipe_summary_is_compact_and_does_not_follow_scrolling(self):
        self.page.evaluate("document.fonts.ready")
        self.page.click(".hero-cta")
        card = self.page.locator(".recipe-metrics")
        initial = card.bounding_box()
        self.assertLessEqual(initial["width"], 340)
        # The complete card now includes the bloom/pours and the water profile.
        self.assertLessEqual(initial["height"], 660)
        self.assertEqual(card.evaluate("el => getComputedStyle(el).position"), "static")
        self.assertEqual(self.page.locator(".recipe-results").evaluate("el => getComputedStyle(el).position"), "static")
        self.page.fill("#temp2", "85")
        self.assertLessEqual(card.bounding_box()["height"], 700)
        self.page.evaluate("window.scrollBy(0, 350)")
        self.assertLess(card.bounding_box()["y"], initial["y"] - 200)

    def test_recipe_card_tracks_applied_pours_times_names_and_recipe_selection(self):
        rows = self.page.locator("#recipeCardPours tr")
        expect(rows.locator("th")).to_have_text(["Bloom", "Vertido 1", "Vertido 2"])
        expect(rows.locator("td:last-child")).to_have_text(["45 g", "145 g", "240 g"])
        self.edit_plan([50, 150, 240], ["0:00", "0:45", "1:35"])
        expect(rows.locator("small")).to_have_text(["Inicio 0:00", "Inicio 0:45", "Inicio 1:35"])
        self.page.fill("#dose", "18")
        self.page.click("#matchRatio")
        expect(rows.locator("td:nth-child(2)")).to_have_text(["+60 g", "+120 g", "+108 g"])
        expect(rows.locator("td:last-child")).to_have_text(["60 g", "180 g", "288 g"])
        expect(self.page.locator("#recipeCardWaterTotal")).to_have_text("288 g total")
        self.page.fill("#water", "300")
        expect(self.page.locator("#waterOut")).to_have_text("288")
        expect(self.page.locator("#recipeCardWaterTotal")).to_have_text("300 g total")
        expect(rows.locator("td:last-child")).to_have_text(["62,5 g", "187,5 g", "300 g"])
        name = "Mi café <floral> & dulce"
        self.page.fill("#recipeName", name)
        expect(self.page.locator("#recipeCardName")).to_have_text(name)
        self.assertEqual(self.page.locator("#recipeCardName floral").count(), 0)
        recipe_id = self.create_custom_recipe(name)
        self.page.select_option("#preset", "bourbon-lavado")
        expect(rows.locator("td:last-child")).to_have_text(["45 g", "145 g", "240 g"])
        self.page.select_option("#preset", recipe_id)
        expect(self.page.locator("#recipeCardName")).to_have_text(name)
        expect(rows.locator("td:last-child")).to_have_text(["62,5 g", "187,5 g", "300 g"])
        expect(rows.locator("small")).to_have_text(["Inicio 0:00", "Inicio 0:45", "Inicio 1:35"])

    def test_recipe_card_does_not_invent_missing_pours_or_keep_invalid_totals(self):
        self.seed_incomplete_recipe()
        expect(self.page.locator("#recipeCardPours tr")).to_have_count(1)
        expect(self.page.locator("#recipeCardPours th")).to_have_text("Bloom")
        expect(self.page.locator("#recipeCardPourNote")).to_contain_text("190 g, sin distribuir")
        self.assertEqual(self.page.locator("#recipeCardPours small").count(), 0)
        self.page.fill("#water", "")
        expect(self.page.locator("#recipeCardPours tr")).to_have_count(0)
        expect(self.page.locator("#recipeCardPourScroll")).not_to_be_visible()
        expect(self.page.locator("#recipeCardWaterTotal")).to_have_text("")
        self.page.fill("#water", "240")
        self.edit_plan([])
        expect(self.page.locator("#recipeCardPours tr")).to_have_count(0)
        expect(self.page.locator("#recipeCardPourNote")).to_contain_text("Sin plan de vertidos documentado")

    def test_recipe_water_block_applies_and_recovers_a_readable_five_liter_recipe(self):
        self.assertTrue(self.page.locator("#recipeWater").evaluate("el => el.previousElementSibling.id === 'grindingAdvanced'"))
        expect(self.page.locator("#recipeCardWaterName")).to_have_text("Sin perfil registrado.")
        self.page.locator("#recipeWater > summary").click()
        self.page.click("#editRecipeWater")
        expect(self.page.locator("#waterLab")).to_be_visible()
        self.page.fill("#waterGH", "70")
        self.page.fill("#waterAlkalinity", "40")
        self.page.fill("#waterLiters", "5")
        self.page.fill("#waterName", "Agua floral de 5 litros")
        self.page.click("#waterApply")
        self.assertTrue(self.page.locator("#recipeWater").evaluate("el => el.open"))
        expect(self.page.locator("#recipeWaterSummary")).to_contain_text("Lote de agua 5 L")
        for field, amount in [("Buffer", "200 g"), ("Hardness", "350 g"), ("Distilled", "4450 g"), ("Total", "5000 g")]:
            expect(self.page.locator("#recipeWater" + field)).to_have_text(amount)
        expect(self.page.locator("#recipeCardWaterName")).to_have_text("Agua floral de 5 litros")
        expect(self.page.locator("#recipeCardWaterProfile")).to_contain_text("GH ≈ 70 · Alcalinidad ≈ 40 ppm como CaCO₃")
        self.create_custom_recipe("Mi café con agua floral")
        self.page.reload()
        expect(self.page.locator("#recipeWaterDistilled")).to_be_visible()
        expect(self.page.locator("#recipeWaterDistilled")).to_have_text("4450 g")
        self.page.click("#removeRecipeWater")
        self.page.click("#updateRecipe")
        expect(self.page.locator("#recipeCardWaterName")).to_have_text("Sin perfil registrado.")
        expect(self.page.locator("#recipeCardWaterProfile")).not_to_be_visible()
        self.assertNotIn("waterProfile", self.stored(RECIPE_KEY)[0])

    def test_recipe_card_long_plans_remain_bounded_and_tabs_match_the_top_strip(self):
        recipe = {**LEGACY_RECIPE, "pours": list(range(24, 289, 24))}
        self.page.evaluate("r => localStorage.setItem('blossom-brew-recipes-v1', JSON.stringify([r]))", recipe)
        self.page.reload()
        self.page.select_option("#preset", recipe["id"])
        expect(self.page.locator("#recipeCardPours tr")).to_have_count(12)
        self.page.evaluate("document.fonts.ready")
        self.assertLessEqual(self.page.locator("#recipeCardPourScroll").bounding_box()["height"], 212)
        self.assertTrue(self.page.locator("#recipeCardPourScroll").evaluate("el => el.scrollHeight > el.clientHeight"))
        self.assertEqual(self.page.locator(".tabs").evaluate("el => getComputedStyle(el).backgroundColor"),
                         self.page.locator(".announcement").evaluate("el => getComputedStyle(el).backgroundColor"))
        for width in [320, 375, 768, 1440]:
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 900})
                self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
                self.assertLessEqual(self.page.locator("#recipeCardPourScroll").bounding_box()["height"], 212)

    def test_editorial_header_links_activate_real_sections_and_preserve_edits(self):
        self.page.fill("#dose", "18")
        self.page.click('.header-nav [data-open-tab="waterLab"]')
        expect(self.page.locator("#waterLab")).to_be_visible()
        expect(self.page.locator("#workspaceTitle")).to_have_text("Diseña tu agua.")
        expect(self.page.locator('[data-tab="waterLab"]')).to_have_attribute("aria-pressed", "true")
        self.page.click(".hero-cta")
        expect(self.page.locator("#recipe")).to_be_visible()
        expect(self.page.locator("#workspaceTitle")).to_have_text("Diseña tu preparación.")
        expect(self.page.locator("#dose")).to_have_value("18")
        expect(self.page.locator('[data-tab="waterLab"]')).to_have_attribute("aria-pressed", "false")

    def test_editorial_all_five_sections_fit_mobile_and_keep_existing_records(self):
        self.seed_legacy_data()
        for width in [320, 375, 768, 1440]:
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 900})
                self.page.evaluate("document.fonts.ready")
                for tab in ["recipe", "preparation", "extraction", "journal", "waterLab"]:
                    self.tab(tab)
                    self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, tab))
                self.assertEqual(self.stored(RECIPE_KEY), [LEGACY_RECIPE])
                self.assertEqual(self.stored(SESSION_KEY), [LEGACY_SESSION])
        self.page.set_viewport_size({"width": 375, "height": 812})
        self.tab("recipe")
        self.assertGreaterEqual(self.page.locator("#dose").evaluate("el => parseFloat(getComputedStyle(el).fontSize)"), 16)

    def test_editorial_header_reports_actual_sync_and_signout_state(self):
        backend = self.enable_cloud()
        expect(self.page.locator("#accountShortcut")).to_be_visible()
        expect(self.page.locator("#headerSync")).to_have_text("Sincronizado")
        backend.offline = True
        self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(self.page.locator("#headerSync")).to_have_text("Revisar cuenta")
        backend.offline = False
        self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(self.page.locator("#headerSync")).to_have_text("Sincronizado")
        self.page.click("#cloudSignOut")
        expect(self.page.locator("#accountShortcutLabel")).to_have_text("Entrar")
        expect(self.page.locator("#headerSync")).to_have_text("Acceso opcional")

    def public_visitor(self, backend, authenticated=False):
        context = self.browser.new_context(locale="es-ES", viewport={"width": 375, "height": 812})
        self.addCleanup(context.close)
        backend.attach(context, authenticated=authenticated)
        page = context.new_page()
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.goto(self.base_url + "recetario/")
        expect(page.locator("#publicPreset option")).not_to_have_count(0)
        return page

    def test_public_catalogue_owner_can_publish_update_and_withdraw_only_chosen_recipes(self):
        backend = self.enable_cloud()
        self.tab("waterLab")
        self.page.fill("#waterGH", "70")
        self.page.fill("#waterAlkalinity", "40")
        self.page.fill("#waterLiters", "5")
        self.page.fill("#waterName", "Agua para compartir")
        self.page.click("#waterApply")
        recipe_id = self.create_custom_recipe("V60 público <floral>")
        self.wait_cloud_saved()
        expect(self.page.locator("#publishRecipe")).to_be_enabled()
        self.page.click("#publishRecipe")
        expect(self.page.locator("#publicationStatus")).to_contain_text("Receta publicada")
        self.create_custom_recipe("Receta que permanece privada")
        self.wait_cloud_saved()
        visitor = self.public_visitor(backend)
        expect(visitor.locator("#publicRecipeName")).to_have_text("V60 público <floral>")
        self.assertEqual(visitor.locator("#publicRecipeName floral").count(), 0)
        expect(visitor.locator("#publicPreset")).not_to_contain_text("permanece privada")
        expect(visitor.locator("#publicWaterSummary")).to_contain_text("Agua para compartir")
        visitor.locator("#publicWaterDetails summary").click()
        expect(visitor.locator("#publicWaterRecipe")).to_contain_text("4450 g")
        visitor.fill("#publicDose", "18")
        expect(visitor.locator("#publicWaterOut")).to_have_text("288")
        expect(visitor.locator("#publicPours td:last-child")).to_have_text(["54 g", "174 g", "288 g"])
        self.assertEqual(backend.records[("recipe", recipe_id)]["payload"]["dose"], 15)
        self.page.select_option("#preset", recipe_id)
        self.page.fill("#recipeName", "V60 público actualizado")
        expect(self.page.locator("#publishRecipe")).to_be_disabled()
        self.page.click("#updateRecipe")
        self.wait_cloud_saved()
        visitor.click("#reloadCatalogue")
        expect(visitor.locator("#publicRecipeName")).to_have_text("V60 público <floral>")
        self.page.click("#publishRecipe")
        expect(self.page.locator("#publicationStatus")).to_contain_text("Receta publicada")
        visitor.click("#reloadCatalogue")
        expect(visitor.locator("#publicRecipeName")).to_have_text("V60 público actualizado")
        self.page.click("#withdrawRecipe")
        expect(self.page.locator("#publicationStatus")).to_contain_text("Tu receta personal se conserva")
        visitor.click("#reloadCatalogue")
        expect(visitor.locator("#publicPreset option")).to_have_count(1)
        expect(visitor.locator("#publicPreset")).not_to_contain_text("V60 público")
        self.assertEqual(len(self.stored(RECIPE_KEY)), 2)

    def test_public_catalogue_is_anonymous_and_does_not_read_or_write_private_storage(self):
        backend = MockCloud()
        backend.attach(self.context, authenticated=False)
        self.seed_legacy_data()
        self.page.evaluate("localStorage.setItem('blossom-brew-cloud-auth-v1', JSON.stringify({access_token:'private-token',refresh_token:'private-refresh',user:{id:'private-account'}}))")
        before = self.page.evaluate("Object.fromEntries(Object.entries(localStorage))")
        backend.calls.clear()
        backend.catalogue_calls.clear()
        self.page.goto(self.base_url + "recetario/")
        expect(self.page.locator("#publicPreset option")).to_have_count(1)
        self.assertNotIn(LEGACY_RECIPE["name"], self.page.locator("body").inner_text())
        self.assertEqual(self.page.locator("#saveRecipe, #updateRecipe, #deleteRecipe, #publicationPanel, #cloudSignIn, #sessions").count(), 0)
        self.page.fill("#publicDose", "18")
        self.page.locator('[data-public-tab="extraction"]').first.click()
        self.page.fill("#guestEyCup", "213")
        self.page.fill("#guestEyTds", "1.40")
        expect(self.page.locator("#guestEyResult")).to_have_text("16,57 %")
        expect(self.page.locator("#guestEyStatus")).to_contain_text("2,98 g")
        self.page.locator('[data-public-tab="water"]').first.click()
        self.page.fill("#guestWaterGh", "70")
        self.page.fill("#guestWaterAlkalinity", "40")
        self.page.fill("#guestWaterLiters", "5")
        expect(self.page.locator("#guestWaterAmounts")).to_contain_text("4450 g")
        self.assertEqual(self.page.evaluate("Object.fromEntries(Object.entries(localStorage))"), before)
        self.assertEqual(backend.calls, [])
        self.assertTrue(backend.catalogue_calls)
        self.assertTrue(all(call["authorization"] is None and call["path"].endswith("blossom_public_catalogue") for call in backend.catalogue_calls))

    def test_public_catalogue_guided_preparation_is_temporary_and_requires_temperature_choices(self):
        backend = self.enable_cloud()
        self.page.fill("#temp2", "85")
        self.create_custom_recipe("Dos temperaturas para compartir")
        self.wait_cloud_saved()
        self.page.click("#publishRecipe")
        expect(self.page.locator("#publicationStatus")).to_contain_text("Receta publicada")
        visitor = self.public_visitor(backend)
        visitor.clock.install(time=1_800_000_000_000)
        visitor.clock.pause_at(1_800_000_001_000)
        visitor.click("#openPublicPreparation")
        visitor.click("#guestBrewStart")
        expect(visitor.locator("#guestBrewMessage")).to_contain_text("Selecciona la temperatura")
        for i, temp in enumerate(["93", "85", "85"]):
            visitor.select_option("#guestTemp" + str(i), temp)
        visitor.click("#guestBrewStart")
        expect(visitor.locator("#publicDose")).to_be_disabled()
        visitor.clock.fast_forward(45000)
        visitor.click("#guestBrewNext")
        expect(visitor.locator("#guestBrewAmount")).to_contain_text("Añade 100 g")
        expect(visitor.locator("#guestBrewTemperature")).to_contain_text("85 °C")
        visitor.click("#guestBrewPause")
        visitor.clock.fast_forward(10000)
        expect(visitor.locator("#guestBrewClock")).to_have_text("0:45")
        visitor.click("#guestBrewResume")
        visitor.clock.fast_forward(45000)
        visitor.click("#guestBrewNext")
        visitor.click("#guestBrewFinish")
        expect(visitor.locator("#guestBrewMessage")).to_contain_text("Preparación terminada en 1:30")
        self.assertIsNone(visitor.evaluate("localStorage.getItem('blossom-brew-preparation-v1')"))
        self.assertIsNone(visitor.evaluate("localStorage.getItem('blossom-brew-sessions-v1')"))

    def test_public_catalogue_activation_prepares_sql_for_the_verified_account_only(self):
        backend = MockCloud()
        backend.catalogue_ready = False
        self.enable_cloud(backend)
        expect(self.page.locator("#prepareCatalogueSql")).to_be_visible()
        self.page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Denied in test')}}})")
        self.page.click("#prepareCatalogueSql")
        expect(self.page.locator("#catalogueSql")).to_be_visible()
        sql = self.page.locator("#catalogueSql").input_value()
        self.assertIn("create table if not exists public.blossom_publishers", sql)
        self.assertIn("values ('11111111-1111-4111-8111-111111111111'::uuid)", sql)
        self.assertNotIn("test-access", sql)
        self.assertNotIn("julio@example.com", sql)
        visitor = self.public_visitor(backend)
        expect(visitor.locator("#catalogueStatus")).to_contain_text("se está preparando")
        expect(visitor.locator("#publicPreset option")).to_have_count(1)
        backend.catalogue_ready = True
        self.page.click("#refreshPublication")
        expect(self.page.locator("#prepareCatalogueSql")).not_to_be_visible()
        self.page.click("#cloudSignOut")
        expect(self.page.locator("#publicationPanel")).not_to_be_visible()
        expect(self.page.locator("#catalogueSql")).to_have_value("")

    def test_public_catalogue_denied_accounts_and_network_failures_cannot_publish(self):
        backend = MockCloud()
        backend.publisher = False
        self.enable_cloud(backend)
        self.create_custom_recipe("No autorizada")
        self.wait_cloud_saved()
        expect(self.page.locator("#publicationStatus")).to_contain_text("no está autorizada")
        expect(self.page.locator("#publishRecipe")).not_to_be_visible()
        self.page.locator("#publishRecipe").dispatch_event("click")
        self.assertFalse(any(call["path"].endswith("blossom_publish_recipe") for call in backend.catalogue_calls))
        backend.publisher = True
        self.page.click("#refreshPublication")
        expect(self.page.locator("#publishRecipe")).to_be_enabled()
        backend.offline = True
        self.page.click("#publishRecipe")
        expect(self.page.locator("#publicationStatus")).to_contain_text("conectar")
        self.assertEqual(backend.publications, {})
        self.assertEqual(len(self.stored(RECIPE_KEY)), 1)

    def test_public_catalogue_all_sections_fit_mobile_and_intro_copy_is_removed(self):
        for text in ["El detalle hace la diferencia.", "UN ESPACIO PARA EXPLORAR EL CAFÉ.", "Tus recetas, en tus dispositivos"]:
            self.assertNotIn(text, self.page.locator("body").inner_text())
        self.page.goto(self.base_url + "recetario/")
        expect(self.page.locator("#publicPreset option")).to_have_count(1)
        for width in [320, 375, 768, 1440]:
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 900})
                self.page.evaluate("document.fonts.ready")
                for tab in ["recipes", "preparation", "extraction", "water"]:
                    self.page.locator('.tabs [data-public-tab="' + tab + '"]').click()
                    fits = self.page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                    overflow = [] if fits else self.page.evaluate("""() => {
                        const bounds = el => ({tag:el.tagName,id:el.id,class:String(el.className),width:el.clientWidth,
                            scroll:el.scrollWidth,right:el.getBoundingClientRect().right,left:el.getBoundingClientRect().left,
                            text:el.textContent.trim().slice(0,60)});
                        const elements=[...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().width);
                        const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),texts=[];
                        let node;while(node=walker.nextNode()){
                            const range=document.createRange();range.selectNodeContents(node);
                            const box=range.getBoundingClientRect();
                            if(box.width && box.right>innerWidth-2)texts.push({text:node.textContent.trim().slice(0,100),right:box.right,parent:bounds(node.parentElement)});
                        }
                        return {viewport:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
                            body:bounds(document.body),elements:elements.filter(el=>el.scrollWidth>el.clientWidth+0.1 || el.getBoundingClientRect().right>innerWidth-1).map(bounds).slice(0,30),texts};
                    }""")
                    self.assertTrue(fits, (width, tab, overflow))

    def enable_cloud(self, backend=None):
        backend = backend or MockCloud()
        backend.attach(self.context)
        self.page.reload()
        expect(self.page.locator("#cloudStatus")).to_contain_text("están sincronizadas")
        return backend

    def cloud_phone(self, backend):
        context = self.browser.new_context(locale="es-ES", viewport={"width": 375, "height": 812})
        self.addCleanup(context.close)
        backend.attach(context)
        page = context.new_page()
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.goto(self.base_url)
        expect(page.locator("#cloudStatus")).to_contain_text("están sincronizadas")
        return page

    def wait_cloud_saved(self, page=None):
        page = page or self.page
        expect(page.locator("#cloudStatus")).to_contain_text("están sincronizadas")
        expected = page.evaluate("""async () => {
            const state = JSON.parse(localStorage.getItem('blossom-brew-cloud-state-v1'));
            const entries = await BlossomLab.sync.snapshot({
                recipes: JSON.parse(localStorage.getItem('blossom-brew-recipes-v1')) || [],
                sessions: JSON.parse(localStorage.getItem('blossom-brew-sessions-v1')) || [],
            });
            const hashes = Object.fromEntries(entries.map(entry => [JSON.stringify([entry.kind, entry.id]), entry.hash]));
            for (const key of Object.keys(state.base)) if (!(key in hashes)) hashes[key] = null;
            return hashes;
        }""")
        page.wait_for_function("""expected => {
            const state = JSON.parse(localStorage.getItem('blossom-brew-cloud-state-v1'));
            return state && !state.batch && Object.entries(expected).every(([key, hash]) => state.base[key]?.hash === hash);
        }""", arg=expected)

    def test_cloud_sync_migrates_personal_data_updates_and_deletes_between_browsers(self):
        self.page.click("#grindingAdvanced summary")
        self.page.fill("#grindMicrons", "700")
        recipe_id = self.create_custom_recipe("Receta de computadora")
        self.tab("journal")
        self.page.fill("#notes", "Sesión que viaja entre dispositivos")
        self.page.click("#saveSession")
        self.tab("recipe")
        backend = self.enable_cloud()
        phone = self.cloud_phone(backend)
        expect(phone.locator("#preset option")).to_have_text(["Bourbon Lavado · Baseline", "Receta de computadora"])
        phone.select_option("#preset", recipe_id)
        expect(phone.locator("#grindMicrons")).to_have_value("700")
        self.page.fill("#recipeName", "Receta actualizada")
        self.page.fill("#grindMicrons", "650")
        self.page.click("#updateRecipe")
        expect(self.page.locator("#cloudStatus")).to_contain_text("están sincronizadas")
        self.wait_cloud_saved()
        phone.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(phone.locator("#recipeName")).to_have_value("Receta actualizada")
        expect(phone.locator("#grindMicrons")).to_have_value("650")
        phone.fill("#recipeName", "Receta creada en teléfono")
        phone.click("#saveRecipe")
        expect(phone.locator("#cloudStatus")).to_contain_text("están sincronizadas")
        self.wait_cloud_saved(phone)
        self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(self.page.locator("#preset option")).to_have_count(3)
        self.page.click("#deleteRecipe")
        self.page.click("#confirmDeleteRecipe")
        self.wait_cloud_saved()
        phone.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(phone.locator("#preset option")).to_have_text(["Bourbon Lavado · Baseline", "Receta creada en teléfono"])
        phone.locator('[data-tab="journal"]').click()
        expect(phone.locator("#sessions")).to_contain_text("Sesión que viaja entre dispositivos")
        self.assertTrue(phone.evaluate("document.documentElement.scrollWidth <= innerWidth"))

    def test_cloud_pending_edits_survive_offline_reload_and_upload_on_reconnect(self):
        recipe_id = self.create_custom_recipe("Receta antes de desconectar")
        backend = self.enable_cloud()
        backend.offline = True
        self.page.fill("#recipeName", "Guardada sin conexión")
        self.page.click("#updateRecipe")
        expect(self.page.locator("#cloudStatus")).to_contain_text("No se pudo conectar")
        self.page.reload()
        expect(self.page.locator("#recipeName")).to_have_value("Guardada sin conexión")
        expect(self.page.locator("#cloudStatus")).to_contain_text("No se pudo conectar")
        backend.offline = False
        self.page.evaluate("window.dispatchEvent(new Event('online'))")
        expect(self.page.locator("#cloudStatus")).to_contain_text("están sincronizadas")
        phone = self.cloud_phone(backend)
        phone.select_option("#preset", recipe_id)
        expect(phone.locator("#recipeName")).to_have_value("Guardada sin conexión")

    def test_cloud_does_not_replace_an_unsaved_recipe_and_preserves_both_edits(self):
        recipe_id = self.create_custom_recipe("Receta compartida")
        backend = self.enable_cloud()
        phone = self.cloud_phone(backend)
        phone.select_option("#preset", recipe_id)
        phone.fill("#recipeName", "Cambios en teléfono")
        self.page.fill("#recipeName", "Cambios en computadora")
        self.page.click("#updateRecipe")
        self.wait_cloud_saved()
        phone.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(phone.locator("#cloudStatus")).to_contain_text("Guarda o cancela")
        expect(phone.locator("#recipeName")).to_have_value("Cambios en teléfono")
        phone.click("#updateRecipe")
        expect(phone.locator("#recipeFeedback")).to_contain_text("copia conservada")
        expect(phone.locator("#preset option")).to_have_text([
            "Bourbon Lavado · Baseline", "Cambios en computadora", "Cambios en teléfono · copia conservada",
        ])

    def test_cloud_sign_out_keeps_local_recipes_and_does_not_auto_sign_in_after_reload(self):
        self.create_custom_recipe("Receta que permanece local")
        self.enable_cloud()
        original = self.stored(RECIPE_KEY)
        self.page.click("#cloudSignOut")
        expect(self.page.locator("#cloudStatus")).to_contain_text("Sesión cerrada")
        self.page.reload()
        expect(self.page.locator("#cloudSignIn")).to_be_visible()
        expect(self.page.locator("#cloudConnected")).to_be_hidden()
        self.assertEqual(self.stored(RECIPE_KEY), original)

    def test_cloud_email_link_is_verified_and_removed_from_the_address(self):
        self.create_custom_recipe("Receta anterior a conectar la cuenta")
        backend = MockCloud()
        backend.attach(self.context, authenticated=False)
        self.page.reload()
        expect(self.page.locator("#cloudSignIn")).to_be_visible()
        self.page.fill("#cloudEmail", "julio@example.com")
        self.page.click("#cloudSendLink")
        expect(self.page.locator("#cloudStatus")).to_contain_text("Revisa tu correo")
        self.assertEqual(backend.calls[0]["email"], "julio@example.com")
        self.page.goto(self.base_url + "#access_token=test-access&refresh_token=test-refresh&expires_in=3600")
        expect(self.page.locator("#cloudConnected")).to_be_visible()
        expect(self.page.locator("#cloudStatus")).to_contain_text("están sincronizadas")
        self.assertNotIn("access_token", self.page.url)
        self.assertEqual(self.stored(RECIPE_KEY)[0]["name"], "Receta anterior a conectar la cuenta")

    def test_email_rate_limit_prevents_repeated_sends_and_survives_reload(self):
        self.page.clock.install()
        backend = MockCloud()
        backend.email_limit = {"code": "over_email_send_rate_limit", "retry_after": "120"}
        backend.attach(self.context, authenticated=False)
        self.page.reload()
        self.page.fill("#cloudEmail", "julio@example.com")
        self.page.click("#cloudSendLink")
        expect(self.page.locator("#cloudStatus")).to_contain_text("límite horario")
        expect(self.page.locator("#cloudSendLink")).to_be_disabled()
        for _ in range(4):
            self.page.locator("#cloudSignIn").evaluate("form => form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))")
        self.assertEqual(len(backend.calls), 1)
        self.page.reload()
        expect(self.page.locator("#cloudSendLink")).to_be_disabled()
        expect(self.page.locator("#cloudEmailWait")).to_contain_text("limitó los correos")
        self.assertEqual(len(backend.calls), 1)
        self.page.clock.fast_forward(121000)
        expect(self.page.locator("#cloudSendLink")).to_be_enabled()
        backend.email_limit = None
        self.page.fill("#cloudEmail", "julio@example.com")
        self.page.click("#cloudSendLink")
        expect(self.page.locator("#cloudStatus")).to_contain_text("Revisa tu correo")
        self.assertEqual(len(backend.calls), 2)

    def test_password_setup_and_mobile_sign_in_work_without_another_email(self):
        self.create_custom_recipe("Receta disponible en el teléfono")
        backend = self.enable_cloud()
        password = "contraseña-de-prueba-123"
        self.page.click("#cloudPasswordSetup summary")
        self.page.fill("#cloudNewPassword", password)
        self.page.fill("#cloudConfirmPassword", "Otra-contraseña-456")
        self.page.click("#cloudSavePassword")
        expect(self.page.locator("#cloudPasswordFeedback")).to_contain_text("no coinciden")
        self.assertIsNone(backend.password)
        self.page.fill("#cloudConfirmPassword", password)
        self.page.click("#cloudSavePassword")
        expect(self.page.locator("#cloudPasswordFeedback")).to_contain_text("Contraseña configurada")
        expect(self.page.locator("#cloudNewPassword")).to_have_value("")
        expect(self.page.locator("#cloudConfirmPassword")).to_have_value("")
        self.assertFalse(self.page.evaluate("password => JSON.stringify(localStorage).includes(password)", password))
        backend.email_limit = {"code": "over_email_send_rate_limit", "retry_after": "120"}
        context = self.browser.new_context(locale="es-ES", viewport={"width": 375, "height": 812})
        self.addCleanup(context.close)
        backend.attach(context, authenticated=False)
        phone = context.new_page()
        phone.on("pageerror", lambda error: self.errors.append(str(error)))
        phone.goto(self.base_url)
        phone.fill("#cloudEmail", "julio@example.com")
        phone.click("#cloudSendLink")
        expect(phone.locator("#cloudStatus")).to_contain_text("límite horario")
        expect(phone.locator("#cloudSendLink")).to_be_disabled()
        phone.click("#cloudPasswordSignIn summary")
        expect(phone.locator("#cloudPasswordEmail")).to_have_value("julio@example.com")
        phone.fill("#cloudPassword", password)
        expect(phone.locator("#cloudPasswordSubmit")).to_be_enabled()
        phone.click("#cloudPasswordSubmit")
        expect(phone.locator("#cloudStatus")).to_contain_text("están sincronizadas")
        expect(phone.locator("#cloudConnected")).to_be_visible()
        expect(phone.locator("#cloudEmailWait")).to_be_hidden()
        expect(phone.locator("#preset option")).to_have_text(["Bourbon Lavado · Baseline", "Receta disponible en el teléfono"])
        self.assertEqual(len([call for call in backend.calls if isinstance(call, dict) and call.get("create_user") is True]), 1)
        self.assertFalse(phone.evaluate("password => JSON.stringify(localStorage).includes(password)", password))
        self.assertTrue(phone.evaluate("document.documentElement.scrollWidth <= innerWidth"))

    def test_wrong_password_does_not_replace_local_recipes_or_report_a_network_error(self):
        backend = MockCloud()
        backend.password = "contraseña-de-prueba-123"
        backend.attach(self.context, authenticated=False)
        self.page.reload()
        self.create_custom_recipe("Receta local que se conserva")
        original = self.stored(RECIPE_KEY)
        self.page.click("#cloudPasswordSignIn summary")
        self.page.fill("#cloudPasswordEmail", "julio@example.com")
        self.page.fill("#cloudPassword", "incorrecta")
        self.page.click("#cloudPasswordSubmit")
        expect(self.page.locator("#cloudStatus")).to_contain_text("correo o la contraseña")
        expect(self.page.locator("#cloudConnected")).to_be_hidden()
        self.assertEqual(self.stored(RECIPE_KEY), original)
        self.assertIsNone(self.stored("blossom-brew-cloud-auth-v1"))


if __name__ == "__main__":
    unittest.main()
