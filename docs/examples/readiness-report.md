# Autopilot Readiness Report: Contoso Lab

## Summary

- Devices reviewed: 4
- Ready for import: 3
- Needs review: 1

## Known Group Tags

- `HELPDESK-KIOSK`: Kiosk or shared workstation deployment
- `HELPDESK-STD`: Standard user-driven deployment
- `HELPDESK-VIP`: Priority user deployment

## Findings

| Severity | Device | Check | Message | Action |
| --- | --- | --- | --- | --- |
| low | LAB-003 | refresh-review | Device is older than 4 years. | Confirm it should be redeployed instead of refreshed. |
| medium | LAB-004 | unknown-group-tag | Group tag 'UNKNOWN-TAG' is not in the lab deployment profile map. | Map the group tag to an Intune deployment profile before upload. |
| low | LAB-004 | refresh-review | Device is older than 4 years. | Confirm it should be redeployed instead of refreshed. |

## Next Actions

1. Fix high severity findings before Autopilot import.
2. Confirm medium severity findings with the endpoint admin.
3. Save the generated import CSV in a restricted location.
4. Upload only sanitized demo data to public repositories.
