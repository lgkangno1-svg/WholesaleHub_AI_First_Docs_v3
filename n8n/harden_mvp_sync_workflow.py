#!/usr/bin/env python3
"""Add strict completion validation to the active WholesaleHub n8n workflow."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from copy import deepcopy
from pathlib import Path

WORKFLOW_ID = "jVFfCJtfEax1GeDQ"
VALIDATOR_NAME = "Validate MVP Sync Result"
VALIDATOR_ID = "6e4a1f84-4d97-4b80-bf45-31bc995d8d11"
MARKER = "WHOLESALEHUB_RESULT_JSON="
ALLOWED_SETTINGS = {
    "callerPolicy",
    "errorWorkflow",
    "executionOrder",
    "executionTimeout",
    "saveDataErrorExecution",
    "saveDataSuccessExecution",
    "saveExecutionProgress",
    "saveManualExecutions",
    "timezone",
}
VALIDATOR_CODE = r'''const stdout = String($json.stdout ?? "");
const marker = stdout
  .trim()
  .split(/\r?\n/)
  .reverse()
  .find((line) => line.startsWith("WHOLESALEHUB_RESULT_JSON="));

if (!marker) {
  throw new Error("MVP sync completion marker missing; treating the run as failed");
}

let result;
try {
  result = JSON.parse(marker.slice("WHOLESALEHUB_RESULT_JSON=".length));
} catch {
  throw new Error("MVP sync completion marker is not valid JSON");
}

if (result.status !== "completed" || Number(result.exit_code) !== 0 || result.step !== "completed") {
  throw new Error(
    `MVP sync failed: status=${result.status ?? "unknown"} exit_code=${result.exit_code ?? "unknown"} step=${result.step ?? "unknown"}`,
  );
}

return $input.all();'''


def request(base_url: str, api_key: str, method: str, path: str, payload: object | None = None) -> object:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"X-N8N-API-KEY": api_key, "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{base_url}{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"n8n API {method} {path} failed: HTTP {error.code}: {detail}") from error
    return {} if not data else json.loads(data)


def update_payload(workflow: dict[str, object]) -> dict[str, object]:
    updated = deepcopy(workflow)
    nodes = list(updated.get("nodes", []))
    nodes = [node for node in nodes if node.get("name") != VALIDATOR_NAME]
    nodes.append({
        "parameters": {"jsCode": VALIDATOR_CODE},
        "id": VALIDATOR_ID,
        "name": VALIDATOR_NAME,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [-368, 32],
    })
    connections = deepcopy(updated.get("connections", {}))
    connections["Run WholesaleHub MVP Sync"] = {
        "main": [[{"node": VALIDATOR_NAME, "type": "main", "index": 0}]],
    }
    connections[VALIDATOR_NAME] = {
        "main": [[{"node": "09 KST Email Gate", "type": "main", "index": 0}]],
    }
    updated["nodes"] = nodes
    updated["connections"] = connections
    return api_payload(updated)


def api_payload(workflow: dict[str, object]) -> dict[str, object]:
    settings = workflow.get("settings", {})
    if not isinstance(settings, dict):
        raise RuntimeError("workflow settings must be an object")
    return {
        "name": workflow["name"],
        "nodes": workflow["nodes"],
        "connections": workflow["connections"],
        "settings": {key: value for key, value in settings.items() if key in ALLOWED_SETTINGS},
    }


def validate(workflow: dict[str, object]) -> None:
    nodes = [node for node in workflow.get("nodes", []) if node.get("name") == VALIDATOR_NAME]
    if len(nodes) != 1 or MARKER not in nodes[0].get("parameters", {}).get("jsCode", ""):
        raise RuntimeError("validator node is missing or malformed")
    first = workflow.get("connections", {}).get("Run WholesaleHub MVP Sync", {}).get("main", [[]])[0]
    second = workflow.get("connections", {}).get(VALIDATOR_NAME, {}).get("main", [[]])[0]
    if [row.get("node") for row in first] != [VALIDATOR_NAME]:
        raise RuntimeError("SSH node is not connected to the validator")
    if [row.get("node") for row in second] != ["09 KST Email Gate"]:
        raise RuntimeError("validator is not connected to the email gate")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--ensure-active", action="store_true")
    parser.add_argument("--restore", type=Path)
    parser.add_argument("--backup", type=Path, default=Path("reports/n8n-mvp-sync-workflow-backup.json"))
    parser.add_argument("--base-url", default=os.environ.get("N8N_BASE_URL", "http://localhost:5678"))
    args = parser.parse_args()
    api_key = os.environ.get("N8N_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("N8N_API_KEY is required")
    base_url = args.base_url.rstrip("/")
    current = request(base_url, api_key, "GET", f"/api/v1/workflows/{WORKFLOW_ID}")
    was_active = bool(current.get("active"))

    if args.restore:
        source = json.loads(args.restore.read_text(encoding="utf-8"))
        payload = api_payload(source)
    else:
        payload = update_payload(current)
        validate(payload)

    if not args.apply:
        print(json.dumps({
            "mode": "restore-dry-run" if args.restore else "harden-dry-run",
            "workflow_id": WORKFLOW_ID,
            "active": was_active,
            "nodes_before": len(current.get("nodes", [])),
            "nodes_after": len(payload["nodes"]),
            "validator_present": any(node.get("name") == VALIDATOR_NAME for node in payload["nodes"]),
        }, ensure_ascii=False))
        return 0

    args.backup.parent.mkdir(parents=True, exist_ok=True)
    args.backup.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        should_be_active = was_active or args.ensure_active
        if was_active:
            request(base_url, api_key, "POST", f"/api/v1/workflows/{WORKFLOW_ID}/deactivate")
        request(base_url, api_key, "PUT", f"/api/v1/workflows/{WORKFLOW_ID}", payload)
        if should_be_active:
            request(base_url, api_key, "POST", f"/api/v1/workflows/{WORKFLOW_ID}/activate")
        verified = request(base_url, api_key, "GET", f"/api/v1/workflows/{WORKFLOW_ID}")
        if args.restore:
            print(json.dumps({"mode": "restored", "workflow_id": WORKFLOW_ID, "active": bool(verified.get("active"))}))
        else:
            validate(verified)
            print(json.dumps({"mode": "hardened", "workflow_id": WORKFLOW_ID, "active": bool(verified.get("active")), "nodes": len(verified.get("nodes", []))}))
    except Exception:
        original = api_payload(current)
        request(base_url, api_key, "PUT", f"/api/v1/workflows/{WORKFLOW_ID}", original)
        if was_active or args.ensure_active:
            request(base_url, api_key, "POST", f"/api/v1/workflows/{WORKFLOW_ID}/activate")
        raise
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
