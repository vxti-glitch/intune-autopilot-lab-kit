# Help Desk Runbook: Autopilot Device Intake

## Goal

Prepare an offline evidence package for an authorized endpoint administrator. Validate strict import data, record the selected classic Autopilot or device-preparation path, collect local readiness evidence, and clearly mark every tenant-dependent fact as unverified offline.

## Intake Checklist

1. Confirm the device has a serial number.
2. Confirm the hardware hash was collected from the correct physical device.
3. Treat Windows Product ID, Group Tag, and Assigned User as optional import fields; validate a supplied UPN without blocking a blank optional field.
4. If a group tag is supplied, record only the expected `OrderID`-based group mapping. Do not report a deployment profile as assigned until an authorized admin verifies dynamic group membership and Intune assignment.
5. Confirm the model is supported by the current hardware standard.
6. Confirm older devices are flagged for review before deployment.
7. Confirm the strict file has the exact five case-sensitive headers, no extra columns or quotation marks, ANSI-compatible encoding, and no more than 500 device rows. These rules were checked on **2026-08-31** against [Microsoft Learn: Manually register devices with Windows Autopilot](https://learn.microsoft.com/en-us/autopilot/add-devices).
8. Record supported Windows edition/build, power, network, OOBE/reset state, and scenario-specific TPM/firmware requirements.

## Escalation Criteria

Escalate to the endpoint admin when:

- A serial number appears more than once.
- A hardware hash appears more than once.
- A supplied user assignment has an invalid format or does not match the approved record. A blank Assigned User field alone is not a Microsoft import blocker.
- The device is older than the refresh threshold.
- A supplied group tag has no expected lab mapping, or authorized tenant evidence does not show the intended group/profile/app/policy assignment.
- ESP blocks, OOBE is unexpected, Entra join completes without Intune enrollment, or a required app fails.
- The next step would upload, reset, wipe, deregister, reassign, or change a real device/tenant.

## Evidence collection

- Record OOBE/ESP stage, exact error, timestamp/time zone, selected deployment path, and recent change.
- Use `dsregcmd /status` for local join/registration observations; it does not prove Intune assignment.
- Use `mdmdiagnosticstool.exe -area Autopilot -cab <approved-path>` where appropriate and protect the CAB.
- Review DeviceManagement-Enterprise-Diagnostics-Provider, ModernDeployment-Diagnostics-Provider-Autopilot, and Provisioning-Diagnostics-Provider event channels for the matching stage.
- For Win32 app failures, use the current Intune Management Extension logs under `C:\ProgramData\Microsoft\IntuneManagementExtension\Logs`, including `IntuneManagementExtension.log`, `AppWorkload.log`, and `AppActionProcessor.log`.
- Redact serials, hashes, tenant/user/device IDs, domains, tokens, recovery information, and unrelated log content before public use.

## Validation

An authorized real-environment validation would confirm join and MDM enrollment, expected ownership/primary user, sync, required apps, configuration/compliance/update results, BitLocker recovery-key ownership, and the user’s original task. The public lab demonstrates the workflow only and does not claim those tenant results.

## Technician Notes

Keep real tenant names, hardware hashes, and user data out of screenshots and public repositories. For demos, use sanitized lab data.

## Current references

- [Windows Autopilot requirements](https://learn.microsoft.com/en-us/autopilot/requirements)
- [Manual device registration and CSV specification](https://learn.microsoft.com/en-us/autopilot/add-devices)
- [Classic Autopilot and device preparation comparison](https://learn.microsoft.com/en-us/autopilot/device-preparation/compare)
- [Enrollment Status Page troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/mem/intune/device-enrollment/understand-troubleshoot-esp)
- [Intune Management Extension logs](https://learn.microsoft.com/en-us/intune/device-management/tools/management-extension-windows)
