#!/usr/bin/env bash
# Parity harness: Python backend vs JS/Bun server serving identical seeded
# libraries. Resets both copies, boots each server, diffs every response.
# Usage: [PARITY_PY=8211] [PARITY_JS=8213] ./parity.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SCRATCH="${PARITY_TMP:-${TMPDIR:-/tmp}/hometube-parity}"
PY_PORT=${PARITY_PY:-8211}
JS_PORT=${PARITY_JS:-8213}
P="http://127.0.0.1:$PY_PORT"
J="http://127.0.0.1:$JS_PORT"
LAN=$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1)
PY="$ROOT/backend/.venv/bin/python"
fail=0

# --- reset: two fresh, identical seeded copies ---
lsof -ti :$PY_PORT | xargs kill 2>/dev/null || true
lsof -ti :$JS_PORT | xargs kill 2>/dev/null || true
sleep 1
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/p" "$SCRATCH/j"
DATA_DIR="$SCRATCH/p" "$PY" "$HERE/seed_parity.py" >/dev/null
DATA_DIR="$SCRATCH/j" "$PY" "$HERE/seed_parity.py" >/dev/null

# --- boot both servers ---
(cd "$ROOT/backend" && DATA_DIR="$SCRATCH/p" PORT=$PY_PORT nohup "$PY" main.py >"$SCRATCH/py.log" 2>&1 &)
(cd "$HERE" && DATA_DIR="$SCRATCH/j" PORT=$JS_PORT nohup bun run src/index.ts >"$SCRATCH/js.log" 2>&1 &)
for port in $PY_PORT $JS_PORT; do
  for _ in $(seq 1 30); do
    curl -s --max-time 1 -o /dev/null "http://127.0.0.1:$port/api/status" && break
    sleep 1
  done
done

norm() { # drop volatile runtime fields (scheduler last_checked, pairing state)
  python3 -c '
import sys, json
VOLATILE = ("pairing_tokens", "last_checked")
def strip(x):
    if isinstance(x, dict):
        return {k: strip(v) for k, v in x.items() if k not in VOLATILE}
    if isinstance(x, list):
        return [strip(v) for v in x]
    return x
print(json.dumps(strip(json.load(sys.stdin)), sort_keys=True))'
}

norm2() { # also drop wall-clock stamps (mutated-row responses)
  python3 -c '
import sys, json
VOLATILE = ("created_at", "watched_at", "last_checked")
def strip(x):
    if isinstance(x, dict):
        return {k: strip(v) for k, v in x.items() if k not in VOLATILE}
    if isinstance(x, list):
        return [strip(v) for v in x]
    return x
print(json.dumps(strip(json.load(sys.stdin)), sort_keys=True))'
}

check_status() { # check_status <label> <method> <path> <body> <expected>
  local label=$1 method=$2 path=$3 body=$4 want=$5
  local cp cj
  cp=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$P$path" -H 'content-type: application/json' -d "$body")
  cj=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$J$path" -H 'content-type: application/json' -d "$body")
  if [ "$cp" = "$want" ] && [ "$cj" = "$want" ]; then
    echo "OK   $label ($want both)"
  else
    echo "FAIL $label: py=$cp js=$cj want=$want"; fail=1
  fi
}

check() { # check <label> <method> <path> [body] [normalizer]
  local label=$1 method=$2 path=$3 body=${4:-} nz=${5:-norm}
  local rp rj
  if [ -n "$body" ]; then
    rp=$(curl -s -X "$method" "$P$path" -H 'content-type: application/json' -d "$body")
    rj=$(curl -s -X "$method" "$J$path" -H 'content-type: application/json' -d "$body")
  else
    rp=$(curl -s -X "$method" "$P$path")
    rj=$(curl -s -X "$method" "$J$path")
  fi
  if [ "$($nz <<<"$rp")" != "$($nz <<<"$rj")" ]; then
    echo "DIFF $label:"
    diff <($nz <<<"$rp") <($nz <<<"$rj") | head -8
    fail=1
  else
    echo "OK   $label"
  fi
}

