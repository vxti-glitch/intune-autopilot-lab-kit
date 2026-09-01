from __future__ import annotations

import csv
import tempfile
import unittest
from datetime import date
from pathlib import Path

from src.autopilot_lab import (
    IMPORT_SPEC_CHECKED_ON,
    IMPORT_SPEC_SOURCE,
    DeviceRecord,
    audit_devices,
    build_autopilot_import_rows,
    build_report_payload,
    load_devices,
    validate_strict_import_rows,
)


class AutopilotLabTests(unittest.TestCase):
    def write_csv(self, rows: list[dict[str, str]]) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        path = Path(temp_dir.name) / "devices.csv"
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        return path

    def test_load_devices_requires_expected_columns(self) -> None:
        path = self.write_csv([{"SerialNumber": "LAB-001", "GroupTag": "HELPDESK-STD"}])

        with self.assertRaisesRegex(ValueError, "HardwareHash"):
            load_devices(path)

    def test_build_import_rows_uses_autopilot_column_names(self) -> None:
        path = self.write_csv(
            [
                {
                    "SerialNumber": "LAB-001",
                    "HardwareHash": "HASH001",
                    "GroupTag": "HELPDESK-STD",
                    "AssignedUser": "alex.johnson@contoso.com",
                }
            ]
        )

        rows = build_autopilot_import_rows(load_devices(path))

        self.assertEqual(rows[0]["Device Serial Number"], "LAB-001")
        self.assertEqual(rows[0]["Hardware Hash"], "HASH001")
        self.assertEqual(rows[0]["Assigned User"], "alex.johnson@contoso.com")
        validate_strict_import_rows(rows)

    def test_group_tag_and_assigned_user_are_optional(self) -> None:
        path = self.write_csv([{"SerialNumber": "LAB-OPTIONAL", "HardwareHash": "HASH-OPTIONAL"}])
        device = load_devices(path)[0]
        self.assertEqual(device.group_tag, "")
        self.assertEqual(device.assigned_user, "")
        findings = audit_devices([device], today=date(2026, 8, 30))
        self.assertEqual([finding.severity for finding in findings], ["low"])

    def test_strict_import_rejects_quoted_fields_and_more_than_500_rows(self) -> None:
        rows = [{"Device Serial Number": "LAB,001", "Windows Product ID": "", "Hardware Hash": "HASH", "Group Tag": "", "Assigned User": ""}]
        with self.assertRaisesRegex(ValueError, "quotation marks"):
            validate_strict_import_rows(rows)
        valid = [{"Device Serial Number": f"LAB-{index}", "Windows Product ID": "", "Hardware Hash": f"HASH-{index}", "Group Tag": "", "Assigned User": ""} for index in range(501)]
        with self.assertRaisesRegex(ValueError, "500"):
            validate_strict_import_rows(valid)

    def test_report_attributes_strict_rules_to_checked_official_source(self) -> None:
        device = DeviceRecord("LAB-001", "HASH001", "", "")
        payload = build_report_payload([device], [], tenant_name="Synthetic Lab")
        spec = payload["import_specification"]
        self.assertEqual(spec["source"], IMPORT_SPEC_SOURCE)
        self.assertEqual(spec["checked_on"], IMPORT_SPEC_CHECKED_ON)
        self.assertEqual(spec["maximum_device_rows"], 500)
        self.assertTrue(spec["headers_case_sensitive"])
        self.assertFalse(spec["quotation_marks_allowed"])
        self.assertFalse(spec["extra_columns_allowed"])

    def test_audit_flags_duplicate_and_unknown_group_tag(self) -> None:
        path = self.write_csv(
            [
                {
                    "SerialNumber": "LAB-001",
                    "HardwareHash": "HASH001",
                    "GroupTag": "HELPDESK-STD",
                    "AssignedUser": "alex.johnson@contoso.com",
                    "PurchaseDate": "2025-01-01",
                },
                {
                    "SerialNumber": "LAB-001",
                    "HardwareHash": "HASH002",
                    "GroupTag": "UNKNOWN",
                    "AssignedUser": "bad-upn",
                    "PurchaseDate": "2018-01-01",
                },
            ]
        )

        findings = audit_devices(load_devices(path), today=date(2026, 8, 24))
        checks = {finding.check for finding in findings}

        self.assertIn("duplicate-serial", checks)
        self.assertIn("unknown-group-tag", checks)
        self.assertIn("invalid-user-upn", checks)
        self.assertIn("refresh-review", checks)


if __name__ == "__main__":
    unittest.main()
