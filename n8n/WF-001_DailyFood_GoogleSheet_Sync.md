# WF-001 DailyFood GoogleSheet Sync

## Trigger

```txt
0 9,12,15,18 * * *
```

## Nodes

1. Schedule Trigger
2. HTTP Request
   - URL: `https://docs.google.com/spreadsheets/d/1YvIxuhGYhA7PTxu9nH5cUNC8dkfykUSb4C8D77UKlUQ/export?format=csv&gid=860422621`
3. CSV Parse
4. Code Node: normalize headers
5. Send rows to WholesaleHub API
6. Trigger normalization
7. Trigger price engine
8. Trigger WooCommerce dry-run/live sync

## Notes

If CSV export fails due to permission, switch to n8n Google Sheets Node with OAuth.
