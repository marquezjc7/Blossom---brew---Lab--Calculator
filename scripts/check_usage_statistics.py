"""Read-only permission checks, plus one deliberately invalid event that cannot create a visit."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from prepare_pages import cloud_config


def check_usage_statistics(opener=urlopen, require_ready=False):
    config = cloud_config()
    if not config:
        raise RuntimeError("Falta la configuración pública de Supabase.")
    def request(path, body=None):
        headers={"apikey":config["publishableKey"]}
        if body is not None: headers["Content-Type"]="application/json"
        query=Request(config["url"]+path,headers=headers,data=None if body is None else json.dumps(body).encode())
        try:
            with opener(query,timeout=20) as response: status,raw=response.status,response.read()
        except HTTPError as error: status,raw=error.code,error.read()
        except URLError as error: raise RuntimeError("No se pudo comprobar la protección de estadísticas.") from error
        try: return status,json.loads(raw)
        except (ValueError,UnicodeDecodeError): raise RuntimeError("Respuesta de estadísticas incompatible.")
    status,data=request('/rest/v1/rpc/blossom_usage_summary',{"period_days":7})
    if status==404 and isinstance(data,dict) and data.get('code')=='PGRST202':
        if require_ready: raise RuntimeError("Falta activar las estadísticas en Supabase.")
        print("::notice title=Estadísticas pendientes::Activa las estadísticas desde Blossom → Estadísticas. Los datos comenzarán a recopilarse al ejecutar su configuración en Supabase.")
        return False
    if not(status in [401,403] and isinstance(data,dict) and data.get('code')=='42501'):
        raise RuntimeError("No se pudo verificar que las estadísticas sean privadas.")
    for table in ['blossom_analytics_admins','blossom_usage_visits','blossom_usage_events']:
        status,data=request('/rest/v1/'+table+'?select=*&limit=0')
        if not(status in [401,403] and isinstance(data,dict) and data.get('code')=='42501'):
            raise RuntimeError("No se pudo verificar la protección de "+table)
    status,data=request('/rest/v1/rpc/blossom_record_usage',{"session_id":None,"visitor_id":None,"event_kind":"visit","target":"","channel":"direct"})
    if not(status==400 and isinstance(data,dict) and data.get('code')=='22023'):
        raise RuntimeError("No se pudo verificar el rechazo de eventos inválidos sin registrar visitas.")
    print("Estadísticas: resumen y tablas privados; entrada anónima rechaza eventos inválidos.")
    return True


if __name__=='__main__':
    try: check_usage_statistics(require_ready=os.environ.get('BLOSSOM_REQUIRE_USAGE_STATISTICS')=='1')
    except (RuntimeError,SystemExit) as error:
        message=str(error).replace('%','%25').replace('\r','%0D').replace('\n','%0A')
        print('::error::'+message)
        raise SystemExit(1)
