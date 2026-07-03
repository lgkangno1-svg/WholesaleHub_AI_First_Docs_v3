# n8n MVP Operations

## Purpose
Run the WholesaleHub MVP operating flow automatically from n8n. The workflow keeps supplier data current, synchronizes existing WooCommerce variations, automatically adds safe new options, creates true new products only as draft/private, runs customer QA, and exports review reports.

## Workflow
- Workflow name: `WholesaleHub MVP Sync`
- Initial status: import as inactive, test manually, then activate when SSH credential is set.
- Schedule timezone: Asia/Seoul
- Run times: 09:00, 15:00, 21:00 every day

## n8n Setup
Use a Schedule Trigger connected to an SSH node.

SSH node command:

```bash
cd /home/tnfwod/projects/wholesalehub && bash scripts/n8n-mvp-sync.sh
```

If API creation is unavailable, import this file manually:

```text
docs/n8n-wholesalehub-mvp-sync.workflow.json
```

After import, open the SSH node and select the n8n SSH credential for the mini PC. Keep the workflow inactive until the first manual execution passes.

## Included In Automation
- Collect latest DailyFood and walldob2b data.
- Build the MVP sync plan.
- Synchronize existing WooCommerce variation price, selected supplier, and stock status through the existing safety gate.
- Add safe new options as WooCommerce variations under existing products.
- Create true new products only as draft/private variable products.
- Create variations for those draft/private products.
- Run customer-facing QA.
- Copy review reports to the Windows desktop review folder when available.
- Refresh handoff and final summary docs.
- Fafane 공동구매 상품 설명 크롤링 및 WooCommerce 상품 설명 동기화.

## Excluded From Automation
- Public product creation.
- Draft/private product publish.
- Product deletion.
- Existing product name, option name, image, or stock quantity edits.
- Product description edits except the explicit Fafane 공동구매 description sync step.
- review_needed / blocked rows.
- Livestock/meat excluded rows.
- Order, payment, deposit, auto-order, or AdminPlus auto-order flows.

## New Product Rule
New options are automatically added when the safety gate marks them safe. True new products are created only as draft/private. They are not customer-visible until a human reviews them in WordPress and manually changes the product status to publish.

## Failure Files
- `reports/n8n-run-latest.log`
- `reports/n8n-run-YYYYMMDD-HHMM.log`
- `reports/mvp-sync-summary.md`
- `reports/mvp-add-create-execute-summary.md`
- `reports/mvp-customer-qa-summary.md`
- `reports/windows-export-unavailable.md` when the Windows desktop path is not mounted.

## Windows Review Folder
- Windows path: `C:\Users\tnfwo\Desktop\hub검수`
- Linux/WSL path checked by the project: `/mnt/c/Users/tnfwo/Desktop/hub검수`

## Credential Rules
- Store SSH credentials only in n8n credentials.
- Never write SSH passwords, WooCommerce keys, supplier login details, or API keys into docs, logs, reports, or workflow notes.
- Do not print `.env` contents in n8n logs.

## Latest Test Result
- Test time: 2026-06-29T23:16:45+0900
- Workflow ID: jVFfCJtfEax1GeDQ
- Workflow active: true
- Manual Test Trigger: present
- Manual Test Trigger to SSH node: connected
- Schedule Trigger to SSH node: connected
- Manual workflow execution: success
- SSH node reached: yes
- `scripts/n8n-mvp-sync.sh`: exit code 0
- Activation: enabled after successful manual test.
- Secret scan across docs/reports: no credential-like values found.

## 09:00 Order Excel Email

- At 09:00 Asia/Seoul, the workflow sends the generated order Excel files to `tnfwod@naver.com`.
- Subject format: `[도매허브] 오늘 발주 엑셀 YYYY-MM-DD`.
- Attachments: `reports/orders/walldo-order.xlsx`, `reports/orders/dailyfood-order.xlsx`.
- The 15:00 and 21:00 scheduled runs skip email sending.
- Fixture test command: `npm run orders:export-supplier-excels -- --fixture`; this creates temporary Excel rows only and does not create WooCommerce orders.
- If the Gmail node reports `Unable to sign without access token`, reconnect/authorize the Gmail OAuth credential in n8n. Never store OAuth tokens, API keys, SSH keys, or passwords in git/docs/logs.

## Latest Order Excel Email Test

- Result: success.
- Gmail OAuth credential confirmed: true (`Gmail account 2`).
- Fixture orders used: 3 total, walldob2b 2 and dailyfood 1.
- Test email recipient: `tnfwod@naver.com`.
- Subject format: `[도매허브] 오늘 발주 엑셀 YYYY-MM-DD`.
- Attachments: `reports/orders/walldo-order.xlsx`, `reports/orders/dailyfood-order.xlsx`.
- WooCommerce orders/products/prices/stock/order status changed: none.

## Unsold Deletion Policy

- 09:00 Asia/Seoul: crawl DailyFood directly from the htmlview page, crawl walldob2b, sync existing variations, permanently delete hub variations/products that neither supplier sells, run add/create, QA, exports, and email flow.
- 15:00 and 21:00 Asia/Seoul: crawl walldob2b, reuse the latest successful DailyFood snapshot, sync existing variations, permanently delete unsold hub variations/products, QA, and exports. New add/create is not run at these times.
- Deletion requires a successful walldob2b crawl and an existing successful DailyFood snapshot. Crawl failure must block deletion.
- Products or variations with order links are held for review instead of being deleted.
