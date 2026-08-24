from __future__ import annotations

import csv
import tempfile
import unittest
from datetime import date
from pathlib import Path

from src.autopilot_lab import (
    audit_devices,
    build_autopilot_import_rows,
    load_devices,
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
