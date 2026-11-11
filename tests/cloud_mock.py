"""A local HTTP contract double; database permissions are tested against PostgreSQL separately."""
import copy
import json
import uuid
from urllib.parse import urlsplit

AUTH_KEY = "blossom-brew-cloud-auth-v1"
USER_ID = "11111111-1111-4111-8111-111111111111"


class MockCloud:
    def __init__(self):
        self.records = {}
        self.offline = False
        self.calls = []
        self.email_limit = None
        self.password = None
        self.publisher = True
        self.catalogue_ready = True
        self.publications = {}
        self.catalogue_calls = []

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
        if path in ["/rest/v1/rpc/" + action for action in ["blossom_public_catalogue", "blossom_catalogue_status", "blossom_publish_recipe", "blossom_withdraw_recipe"]]:
            self.handle_catalogue(route, path, headers)
            return
        if path == "/auth/v1/user":
            if request.method == "PUT":
                self.password = request.post_data_json["password"]
                self.calls.append({"action": "set_password"})
            route.fulfill(headers=headers, json={"id": USER_ID, "email": "julio@example.com"})
        elif path == "/auth/v1/logout":
            route.fulfill(status=204, headers=headers)
        elif path == "/auth/v1/otp":
            self.calls.append(request.post_data_json)
            if self.email_limit:
                if self.email_limit.get("retry_after"):
                    headers["Retry-After"] = self.email_limit["retry_after"]
                    headers["Access-Control-Expose-Headers"] = "Retry-After"
                route.fulfill(status=429, headers=headers, json={"code": self.email_limit["code"]})
            else:
                route.fulfill(headers=headers, json={})
        elif path == "/auth/v1/token" and "grant_type=password" in request.url:
            data = request.post_data_json
            self.calls.append({"action": "password_login", "email": data["email"]})
            if not self.password or data["email"] != "julio@example.com" or data["password"] != self.password:
                route.fulfill(status=400, headers=headers, json={"code": "invalid_credentials"})
            else:
                route.fulfill(headers=headers, json={
                    "access_token": "test-access", "refresh_token": "test-refresh", "expires_at": 9999999999,
                    "user": {"id": USER_ID, "email": "julio@example.com"},
                })
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
                    if change["deleted"] and key[0] == "recipe" and self.publications.get(key[1], {}).get("published"):
                        self.publications[key[1]].update(published=False, recipe=None, revision=self.publications[key[1]]["revision"] + 1)
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

    def handle_catalogue(self, route, path, headers):
        request = route.request
        self.catalogue_calls.append({"path": path, "authorization": request.headers.get("authorization"), "body": request.post_data_json})
        if not self.catalogue_ready:
            route.fulfill(status=404, headers=headers, json={"code": "PGRST202"})
            return
        if path.endswith("blossom_public_catalogue"):
            route.fulfill(headers=headers, json=[p["recipe"] for p in self.publications.values() if p["published"]])
            return
        if not request.headers.get("authorization"):
            route.fulfill(status=403, headers=headers, json={"code": "42501"})
            return
        if path.endswith("blossom_catalogue_status"):
            entries = [{k: p[k] for k in ["source_id", "public_id", "revision", "published"]} for p in self.publications.values()]
            route.fulfill(headers=headers, json={"publisher": self.publisher, "entries": entries if self.publisher else []})
            return
        if not self.publisher:
            route.fulfill(status=403, headers=headers, json={"code": "42501"})
            return
        body = request.post_data_json
        identifier = body["recipe_id"]
        existing = self.publications.get(identifier)
        if body["expected_revision"] != (existing["revision"] if existing else 0):
            route.fulfill(status=409, headers=headers, json={"code": "40001"})
            return
        if path.endswith("blossom_publish_recipe"):
            source = self.records.get(("recipe", identifier))
            if not source or source["deleted"] or source["payload"] != body["expected_recipe"]:
                route.fulfill(status=409, headers=headers, json={"code": "40001"})
                return
            fields = ["name", "coffee", "method", "dose", "water", "ratio", "temp", "temp2", "bloom", "time", "grind", "grinder", "grindSize", "grindMicrons", "pours", "pourTimes", "pourCount", "bloomWater"]
            projected = {key: copy.deepcopy(source["payload"][key]) for key in fields if key in source["payload"]}
            profile = source["payload"].get("waterProfile")
            if profile:
                projected["waterProfile"] = {key: profile[key] for key in ["version", "system", "base", "name", "liters", "gh", "alkalinity"]}
            public_id = existing["public_id"] if existing else str(uuid.uuid4())
            projected["id"] = public_id
            result = {"source_id": identifier, "public_id": public_id, "revision": (existing["revision"] if existing else 0) + 1, "published": True, "recipe": projected}
        else:
            if not existing:
                route.fulfill(status=409, headers=headers, json={"code": "40001"})
                return
            result = {**existing, "published": False, "recipe": None, "revision": existing["revision"] + 1}
        self.publications[identifier] = result
        route.fulfill(headers=headers, json={k: result[k] for k in ["source_id", "public_id", "revision", "published"]})
