-- Migration 008: Supplier Lane Telegram Approval
-- Idempotent: all statements use IF NOT EXISTS.
-- No destructive changes to existing tables.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS supplier_lane_approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Natural key: one request per (supplier_id, source_product_id)
  supplier_id TEXT NOT NULL CHECK (supplier_id IN ('dailyfood', 'walldob2b')),
  lane_code TEXT NOT NULL CHECK (lane_code IN ('A', 'B')),
  source_product_id TEXT NOT NULL,
  -- Display info captured at request creation
  original_product_name TEXT NOT NULL,
  option_summary TEXT NOT NULL DEFAULT '',
  hard_spec_fingerprint TEXT NOT NULL,
  -- State machine
  status TEXT NOT NULL DEFAULT 'unmapped'
    CHECK (status IN (
      'unmapped',
      'candidate_ready',
      'awaiting_telegram_approval',
      'approved',
      'rejected',
      'on_hold',
      'terminal_excluded',
      'needs_reapproval'
    )),
  -- Resolved outcome
  approved_woo_parent_id INTEGER,
  approved_by TEXT,
  approved_at TEXT,
  -- Telegram tracking
  telegram_message_id TEXT,
  telegram_sent_at TEXT,
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (supplier_id, source_product_id)
);

CREATE INDEX IF NOT EXISTS supplier_lane_approval_requests_status
  ON supplier_lane_approval_requests(status, supplier_id);

CREATE TABLE IF NOT EXISTS supplier_lane_approval_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_request_id INTEGER NOT NULL
    REFERENCES supplier_lane_approval_requests(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  woo_parent_id INTEGER NOT NULL,
  woo_product_name TEXT NOT NULL,
  recommendation_reason TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (approval_request_id, rank)
);

CREATE INDEX IF NOT EXISTS supplier_lane_approval_candidates_request
  ON supplier_lane_approval_candidates(approval_request_id);

-- Extend audit_history entity_type to accept 'approval_request'
-- We do this via a new table to avoid ALTER TABLE CHECK constraint changes.
CREATE TABLE IF NOT EXISTS supplier_lane_approval_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_request_id INTEGER NOT NULL
    REFERENCES supplier_lane_approval_requests(id),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  prev_status TEXT,
  new_status TEXT,
  selected_woo_parent_id INTEGER,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS supplier_lane_approval_audit_request
  ON supplier_lane_approval_audit(approval_request_id, created_at);
