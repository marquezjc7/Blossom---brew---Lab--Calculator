"""Comprueba el servicio público y los permisos sin iniciar sesiones ni leer recetas."""

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from prepare_pages import cloud_config


def check_cloud(opener=urlopen):
    config = cloud_config()
    if config is None:
        raise RuntimeError(
            "Faltan BLOSSOM_SUPABASE_URL y BLOSSOM_SUPABASE_PUBLISHABLE_KEY "
            "en Settings > Secrets and variables > Actions > Variables."
        )

    def request(path, body=None):
        headers = {"apikey": config["publishableKey"]}
        if body is not None:
            headers["Content-Type"] = "application/json"
        query = Request(
            config["url"] + path,
            headers=headers,
            data=None if body is None else json.dumps(body).encode(),
        )
        try:
            with opener(query, timeout=20) as response:
                status, raw = response.status, response.read(65536)
        except HTTPError as error:
            status, raw = error.code, error.read(65536)
        except URLError as error:
            raise RuntimeError("No se pudo conectar con el proyecto de Supabase.") from error
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            data = {}
        return status, data

    status, _ = request("/auth/v1/health")
    if status != 200:
        raise RuntimeError(
            f"Supabase Auth no está disponible (HTTP {status}). "
            "Revisa que el proyecto esté activo y que las dos variables públicas sean correctas."
        )
    status, settings = request("/auth/v1/settings")
    if status != 200 or not isinstance(settings, dict):
        raise RuntimeError("No se pudo comprobar la configuración de acceso de Supabase.")
    if settings.get("external", {}).get("email") is not True:
        raise RuntimeError("Habilita el proveedor Email en Authentication de Supabase.")
    if settings.get("disable_signup") is True:
        raise RuntimeError("Habilita el registro de usuarios para entrar por correo en la aplicación.")

    for resource, path, body in [
        ("blossom_sync", "/rest/v1/rpc/blossom_sync", {"changes": []}),
        ("blossom_records", "/rest/v1/blossom_records?select=record_id&limit=0", None),
    ]:
        status, error = request(path, body)
        if not (
            status in [401, 403]
            and isinstance(error, dict)
            and error.get("code") == "42501"
            and resource in error.get("message", "")
        ):
            raise RuntimeError(
                f"No se pudo verificar la protección de {resource} (HTTP {status}). "
                "Comprueba que se aplicó la migración de Blossom con los permisos incluidos."
            )
    print("Supabase accesible; acceso por correo habilitado; tabla y función protegidas frente a acceso anónimo.")


if __name__ == "__main__":
    try:
        check_cloud()
    except (RuntimeError, SystemExit) as error:
        message = str(error).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::error::{message}")
        raise SystemExit(1)
