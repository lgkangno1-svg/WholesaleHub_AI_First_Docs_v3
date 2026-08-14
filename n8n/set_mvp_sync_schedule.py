#!/usr/bin/env python3
"""Set the WholesaleHub MVP workflow to daily 11:00 and 18:00 KST runs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

WORKFLOW_ID = "jVFfCJtfEax1GeDQ"
OLD_EMAIL_GATE = "09 KST Email Gate"
NEW_EMAIL_GATE = "11 KST Email Gate"
OLD_SCHEDULE_NAMES = ("Daily 09 15 21 KST", "Daily 11 KST", "Daily 11 18 KST")
NEW_SCHEDULE_NAME = "Daily 11 18 KST"


def workflows(document: Any) -> list[dict[str, Any]]:
    if isinstance(document, list):
        return [row for row in document if isinstance(row, dict)]
    if isinstance(document, dict):
        if document.get("id") == WORKFLOW_ID:
            return [document]
        return [row for row in document.values() if isinstance(row, dict)]
    return []


def rename_connection_targets(value: Any) -> None:
    if isinstance(value, dict):
        if value.get("node") == OLD_EMAIL_GATE:
            value["node"] = NEW_EMAIL_GATE
        for child in value.values():
            rename_connection_targets(child)
    elif isinstance(value, list):
        for child in value:
            rename_connection_targets(child)


def update_workflow(workflow: dict[str, Any]) -> None:
    if workflow.get("id") != WORKFLOW_ID:
        raise RuntimeError("target workflow ID was not found")

    schedule_count = 0
    email_gate_count = 0
    for node in workflow.get("nodes", []):
        node_type = node.get("type")
        if node_type == "n8n-nodes-base.cron":
            node["name"] = NEW_SCHEDULE_NAME
            node["parameters"] = {
                "triggerTimes": {
                    "item": [
                        {"mode": "everyDay", "hour": 11, "minute": 0},
                        {"mode": "everyDay", "hour": 18, "minute": 0},
                    ],
                    "timezone": "Asia/Seoul",
                }
            }
            schedule_count += 1
        elif node_type == "n8n-nodes-base.scheduleTrigger":
            node["name"] = NEW_SCHEDULE_NAME
            node["parameters"] = {
                "rule": {
                    "interval": [
                        {"field": "cronExpression", "expression": "0 11,18 * * *"}
                    ]
                }
            }
            schedule_count += 1

        if node.get("name") in (OLD_EMAIL_GATE, NEW_EMAIL_GATE):
            code = str(node.get("parameters", {}).get("jsCode", ""))
            code = code.replace('parts.hour !== "09"', 'parts.hour !== "11"')
            code = code.replace("09:00 Asia/Seoul", "11:00 Asia/Seoul")
            node["name"] = NEW_EMAIL_GATE
            node.setdefault("parameters", {})["jsCode"] = code
            email_gate_count += 1

    if schedule_count != 1:
        raise RuntimeError(f"expected one schedule node, found {schedule_count}")
    if email_gate_count != 1:
        raise RuntimeError(f"expected one email gate, found {email_gate_count}")

    connections = workflow.get("connections", {})
    for old_schedule_name in OLD_SCHEDULE_NAMES:
        if old_schedule_name != NEW_SCHEDULE_NAME and old_schedule_name in connections:
            connections[NEW_SCHEDULE_NAME] = connections.pop(old_schedule_name)
    if OLD_EMAIL_GATE in connections:
        connections[NEW_EMAIL_GATE] = connections.pop(OLD_EMAIL_GATE)
    rename_connection_targets(connections)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    document = json.loads(args.input.read_text(encoding="utf-8"))
    candidates = [row for row in workflows(document) if row.get("id") == WORKFLOW_ID]
    if len(candidates) != 1:
        raise RuntimeError(f"expected one target workflow, found {len(candidates)}")
    update_workflow(candidates[0])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "schedule": "11:00, 18:00 Asia/Seoul",
                "email_gate": NEW_EMAIL_GATE,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
