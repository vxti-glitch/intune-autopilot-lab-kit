import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildImportRows,
  buildReportPayload,
  parseCsv,
  renderMarkdown,
  rowsToCsv,
  validateIntake,
} from "../docs/validator.mjs";

const cleanDevice = {
  serialNumber: "LAB-001",
  hardwareHash: "SAFEHASH001",
  manufacturer: "Dell",
  model: "Latitude 5440",
  groupTag: "HELPDESK-STD",
  assignedUser: "alex.johnson@contoso.com",
  purchaseDate: "2025-05-10",
};

test("clean user-driven device is ready", () => {
  const result = validateIntake([cleanDevice], { today: "2026-08-29" });
  assert.equal(result.summary.readyDeviceCount, 1);
  assert.equal(result.summary.blockedDeviceCount, 0);
  assert.equal(result.findings.length, 0);
});

test("duplicate identity and assignment problems block affected devices", () => {
  const result = validateIntake([
    cleanDevice,
    { ...cleanDevice, assignedUser: "not-a-upn" },
  ], { today: "2026-08-29" });
  const checks = new Set(result.findings.map(({ check }) => check));
  assert.ok(checks.has("duplicate-serial"));
  assert.ok(checks.has("duplicate-hash"));
  assert.ok(checks.has("invalid-user-upn"));
  assert.equal(result.summary.severityCounts.high, 4);
  assert.equal(result.summary.blockedDeviceCount, 2);
});

test("kiosk device may be unassigned and an old device receives a low note", () => {
  const result = validateIntake([
    {
      ...cleanDevice,
      serialNumber: "LAB-KIOSK",
      hardwareHash: "SAFEHASH-KIOSK",
      groupTag: "HELPDESK-KIOSK",
      assignedUser: "",
      purchaseDate: "2020-01-01",
    },
  ], { today: "2026-08-29" });
  assert.deepEqual(result.findings.map(({ check }) => check), ["refresh-review"]);
  assert.equal(result.deviceStatuses["LAB-KIOSK"], "ready-with-note");
});

test("CSV parser accepts browser-loaded intake and validates required fields", () => {
  const parsed = parseCsv([
    "SerialNumber,HardwareHash,Manufacturer,Model,GroupTag,AssignedUser,PurchaseDate",
    "LAB-007,SAFEHASH007,HP,EliteBook 840,HELPDESK-KIOSK,,2026-01-02",
  ].join("\n"));
  assert.equal(parsed[0].serialNumber, "LAB-007");
  assert.equal(parsed[0].assignedUser, "");
  assert.throws(() => parseCsv("SerialNumber,GroupTag\nA,B"), /HardwareHash/);
});

test("browser validator matches the checked-in sample readiness summary", async () => {
  const sampleCsv = await readFile(new URL("../samples/devices.csv", import.meta.url), "utf8");
  const result = validateIntake(parseCsv(sampleCsv), { today: "2026-08-29" });
  assert.equal(result.summary.deviceCount, 4);
  assert.equal(result.summary.readyDeviceCount, 3);
  assert.equal(result.summary.blockedDeviceCount, 1);
  assert.deepEqual(result.summary.severityCounts, { high: 0, medium: 1, low: 2 });
});

test("generated outputs use Autopilot columns and document the review", () => {
  const result = validateIntake([cleanDevice], { today: "2026-08-29" });
  const rows = buildImportRows(result.devices);
  const csv = rowsToCsv(rows);
  const payload = buildReportPayload(result, "Contoso Demo Lab");
  const markdown = renderMarkdown(payload);
  assert.match(csv, /^Device Serial Number,Windows Product ID,Hardware Hash,Group Tag,Assigned User/);
  assert.match(markdown, /Ready for import: 1/);
  assert.match(markdown, /No blocking findings detected\./);
});
