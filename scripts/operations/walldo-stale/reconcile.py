#!/usr/bin/env python3
"""Conservative Walldo product reconciliation; never permanently deletes content."""
import argparse
import json
import os
import re
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SYNC = Path("/home/tnfwod/mcp-workspaces/kelvin/wholesale-alert-20261024")
sys.path.insert(0, "/home/tnfwod/b2b-sync")
from dotenv import load_dotenv
load_dotenv("/home/tnfwod/b2b-sync/.env")
from adapters import walldob2b
from woo_upload import get_client

STATE = ROOT / "confirmations.json"
MIN_CATALOG = 20
MAX_AGE_HOURS = 9
MAX_ACTIONS = 8

def atomically_save(path, data):
    fd, tmp = tempfile.mkstemp(dir=ROOT, prefix=".tmp-")
    with os.fdopen(fd, "w") as out:
        json.dump(data, out, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))

def get_snapshot():
    sync = read_json(SYNC / "sync-last.json")
    rows = read_json(SYNC / "catalogue-latest.json")
    if sync.get("errors"):
        raise RuntimeError("supplier sync reported errors; no cleanup")
    source = sync.get("sources", {}).get("walldob2b", 0)
    ids = {str(r["source_product_id"]) for r in rows if r.get("source") == "walldob2b"}
    if len(ids) < MIN_CATALOG or source != len(ids):
        raise RuntimeError("supplier catalogue count mismatch; no cleanup")
    completed = datetime.fromisoformat(sync["at"])
    age = (datetime.now(timezone.utc) - completed).total_seconds() / 3600
    if not (0 <= age <= MAX_AGE_HOURS):
        raise RuntimeError(f"supplier snapshot stale: {age:.2f} hours")
    return sync["at"], ids

def live_source_scan(reference):
    sess = walldob2b.login()
    original = sess.request
    def bounded(method, url, **kw):
        kw.setdefault("timeout", 25)
        return original(method, url, **kw)
    sess.request = bounded
    rows = walldob2b.fetch_products(sess)
    found = {str(r["source_product_id"]) for r in rows}
    if len(found) < MIN_CATALOG or found != reference:
        raise RuntimeError(f"live/source mismatch {len(found)}/{len(reference)}; no cleanup")
    return sess

def unavailable_at_supplier(sess, sid):
    # Never make a status change based solely on absence from a category page.
    try:
        r = sess.get("https://walldob2b.com/shop/item.php",
                     params={"it_id": sid}, timeout=20)
        if r.status_code != 200:
            return False
        return "판매가능한 상품이 아닙니다." in r.text
    except Exception:
        return False

def grouped_links(rows):
    group = defaultdict(list)
    for row in rows:
        group[str(row["woo_parent_id"])].append(row)
    return group

def candidate_links(rows, present):
    group = grouped_links(rows)
    result = []
    for pid, links in group.items():
        walldo = [r for r in links if r["supplier_id"] == "walldob2b"
                  and r["lane_status"] == "approved"]
        if len(walldo) != 1:
            continue
        row = walldo[0]
        sid = str(row["source_product_id"])
        if row["post_status"] != "publish" or sid in present:
            continue
        if not re.fullmatch(r"\d{8,}", sid):
            continue  # Legacy/manual IDs require human review.
        if any(link["supplier_id"] != "walldob2b" for link in links):
            continue  # Preserve all cross-supplier products.
        result.append((int(pid), sid, row["post_title"]))
    return sorted(result)

def run(apply=False):
    sync_at, ids = get_snapshot()
    links = read_json(ROOT / "lane-links-latest.json")
    if not isinstance(links, list) or len(links) < 20:
        raise RuntimeError("missing WordPress supplier links; no cleanup")
    sess = live_source_scan(ids)
    prior = read_json(STATE) if STATE.exists() else {}
    records = dict(prior.get("missing", {}))
    candidates = candidate_links(links, ids)
    current = {str(pid) for pid, _, _ in candidates}
    records = {k: v for k, v in records.items() if k in current}
    report = {"sync_at": sync_at, "catalogue_count": len(ids),
              "candidate_count": len(candidates), "eligible": [],
              "unconfirmed": [], "protected": [], "trashed": [],
              "errors": [], "dry_run": not apply}
    wc = None
    for pid, sid, name in candidates:
        key = str(pid)
        old = records.get(key, {})
        n = int(old.get("confirmations", 0))
        if old.get("source_product_id") != sid:
            n = 0
        if old.get("last_sync_at") != sync_at:
            n += 1
        records[key] = {"source_product_id": sid, "confirmations": n,
                        "last_sync_at": sync_at}
        if not unavailable_at_supplier(sess, sid):
            report["protected"].append({"id": pid, "reason": "supplier detail not conclusively unavailable"})
            continue
        if n < 2:
            report["unconfirmed"].append({"id": pid, "confirmations": n})
            continue
        report["eligible"].append({"id": pid, "name": name})
        if not apply or len(report["trashed"]) >= MAX_ACTIONS:
            continue
        try:
            if wc is None:
                wc = get_client()
            response = wc.get(f"products/{pid}")
            response.raise_for_status()
            product = response.json()
            if product.get("name") != name or product.get("status") != "publish":
                report["protected"].append({"id": pid, "reason": "WooCommerce status/name changed"})
                continue
            deleted = wc.delete(f"products/{pid}", params={"force": False})
            deleted.raise_for_status()
            verify = wc.get(f"products/{pid}")
            verify.raise_for_status()
            if verify.json().get("status") != "trash":
                raise RuntimeError("trash verification failed")
            report["trashed"].append({"id": pid, "name": name})
            records.pop(key, None)
        except Exception as exc:
            report["errors"].append({"id": pid, "error": str(exc)[:160]})
    if apply:
        atomically_save(STATE, {"missing": records})
        atomically_save(ROOT / "last-run.json", report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return int(bool(report["errors"]))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.apply and args.dry_run:
        parser.error("--apply and --dry-run cannot be combined")
    try:
        raise SystemExit(run(args.apply))
    except Exception as exc:
        print(json.dumps({"status":"blocked","error":str(exc)[:180]},ensure_ascii=False),flush=True)
        raise SystemExit(1)
