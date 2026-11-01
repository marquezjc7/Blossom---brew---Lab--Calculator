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

    def test_reference_recipes_and_unknown_pacas_pours(self):
        expect(self.page.locator("#preset option")).to_have_count(3)
        for recipe, coffee, temperature in [
            ("bourbon-natural", "Bourbon Natural", "92"),
            ("bourbon-lavado", "Bourbon Lavado", "93"),
            ("pacas-natural", "Pacas Natural", "88"),
        ]:
            with self.subTest(recipe=recipe):
                self.page.select_option("#preset", recipe)
                expect(self.page.locator("#coffee")).to_have_value(coffee)
                expect(self.page.locator("#temp")).to_have_value(temperature)
                expect(self.page.locator("#waterOut")).to_have_text("240")
        expect(self.page.locator("#pours strong")).to_have_text(["50 g", "190 g"])
        expect(self.page.locator("#pourNote")).to_contain_text("Solo se conoce el peso del bloom")

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
        expect(self.page.locator("#preset option")).to_have_count(4)
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
        self.assertEqual(len(rows[1]), 20)
        self.assertEqual(rows[0][15:], ["notas", "molino", "grosor_molienda", "vertidos_despues_bloom", "temperatura_2_C"])
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
        expect(self.page.locator("#preset option")).to_have_count(3)
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
        self.page.select_option("#preset", "bourbon-natural")
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

    def test_pacas_editor_never_fills_unknown_pours_or_times(self):
        self.page.select_option("#preset", "pacas-natural")
        self.page.click("#editPours")
        expect(self.page.locator(".pour-row")).to_have_count(1)
        expect(self.page.locator(".pour-weight")).to_have_value("50")
        expect(self.page.locator(".pour-start")).to_have_value("")
        self.page.click("#applyPours")
        expect(self.page.locator("#pourError")).to_contain_text("último peso")
        self.page.click("#cancelPours")
        expect(self.page.locator("#pours strong")).to_have_text(["50 g", "190 g"])
        self.edit_plan([50, 150, 240], ["0:00", "0:45", ""])
        self.create_custom_recipe("Pacas con mi plan")
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
        self.page.fill("#dose", "18")
        self.page.once("dialog", lambda dialog: dialog.dismiss())
        self.page.select_option("#preset", "pacas-natural")
        expect(self.page.locator("#preset")).to_have_value("bourbon-natural")
        expect(self.page.locator("#dose")).to_have_value("18")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.select_option("#preset", "pacas-natural")
        expect(self.page.locator("#preset")).to_have_value("pacas-natural")
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
            ("#temp", "", "92"), ("#bloom", "", "45"),
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
        self.page.select_option("#preset", "pacas-natural")
        expect(self.page.locator("#pourCount")).to_have_value("")
        self.assertIsNone(self.stored(RECIPE_KEY))

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
        self.page.select_option("#preset", "pacas-natural")
        self.page.fill("#pourCount", "3")
        recipe_id = self.create_custom_recipe("Pacas · número conocido")
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
        self.assertEqual(rows[1][-1], "85")
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


if __name__ == "__main__":
    unittest.main()