status_of() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
json_get() { curl -s "$@" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"; }

# --- read-only parity against identical seed data (strict) ---
check "GET /api/status" GET /api/status
check "GET /api/users" GET /api/users
check "GET /api/settings" GET /api/settings
check "GET /api/subscriptions" GET /api/subscriptions
check "GET /api/subscriptions?kind=podcast" GET "/api/subscriptions?kind=podcast"
check "GET /api/downloads" GET /api/downloads
check "GET /api/videos" GET /api/videos
check "GET /api/videos?filter=unwatched" GET "/api/videos?filter=unwatched"
check "GET /api/videos?filter=keep" GET "/api/videos?filter=keep"
check "GET /api/videos?user_id=1" GET "/api/videos?user_id=1"
check "GET /api/music" GET /api/music
check "GET /api/music?kind=podcast" GET "/api/music?kind=podcast"
check "GET /api/playlists" GET /api/playlists
check "GET /api/playlists?kind=video" GET "/api/playlists?kind=video"

# --- mutations: same sequence into both, then compare (clock-tolerant) ---
check "POST /api/users (create)" POST /api/users '{"username":"parity"}'
check "POST /api/users (idempotent)" POST /api/users '{"username":"parity"}'
check "PUT /api/settings" PUT /api/settings '{"key":"parity_key","value":"v1"}'
check "DELETE /api/subscriptions/999" DELETE /api/subscriptions/999

check "POST /api/playlists" POST /api/playlists '{"name":"Harness","user_id":1}' norm2
pl_id=$(curl -s "$J/api/playlists" | python3 -c "import sys,json;[print(p['id']) for p in json.load(sys.stdin) if p['name']=='Harness']" | head -1)
check "POST playlist/add (music)" POST "/api/playlists/$pl_id/add" '{"music_id":1,"position":0}'
# Appends onto NON-empty playlists were silently dropped by Python (reusing
# the JSON column's list object leaves its change history empty; SQLAlchemy
# never flagged it dirty). Fixed backend-wide in add_to_playlist/add_*.
check "POST playlist/add (music, non-empty)" POST "/api/playlists/$pl_id/add" '{"music_id":2,"position":1}'
check "POST /api/playlists (2nd)" POST /api/playlists '{"name":"HarnessV","user_id":1}' norm2
plv_id=$(curl -s "$J/api/playlists" | python3 -c "import sys,json;[print(p['id']) for p in json.load(sys.stdin) if p['name']=='HarnessV']" | head -1)
check "POST playlist/add (video)" POST "/api/playlists/$plv_id/add" '{"video_id":2,"position":1}'
check "POST playlist/add (none -> 400)" POST "/api/playlists/$pl_id/add" '{}'
check "POST playlist/add (bad video -> 400)" POST "/api/playlists/$pl_id/add" '{"video_id":999}'
check "GET /api/playlists (after adds)" GET /api/playlists '' norm2
check "DELETE playlist remove music" DELETE "/api/playlists/$pl_id/remove/1"
check "DELETE playlist remove video" DELETE "/api/playlists/$plv_id/remove/2?item_type=video"
check "GET /api/playlists (after removes)" GET /api/playlists '' norm2
# intentional deviation: Python's update_* endpoints commit before
# serializing, so FastAPI's vars() sees an expired instance and they return
# {} (clients ignore the body). The JS server returns the updated row, so
# only status is compared for update success.
check_status "PUT playlist rename" PUT "/api/playlists/$pl_id" '{"name":"Harness2"}' 200
check_status "PUT playlist reorder+user 400" PUT "/api/playlists/$pl_id" '{"user_id":999}' 400

check "POST videos/1/watch watched" POST /api/videos/1/watch '{"watched":true}'
check "POST videos/1/position" POST /api/videos/1/watch '{"position":17.5}'
check "GET /api/videos?filter=unwatched (after watch)" GET "/api/videos?filter=unwatched" '' norm2
check "POST videos/1/keep" POST /api/videos/1/keep '{"keep":true}'
check_status "PUT videos/2" PUT /api/videos/2 '{"position":99.5,"quality":"720"}' 200
check "PUT videos/2 bad channel" PUT /api/videos/2 '{"channel_id":999}'
check "PUT videos/2 bad user" PUT /api/videos/2 '{"added_by":999}'
check_status "PUT music/1" PUT /api/music/1 '{"added_by":2}' 200
check "PUT music/1 bad user" PUT /api/music/1 '{"added_by":999}'

check "DELETE videos/3 (kept)" DELETE /api/videos/3
check "DELETE videos/3 (gone -> 404)" DELETE /api/videos/3
check "GET /api/videos (after delete)" GET /api/videos '' norm2
check "DELETE music/2" DELETE /api/music/2
check "GET /api/music (after delete)" GET /api/music '' norm2
check "DELETE playlist" DELETE "/api/playlists/$pl_id"
check "DELETE playlist (2nd)" DELETE "/api/playlists/$plv_id"
check "GET /api/playlists (after delete)" GET /api/playlists '' norm2

# intentional deviation: Python's SPA catch-all serves index.html (200) for
# unknown routes incl. /api/*; the JS server returns a proper JSON 404.
code=$(status_of "$J/api/nope")
[ "$code" = 404 ] && echo "OK   404 JSON (Python SPA-catchall quirk ignored)" || { echo "FAIL 404: $code"; fail=1; }

# --- JWT interop over the LAN IP (real verification path, not loopback) ---
jwt_p=$(json_get -X POST "$P/api/desktop/pair")
jwt_p=$(json_get -X POST "$P/api/auth/exchange" -H 'content-type: application/json' -d "{\"token\":\"$jwt_p\"}")
code=$(status_of "http://$LAN:$JS_PORT/api/users?token=$jwt_p")
[ "$code" = 200 ] && echo "OK   JWT minted-by-Python verifies on JS" || { echo "FAIL JS rejects Python JWT ($code)"; fail=1; }

jwt_j=$(json_get -X POST "$J/api/desktop/pair")
jwt_j=$(json_get -X POST "$J/api/auth/exchange" -H 'content-type: application/json' -d "{\"token\":\"$jwt_j\"}")
code=$(status_of "http://$LAN:$PY_PORT/api/users?token=$jwt_j")
[ "$code" = 200 ] && echo "OK   JWT minted-by-JS verifies on Python" || { echo "FAIL Python rejects JS JWT ($code)"; fail=1; }

code=$(status_of "http://$LAN:$PY_PORT/api/users"); p_missing=$code
code=$(status_of "http://$LAN:$JS_PORT/api/users"); j_missing=$code
[ "$p_missing" = 401 ] && [ "$j_missing" = 401 ] && echo "OK   missing token -> 401 both" || { echo "FAIL missing-token: py=$p_missing js=$j_missing"; fail=1; }
body=$(curl -s "http://$LAN:$JS_PORT/api/users")
[ "$body" = '{"detail":"Missing token"}' ] && echo "OK   401 body shape" || { echo "FAIL 401 body: $body"; fail=1; }
code=$(status_of "http://$LAN:$JS_PORT/api/users?token=bogus")
[ "$code" = 401 ] && echo "OK   bogus token -> 401" || { echo "FAIL bogus token: $code"; fail=1; }

pt_j=$(json_get -X POST "$J/api/desktop/pair")
code=$(status_of -X POST "$J/api/auth/exchange" -H 'content-type: application/json' -d "{\"token\":\"$pt_j\"}")
code2=$(status_of -X POST "$J/api/auth/exchange" -H 'content-type: application/json' -d "{\"token\":\"$pt_j\"}")
[ "$code" = 200 ] && [ "$code2" = 403 ] && echo "OK   pairing token single-use" || { echo "FAIL pairing reuse: first=$code second=$code2"; fail=1; }

echo "---"
[ $fail -eq 0 ] && echo "ALL PARITY CHECKS PASSED" || echo "FAILURES (see above)"
exit $fail
