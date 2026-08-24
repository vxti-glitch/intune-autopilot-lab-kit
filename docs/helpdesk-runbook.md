# Help Desk Runbook: Autopilot Device Intake

## Goal

Prepare Windows devices for Autopilot import by validating device inventory, user assignment, and deployment group tags before the endpoint team uploads anything to Intune.

## Intake Checklist

1. Confirm the device has a serial number.
2. Confirm the hardware hash was collected from the correct physical device.
3. Confirm the assigned user UPN is spelled correctly.
4. Confirm the group tag matches the target deployment profile.
5. Confirm the model is supported by the current hardware standard.
6. Confirm older devices are flagged for review before deployment.

## Escalation Criteria

Escalate to the endpoint admin when:

- A serial number appears more than once.
- A hardware hash appears more than once.
- A user assignment is missing for a user-driven deployment.
- The device is older than the refresh threshold.
- The group tag does not map to a known deployment profile.

## Technician Notes

Keep real tenant names, hardware hashes, and user data out of screenshots and public repositories. For demos, use sanitized lab data.
