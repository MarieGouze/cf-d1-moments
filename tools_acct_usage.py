"""Fetch today's account-wide Worker request count (Cloudflare GraphQL) and
optionally write it into the site's D1 settings (key acct_usage) for the footer.

Configuration (no real IDs in the repo):
  - environment variables CF_ACCOUNT_ID / CF_D1_DATABASE_ID, or
  - a gitignored tools_config.local.json next to this file: {"account": "...", "db_uuid": "..."}
Credentials: CF_API_TOKEN env var, or Muse's connector surrogate when available.
Usage: python3 tools_acct_usage.py [--write]
"""
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_cfg = {}
try:
    with open(os.path.join(BASE_DIR, "tools_config.local.json")) as fh:
        _cfg = json.load(fh)
except Exception:
    pass
ACCOUNT = os.environ.get("CF_ACCOUNT_ID") or _cfg.get("account", "")
DB_UUID = os.environ.get("CF_D1_DATABASE_ID") or _cfg.get("db_uuid", "")

_surrogate = None
_read_json = None
try:
    sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
    from dynamic_credentials import add_surrogate_to_request as _s, read_json_response as _r
    _surrogate, _read_json = _s, _r
except Exception:
    pass

def api(path, payload, method="POST"):
    url = "https://api.cloudflare.com/client/v4" + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if _surrogate:
        _surrogate(req, "custom.cloudflare-tgys", allowed_hosts=["api.cloudflare.com"])
    elif os.environ.get("CF_API_TOKEN"):
        req.add_header("Authorization", "Bearer " + os.environ["CF_API_TOKEN"])
    else:
        raise RuntimeError("no Cloudflare credential available (set CF_API_TOKEN)")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return _read_json(resp) if _read_json else json.loads(resp.read().decode())

def fetch_account_requests_today():
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    query = """
    query AcctReq($accountTag: string!, $start: Time, $end: Time) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 10000
            filter: { datetime_geq: $start, datetime_lt: $end }
          ) {
            sum { requests }
            dimensions { scriptName }
          }
        }
      }
    }"""
    res = api("/graphql", {"query": query, "variables": {
        "accountTag": ACCOUNT,
        "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }})
    if res.get("errors"):
        raise RuntimeError("GraphQL errors: " + json.dumps(res["errors"])[:300])
    groups = res["data"]["viewer"]["accounts"][0]["workersInvocationsAdaptive"]
    total = sum(g["sum"]["requests"] for g in groups)
    per_script = {g["dimensions"]["scriptName"]: g["sum"]["requests"] for g in groups}
    return total, per_script

def write_to_d1(total):
    now = int(datetime.now(timezone.utc).timestamp())
    value = json.dumps({"n": total, "t": now})
    sql = ("INSERT INTO settings (key, value) VALUES ('acct_usage', ?) "
           "ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    res = api(f"/accounts/{ACCOUNT}/d1/database/{DB_UUID}/query", {"sql": sql, "params": [value]})
    ok = res.get("success")
    return ok

if __name__ == "__main__":
    if not ACCOUNT or not DB_UUID:
        raise SystemExit("missing account/db id: set CF_ACCOUNT_ID / CF_D1_DATABASE_ID or tools_config.local.json")
    total, per_script = fetch_account_requests_today()
    print("account total today (UTC):", total)
    for name, n in sorted(per_script.items(), key=lambda kv: -kv[1]):
        print(f"  {name}: {n}")
    if "--write" in sys.argv:
        print("write to D1:", write_to_d1(total))
