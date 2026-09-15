# Subscription-only thumbnails

Uses the MiniPC's ChatGPT-authenticated Codex built-in image generation, not an image API key.
The isolated CODEX_HOME excludes the existing OpenCodex proxy configuration. It inherits no API keys.
This consumes subscription limits; it is not unlimited/free image generation.

## Data flow

Fresh DailyFood/Walldo product approval -> `whct list` -> locked worker -> one generated PNG ->
`whct import` -> Telegram preview link + existing approval buttons -> approved new parent's thumbnail.
Neither the worker nor import publishes products. Option additions and old requests are untouched.
Title/spec changes invalidate images. Missing/stale images prevent new-product approval. AI image disclosure
is shown on the new product page. Full source images/details are not sent to the model.

## Deployment

Requires the four `wholesalehub_approval_*thumbnail*`/preview filter sites in the live approval class,
the MU plugin, Python 3.12, Docker/WP-CLI, and Codex 0.150.1 with ChatGPT login.
Copy worker.py to `/home/tnfwod/wholesalehub-thumbnail-worker/worker.py`.
Enable by setting `whct_start_after_id` to the CURRENT maximum approval request ID, never zero/backfill.
This deployment must preserve live-only edits: apply only the four filter additions to the live class.
Install provided systemd user timer (5 minutes, one worker; 3 attempts/day KST, 2 attempts/job, 1h backoff).
Authentication failure never falls back to an API. Daily Telegram alert accompanies holds.

n8n can use its existing MiniPC SSH credential to invoke
`python3 /home/tnfwod/wholesalehub-thumbnail-worker/worker.py --run` every five minutes instead.
Use only one scheduler. `flock` also prevents overlap. No n8n credential is embedded in this repository.
Status: `python3 /home/tnfwod/wholesalehub-thumbnail-worker/worker.py --status`.
After resolving an exhausted job, an operator may reset its attempts in the SQLite queue; automatic
endless retries are deliberately disabled. No customer credentials or financial data enter this queue.

## Validation and limitations

2026-09-15: isolated MiniPC native image smoke produced and visually verified one square apple image.
No paid API fallback was used. Tests: `python3 -m unittest test_worker -v` and
`php tests/codex-thumbnails.test.php`. Media import additionally validates PNG dimensions using WordPress.
Human review is necessary: title-based image generation cannot establish exact product appearance.
Images are uploaded to public WordPress media for preview before product approval.
End-to-end customer approval is not simulated against real products. Verify the first actual new request.

## Rollback

Stop/disable the new timer and restore the exact approval class/MU-plugin backups recorded at deployment.
Keep `whct_start_after_id` and imported media until an operator decides how to handle queued items;
disabling the bridge must not be used to silently approve queued products with supplier thumbnails.
No shared proxy, existing bots, existing n8n workflows, prices, inventory, orders or payments are modified.
