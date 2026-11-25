"""realm-which-change battery: every view by name (see tests/verify.sh for the environment)."""
import base64, json, os, sys, urllib.error, urllib.request

APPLIANCE = os.environ.get("APPLIANCE", "http://127.0.0.1:11043").rstrip("/")
AUTH = os.environ.get("AUTH") or os.environ.get("EMBABEL_AUTH")
if not AUTH:
    sys.exit("set AUTH=user:pass")
HDR = {"Authorization": "Basic " + base64.b64encode(AUTH.encode()).decode(), "Content-Type": "application/json"}
env = os.environ.get
failures = 0

def view(name, args):
    req = urllib.request.Request(f"{APPLIANCE}/api/v1/views/{name}/invoke", json.dumps({"args": args}).encode(), HDR)
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read().decode()[:300]}"}

# Whether an answer is the whole truth is the engine's to say, beside the rows: short() from the
# battery library (tests/lib, pinned from embabel-worlds/realm-spec) is None when it is, else the
# line to print in place of the figure, `REFUSED: <why>` or `PARTIAL <figure>: <the engine's reason>`.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from short import short  # noqa: E402


def answers(name, args, needs):
    global failures
    missing = [n for n in needs if not env(n)]
    if missing:
        print(f"  SKIP {name}: set {', '.join(missing)}")
        return
    body = view(name, args)
    why = "error" not in body and short(body, len(body.get("data") or []))
    if why:
        failures += 1
        print(f"  FAIL {name}: {why}")
    elif isinstance(body.get("data"), list):
        print(f"  ok   {name} answers by name: {len(body['data'])} rows")
    else:
        failures += 1
        print(f"  FAIL {name}: {json.dumps(body)[:400]}")

print("== L1: every view answers by name ==")
answers("WatchedServices", {}, [])
answers("WhatBrokeInProduction", {"namespace": env("NAMESPACE"), "app": env("APP"), "repo": env("REPO")}, ["NAMESPACE", "APP", "REPO"])
answers("RunningVersions", {"namespace": env("NAMESPACE"), "app": env("APP"), "repo": env("REPO")}, ["NAMESPACE", "APP", "REPO"])
for v in ("WhatBrokeFromLogs", "StartupFailureFromLogs", "PoolExhaustionCause"):
    answers(v, {"service": env("SERVICE"), "repo": env("REPO")}, ["SERVICE", "REPO"])
for v in ("ConnectionHeldAcrossRemoteCall", "StartupFailureCause", "FailuresAndTheirChanges"):
    answers(v, {"project": env("PROJECT")}, ["PROJECT"])
answers("WhichChange", {"fingerprint": env("FINGERPRINT"), "project": env("PROJECT")}, ["FINGERPRINT", "PROJECT"])

if failures:
    print(f"DRIFT FOUND: {failures} view(s) failed")
    sys.exit(1)
print("ALL CHECKS PASS")
