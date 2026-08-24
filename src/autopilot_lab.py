"""Offline Intune Autopilot intake validator and report generator."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterable


REQUIRED_COLUMNS = ("SerialNumber", "HardwareHash", "GroupTag")
KNOWN_GROUP_TAGS = {
    "HELPDESK-STD": "Standard user-driven deployment",
    "HELPDESK-KIOSK": "Kiosk or shared workstation deployment",
    "HELPDESK-VIP": "Priority user deployment",
}


@dataclass(frozen=True)
class DeviceRecord:
    serial_number: str
    hardware_hash: str
    group_tag: str
    assigned_user: str = ""
    manufacturer: str = ""
    model: str = ""
    purchase_date: str = ""


@dataclass(frozen=True)
class Finding:
    severity: str
    check: str
    device: str
    message: str
    action: str


def normalize_header(header: str) -> str:
    return header.strip().replace(" ", "")


def parse_purchase_date(value: str) -> date | None:
    value = value.strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def load_devices(csv_path: Path) -> list[DeviceRecord]:
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("Device CSV is empty or missing headers.")

        header_map = {normalize_header(name).lower(): name for name in reader.fieldnames}
        missing = [
            required for required in REQUIRED_COLUMNS
            if required.lower() not in header_map
        ]
        if missing:
            raise ValueError(f"Device CSV missing required columns: {', '.join(missing)}")

        devices: list[DeviceRecord] = []
        for index, row in enumerate(reader, start=2):
            get = lambda key: (row.get(header_map.get(key.lower(), ""), "") or "").strip()
            serial = get("SerialNumber")
            hardware_hash = get("HardwareHash")
            group_tag = get("GroupTag")
            if not serial and not hardware_hash and not group_tag:
                continue
            if not serial or not hardware_hash or not group_tag:
                raise ValueError(
                    f"Row {index} must include SerialNumber, HardwareHash, and GroupTag."
                )
            devices.append(
                DeviceRecord(
                    serial_number=serial,
                    hardware_hash=hardware_hash,
                    group_tag=group_tag,
                    assigned_user=get("AssignedUser"),
                    manufacturer=get("Manufacturer"),
                    model=get("Model"),
                    purchase_date=get("PurchaseDate"),
                )
            )

    if not devices:
        raise ValueError("Device CSV did not contain any device rows.")
    return devices


def audit_devices(
    devices: Iterable[DeviceRecord],
    *,
    today: date | None = None,
    refresh_years: int = 4,
) -> list[Finding]:
    today = today or date.today()
    device_list = list(devices)
    findings: list[Finding] = []
    serial_counts = Counter(device.serial_number.lower() for device in device_list)
    hash_counts = Counter(device.hardware_hash.lower() for device in device_list)

    for device in device_list:
        if serial_counts[device.serial_number.lower()] > 1:
            findings.append(
                Finding(
                    "high",
                    "duplicate-serial",
                    device.serial_number,
                    "Serial number appears more than once in the intake file.",
                    "Confirm the physical asset tag and remove duplicate rows before import.",
                )
            )

        if hash_counts[device.hardware_hash.lower()] > 1:
            findings.append(
                Finding(
                    "high",
                    "duplicate-hash",
                    device.serial_number,
                    "Hardware hash appears more than once in the intake file.",
                    "Recollect the hardware hash and confirm the source device.",
                )
            )

        if device.group_tag not in KNOWN_GROUP_TAGS:
            findings.append(
                Finding(
                    "medium",
                    "unknown-group-tag",
                    device.serial_number,
                    f"Group tag '{device.group_tag}' is not in the lab deployment profile map.",
                    "Map the group tag to an Intune deployment profile before upload.",
                )
            )

        if device.group_tag != "HELPDESK-KIOSK" and not device.assigned_user:
            findings.append(
                Finding(
                    "medium",
                    "missing-assigned-user",
                    device.serial_number,
                    "Assigned user is missing for a user-driven deployment.",
                    "Add the assigned user's UPN or move the device to a shared-device profile.",
                )
            )

        if device.assigned_user and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", device.assigned_user):
            findings.append(
                Finding(
                    "medium",
                    "invalid-user-upn",
                    device.serial_number,
                    "Assigned user does not look like a valid UPN.",
                    "Verify the spelling in Entra ID before assigning the device.",
                )
            )

        purchase_date = parse_purchase_date(device.purchase_date)
        if device.purchase_date and not purchase_date:
            findings.append(
                Finding(
                    "low",
                    "invalid-purchase-date",
                    device.serial_number,
                    "Purchase date could not be parsed.",
                    "Use YYYY-MM-DD for device purchase dates.",
                )
            )
        elif purchase_date and (today - purchase_date).days > refresh_years * 365:
            findings.append(
                Finding(
                    "low",
                    "refresh-review",
                    device.serial_number,
                    f"Device is older than {refresh_years} years.",
                    "Confirm it should be redeployed instead of refreshed.",
                )
            )

    return findings


def build_autopilot_import_rows(devices: Iterable[DeviceRecord]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for device in devices:
        rows.append(
            {
                "Device Serial Number": device.serial_number,
                "Windows Product ID": "",
                "Hardware Hash": device.hardware_hash,
                "Group Tag": device.group_tag,
                "Assigned User": device.assigned_user,
            }
        )
    return rows


def build_report_payload(
    devices: list[DeviceRecord],
    findings: list[Finding],
    *,
    tenant_name: str,
) -> dict[str, object]:
    severity_counts = Counter(finding.severity for finding in findings)
    ready_devices = {
        device.serial_number
        for device in devices
    } - {
        finding.device
        for finding in findings
        if finding.severity in {"high", "medium"}
    }
    return {
        "tenant_name": tenant_name,
        "device_count": len(devices),
        "ready_device_count": len(ready_devices),
        "blocked_device_count": len(devices) - len(ready_devices),
        "severity_counts": dict(severity_counts),
        "known_group_tags": KNOWN_GROUP_TAGS,
        "devices": [asdict(device) for device in devices],
        "findings": [asdict(finding) for finding in findings],
    }


def render_markdown_report(payload: dict[str, object]) -> str:
    findings = payload["findings"]
    lines = [
        f"# Autopilot Readiness Report: {payload['tenant_name']}",
        "",
        "## Summary",
        "",
        f"- Devices reviewed: {payload['device_count']}",
        f"- Ready for import: {payload['ready_device_count']}",
        f"- Needs review: {payload['blocked_device_count']}",
        "",
        "## Known Group Tags",
        "",
    ]

    for tag, description in sorted(payload["known_group_tags"].items()):
        lines.append(f"- `{tag}`: {description}")

    lines.extend(["", "## Findings", ""])
    if not findings:
        lines.append("No blocking findings detected.")
    else:
        lines.extend(["| Severity | Device | Check | Message | Action |", "| --- | --- | --- | --- | --- |"])
        for finding in findings:
            lines.append(
                "| {severity} | {device} | {check} | {message} | {action} |".format(
                    **finding
                )
            )

    lines.extend(
        [
            "",
            "## Next Actions",
            "",
            "1. Fix high severity findings before Autopilot import.",
            "2. Confirm medium severity findings with the endpoint admin.",
            "3. Save the generated import CSV in a restricted location.",
            "4. Upload only sanitized demo data to public repositories.",
            "",
        ]
    )
    return "\n".join(lines)


def write_csv(rows: list[dict[str, str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_outputs(devices: list[DeviceRecord], findings: list[Finding], output_dir: Path, tenant_name: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    import_rows = build_autopilot_import_rows(devices)
    payload = build_report_payload(devices, findings, tenant_name=tenant_name)
    write_csv(import_rows, output_dir / "autopilot-import.csv")
    (output_dir / "readiness-report.json").write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )
    (output_dir / "readiness-report.md").write_text(
        render_markdown_report(payload),
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate Autopilot device intake data and generate import/report files."
    )
    parser.add_argument("--devices", required=True, type=Path, help="Path to device intake CSV.")
    parser.add_argument("--out", default=Path("reports"), type=Path, help="Output directory.")
    parser.add_argument("--tenant-name", default="Lab Tenant", help="Tenant or lab display name.")
    parser.add_argument("--refresh-years", default=4, type=int, help="Device age review threshold.")
    parser.add_argument("--fail-on-high", action="store_true", help="Exit with code 1 when high severity findings exist.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    devices = load_devices(args.devices)
    findings = audit_devices(devices, refresh_years=args.refresh_years)
    write_outputs(devices, findings, args.out, args.tenant_name)

    high_count = sum(1 for finding in findings if finding.severity == "high")
    medium_count = sum(1 for finding in findings if finding.severity == "medium")
    print(f"Reviewed {len(devices)} devices.")
    print(f"Findings: {len(findings)} total, {high_count} high, {medium_count} medium.")
    print(f"Output written to {args.out.resolve()}")
    return 1 if args.fail_on_high and high_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
