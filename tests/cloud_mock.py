"""A local HTTP contract double; database permissions are tested against PostgreSQL separately."""
import copy
import json
from urllib.parse import urlsplit

AUTH_KEY = "blossom-brew-cloud-auth-v1"
USER_ID = "11111111-1111-4111-8111-111111111111"


class MockCloud:
    def __init__(self):
        self.records = {}
        self.offline = False
        self.calls = []

    def attach(self, context, authenticated=True):
        config = {"url": "https://cloud.example.test", "publishableKey": "sb_publishable_test"}
        context.route("**/src/cloud-config.js*", lambda route: route.fulfill(
            content_type="application/javascript",
            body="globalThis.BlossomLab ??= {}; globalThis.BlossomLab.cloudConfig = " + json.dumps(config) + ";",
        ))
        context.route("https://cloud.example.test/**", self.handle)
        if authenticated:
            session = {"access_token": "test-access", "refresh_token": "test-refresh", "expires_at": 9999999999,
                       "user": {"id": USER_ID, "email": "julio@example.com"}}
            context.add_init_script("if (localStorage.getItem(" + json.dumps(AUTH_KEY) + ") === null) localStorage.setItem(" + json.dumps(AUTH_KEY) + ", " + json.dumps(json.dumps(session)) + ");")

    def handle(self, route):
        request = route.request
        headers = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type",
                   "Access-Control-Allow-Methods": "POST, GET, OPTIONS"}
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=headers)
            return
        if self.offline:
            route.fulfill(status=503, headers=headers, json={"message": "Offline test"})
            return
        path = urlsplit(request.url).path
        if path == "/auth/v1/user":
            route.fulfill(headers=headers, json={"id": USER_ID, "email": "julio@example.com"})
        elif path == "/auth/v1/logout":
            route.fulfill(status=204, headers=headers)
        elif path == "/auth/v1/otp":
            self.calls.append(request.post_data_json)
            route.fulfill(headers=headers, json={})
        elif path == "/rest/v1/rpc/blossom_sync":
            changes = request.post_data_json["changes"]
            self.calls.append(copy.deepcopy(changes))
            conflicts = []
            for change in changes:
                key = (change["kind"], change["record_id"])
                existing = self.records.get(key)
                body = None if change["deleted"] else change["payload"]
                if existing and existing["deleted"] == change["deleted"] and existing["payload"] == body:
                    continue
                if not existing and change["deleted"]:
                    continue
                if (not existing and change["base_version"] == 0) or (existing and existing["version"] == change["base_version"]):
                    self.records[key] = {"kind": key[0], "record_id": key[1], "payload": copy.deepcopy(body),
                                         "deleted": change["deleted"], "version": existing["version"] + 1 if existing else 1}
                elif not change["deleted"]:
                    identifier = "conflict-" + change["op_id"]
                    copied = {**body, "id": identifier}
                    if key[0] == "recipe":
                        copied["name"] = copied["name"][:75] + " · copia conservada"
                    self.records.setdefault((key[0], identifier), {"kind": key[0], "record_id": identifier,
                                            "payload": copied, "deleted": False, "version": 1})
                    conflicts.append({"kind": key[0], "id": key[1], "action": "copied", "copy_id": identifier})
                else:
                    conflicts.append({"kind": key[0], "id": key[1], "action": "remote_kept"})
            route.fulfill(headers=headers, json={"records": list(self.records.values()), "conflicts": conflicts})
        else:
            route.fulfill(status=404, headers=headers, json={})
