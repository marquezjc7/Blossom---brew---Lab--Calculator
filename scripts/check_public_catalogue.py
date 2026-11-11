"""Read-only capability and permission checks; an absent migration stays pending."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from prepare_pages import cloud_config


def check_public_catalogue(opener=urlopen, require_ready=False, require_steps=False):
    config = cloud_config()
    if config is None:
        raise RuntimeError("Falta la configuración pública de Supabase.")

    def request(path, body=None):
        headers = {"apikey": config["publishableKey"]}
        if body is not None:
            headers["Content-Type"] = "application/json"
        query = Request(config["url"] + path, headers=headers,
                        data=None if body is None else json.dumps(body).encode())
        try:
            with opener(query, timeout=20) as response:
                status, raw = response.status, response.read()
        except HTTPError as error:
            status, raw = error.code, error.read()
        except URLError as error:
            raise RuntimeError("No se pudo comprobar el recetario público.") from error
        try:
            return status, json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise RuntimeError("El recetario devolvió una respuesta incompatible.")

    status, data = request("/rest/v1/rpc/blossom_public_catalogue", {})
    if status == 404 and isinstance(data, dict) and data.get("code") == "PGRST202":
        if require_ready:
            raise RuntimeError("Falta activar la migración del recetario en Supabase.")
        print("::notice title=Activación del recetario pendiente::Recetario pendiente de activación en Supabase. La página pública ofrece solo la referencia incluida; no comparte recetas personales.")
        return False
    if status != 200 or not isinstance(data, list):
        raise RuntimeError(f"No se pudo comprobar la lectura pública (HTTP {status}).")
    for resource, path, body in [
        ("blossom_catalogue_status", "/rest/v1/rpc/blossom_catalogue_status", {}),
        ("blossom_publish_recipe", "/rest/v1/rpc/blossom_publish_recipe", {"recipe_id": "permission-check", "expected_recipe": {}, "expected_revision": 0}),
        ("blossom_withdraw_recipe", "/rest/v1/rpc/blossom_withdraw_recipe", {"recipe_id": "permission-check", "expected_revision": 0}),
        ("blossom_publishers", "/rest/v1/blossom_publishers?select=user_id&limit=0", None),
        ("blossom_publications", "/rest/v1/blossom_publications?select=source_id&limit=0", None),
    ]:
        status, error = request(path, body)
        if not (status in [401, 403] and isinstance(error, dict) and error.get("code") == "42501" and resource in error.get("message", "")):
            raise RuntimeError(f"No se pudo verificar la protección de {resource} (HTTP {status}).")
    print("Recetario: lectura anónima disponible y escritura y administración protegidas.")
    status, error = request("/rest/v1/rpc/blossom_project_pour_steps", {"source": {}})
    if status == 404 and isinstance(error, dict) and error.get("code") == "PGRST202":
        if require_steps:
            raise RuntimeError("Falta actualizar las indicaciones de vertidos en Supabase.")
        print("::notice title=Indicaciones de vertidos pendientes::La receta privada admite válvulas e indicaciones. Actualiza la configuración desde Blossom para compartirlas en el recetario.")
    elif not (status in [401, 403] and isinstance(error, dict) and error.get("code") == "42501" and "blossom_project_pour_steps" in error.get("message", "")):
        raise RuntimeError("No se pudo verificar la protección de las indicaciones de vertidos.")
    return True


if __name__ == "__main__":
    try:
        check_public_catalogue(require_ready=os.environ.get("BLOSSOM_REQUIRE_PUBLIC_CATALOGUE") == "1", require_steps=os.environ.get("BLOSSOM_REQUIRE_POUR_STEPS") == "1")
    except (RuntimeError, SystemExit) as error:
        message = str(error).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::error::{message}")
        raise SystemExit(1)
