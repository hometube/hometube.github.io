#!/usr/bin/env python3
"""Compare two exported .ht archives structurally.

Extraction-based, so deflate-level differences are irrelevant. Normalizes the
volatile bits: exported_at, settings updated_at, and the values of settings
keys that are per-instance secrets/state (jwt_secret, pairing_tokens).
Exits 0 on match, 1 with a diff summary otherwise.
"""
import difflib
import json
import sys
import zipfile

VOLATILE_SETTINGS = {"jwt_secret", "pairing_tokens"}


def load(path):
    z = zipfile.ZipFile(path)
    names = sorted(z.namelist())
    meta = json.loads(z.read("metadata.json"))
    meta.pop("exported_at", None)
    for s in meta.get("settings", []):
        if s.get("key") in VOLATILE_SETTINGS:
            s["value"] = "<volatile>"
        s["updated_at"] = "<t>"
    for sub in meta.get("subscriptions", []):
        if sub.get("last_checked"):
            sub["last_checked"] = "<t>"  # written at server-boot tick; differs per process
    for v in meta.get("videos", []):
        if v.get("watched_at"):
            v["watched_at"] = "<t>"  # set by harness watch-checks; differs per server
    for m in meta.get("music", []):
        m.pop("duration", None)  # JS-era column; the Python-era export never had it
    files = {n: z.read(n) for n in names if n != "metadata.json"}
    return names, meta, files


def main():
    na, ma, fa = load(sys.argv[1])
    nb, mb, fb = load(sys.argv[2])
    bad = False
    if na != nb:
        print("  entry lists differ:", set(na) ^ set(nb))
        bad = True
    if ma != mb:
        sa = json.dumps(ma, indent=1, sort_keys=True).splitlines()
        sb = json.dumps(mb, indent=1, sort_keys=True).splitlines()
        print("  metadata.json diff:")
        for line in list(difflib.unified_diff(sa, sb, "python", "js", lineterm=""))[:60]:
            print("   ", line)
        bad = True
    for n in sorted(set(fa) & set(fb)):
        if fa[n] != fb[n]:
            print(f"  content differs: {n} ({len(fa[n])} vs {len(fb[n])} bytes)")
            bad = True
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
