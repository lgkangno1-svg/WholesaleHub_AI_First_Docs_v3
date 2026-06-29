# n8n MVP Operations

## Purpose
Run the WholesaleHub MVP operating flow automatically so supplier data, existing WooCommerce variations, customer QA, and Windows review exports stay current.

## Schedule
- 09:00 every day
- 15:00 every day
- 21:00 every day
- Timezone: Asia/Seoul

## n8n Setup
Use a Schedule Trigger connected to an SSH node.

SSH node command:

```bash
cd /home/tnfwod/projects/wholesalehub && bash scripts/n8n-mvp-sync.sh
```

## Included In Automation
- Collect latest DailyFood and walldob2b data.
- Build the MVP sync plan.
- Synchronize existing WooCommerce variation price, selected supplier, and stock status through the existing safety gate.
- Run customer-facing QA.
- Copy review reports to the Windows desktop review folder when available.

## Excluded From Automation
- New variation creation.
- New draft/private product creation.
- Draft publish.
- Product deletion.
- Order, payment, deposit, auto-order, or AdminPlus auto-order flows.

## Failure Files
- `reports/n8n-run-latest.log`
- `reports/mvp-sync-summary.md`
- `reports/mvp-customer-qa-summary.md`
- `reports/windows-export-unavailable.md` when the Windows desktop path is not mounted.

## Windows Review Folder
- Windows path: `C:\Users\tnfwo\Desktop\hub검수`
- Linux/WSL path checked by the project: `/mnt/c/Users/tnfwo/Desktop/hub검수`

## Credential Rules
- Store SSH credentials only in n8n credentials.
- Never write SSH passwords, WooCommerce keys, supplier login details, or API keys into docs, logs, reports, or workflow notes.
- Do not print `.env` contents in n8n logs.
