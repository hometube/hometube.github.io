#!/usr/bin/env bash
# Parity harness: Python backend vs JS server serving identical seeded DBs.
# Usage: PARITY_PY=8211 PARITY_JS=8213 ./parity.sh
#   (Python on $PARITY_PY using dir $PARITY_P, JS on $PARITY_JS using $PARITY_J)
# Exit non-zero on any divergence. Volatile fields (pairing_tokens) are
# normalized before diffing.
set -u
P="http://127.0.0.1:${PARITY_PY:-8211}"
J="http://127.0.0.1:${PARITY_JS:-8213}"
LAN=$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1)
fail=0

norm() {
  python3 -c "
import sys, json
d = json.load(sys.stdin)
if isinstance(d, dict):
    d.pop('pairing_tokens', None)
print(json.dumps(d, sort_keys=True))"
}

check() { # check <label> <method> <path> [body]
  local label=$1 method=$2 path=$3 body=${4:-}
  local rp rj
  if [ -n "$body" ]; then
    rp=$(curl -s -X "$method" "$P$path" -H 'content-type: application/json' -d "$body")
    rj=$(curl -s -X "$method" "$J$path" -H 'content-type: application/json' -d "$body")
  else
    rp=$(curl -s -X "$method" "$P$path")
    rj=$(curl -s -X "$method" "$J$path")
  fi
  if [ "$(echo "$rp" | norm)" != "$(echo "$rj" | norm)" ]; then
    echo "DIFF $label:"
    diff <(echo "$rp" | norm) <(echo "$rj" | norm) | head -8
    fail=1
  else
    echo "OK   $label"
  fi
}

json_get() { curl -s "$@" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"; }

check "GET /api/status" GET /api/status
check "GET /api/users" GET /api/users
check "GET /api/settings" GET /api/settings
check "GET /api/subscriptions" GET /api/subscriptions
check "GET /api/subscriptions?kind=podcast" GET "/api/subscriptions?kind=podcast"
check "GET /api/downloads" GET /api/downloads
check "POST /api/users (create)" POST /api/users '{"username":"parity"}'
check "POST /api/users (idempotent)" POST /api/users '{"username":"parity"}'
check "PUT /api/settings" PUT /api/settings '{"key":"parity_key","value":"v1"}'
check "DELETE /api/subscriptions/999" DELETE /api/subscriptions/999

# intentional deviation: Python's SPA catch-all serves index.html (200) for
# unknown routes incl. /api/*; the JS server returns a proper JSON 404.
code=$(curl -s -o /dev/null -w "%{http_code}" "$J/api/nope")
[ "$code" = 404 ] && echo "OK   404 JSON (Python SPA-catchall quirk ignored)" || { echo "FAIL 404: $code"; fail=1; }

# --- JWT interop over the LAN IP (real verification path, not loopback) ---
jwt_p=$(json_get -X POST "$P/api/desktop/pair")
jwt_p=$(json_get -X POST "$P/api/auth/exchange" -H 'content-type: application/json' -d "{\"token\":\"$jwt_p\"}")
code=$(curl -s -o /dev/null -w "%{http_code}" "http://$LAN:${PARITY_JS:-8213}/api/users?token=$jwt_p")
[ "$code" = 200 ] && echo "OK   JWT minted-by-Python verifies on JS" || { echo "FAIL JS rejects Python JWT ($code)"; fail=1; }

jwt_j=$(json_get -X POST "$J/api/desktop/pair")
jwt_j=$(json_get -X POST "$J/api/auth/exchange" -H 'content-type: application/json' -d "{\"token\":\"$jwt_j\"}")
code=$(curl -s -o /dev/null -w "%{http_code}" "http://$LAN:${PARITY_PY:-8211}/api/users?token=$jwt_j")
[ "$code" = 200 ] && echo "OK   JWT minted-by-JS verifies on Python" || { echo "FAIL Python rejects JS JWT ($code)"; fail=1; }

# Negative cases over LAN
code=$(curl -s -o /dev/null -w "%{http_code}" "http://$LAN:${PARITY_PY:-8211}/api/users"); p_missing=$code
code=$(curl -s -o /dev/null -w "%{http_code}" "http://$LAN:${PARITY_JS:-8213}/api/users"); j_missing=$code
[ "$p_missing" = 401 ] && [ "$j_missing" = 401 ] && echo "OK   missing token -> 401 both" || { echo "FAIL missing-token: py=$p_missing js=$j_missing"; fail=1; }
body=$(curl -s "http://$LAN:${PARITY_JS:-8213}/api/users")
[ "$body" = '{"detail":"Missing token"}' ] && echo "OK   401 body shape" || { echo "FAIL 401 body: $body"; fail=1; }
code=$(curl -s -o /dev/null -w "%{http_code}" "http://$LAN:${PARITY_JS:-8213}/api/users?token=bogus")
[ "$code" = 401 ] && echo "OK   bogus token -> 401" || { echo "FAIL bogus token: $code"; fail=1; }

# Pairing tokens are single-use
pt_j=$(json_get -X POST "$J/api/desktop/pair")
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$J/api/auth/exchange" -H 'content-type: application/json' -d "{\"token\":\"$pt_j\"}")
code2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$J/api/auth/exchange" -H 'content-type: application/json' -d "{\"token\":\"$pt_j\"}")
[ "$code" = 200 ] && [ "$code2" = 403 ] && echo "OK   pairing token single-use" || { echo "FAIL pairing reuse: first=$code second=$code2"; fail=1; }

exit $fail
