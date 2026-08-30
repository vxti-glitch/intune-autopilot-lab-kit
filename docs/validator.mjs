export const KNOWN_GROUP_TAGS = Object.freeze({
  "HELPDESK-STD": "Standard user-driven deployment",
  "HELPDESK-KIOSK": "Kiosk or shared workstation deployment",
  "HELPDESK-VIP": "Priority user deployment",
});

export const REQUIRED_COLUMNS = Object.freeze([
  "SerialNumber",
  "HardwareHash",
]);
export const STRICT_IMPORT_COLUMNS = Object.freeze(["Device Serial Number", "Windows Product ID", "Hardware Hash", "Group Tag", "Assigned User"]);
export const MAX_MANUAL_IMPORT_ROWS = 500;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parsePurchaseDate(value) {
  const clean = String(value ?? "").trim();
  if (!clean) return null;

  let year;
  let month;
  let day;
  let match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    [, year, month, day] = match.map(Number);
  } else {
    match = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!match) return null;
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
    if (year < 100) year += year >= 69 ? 1900 : 2000;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function normalizeDevice(device) {
  return {
    serialNumber: String(device.serialNumber ?? device.SerialNumber ?? "").trim(),
    hardwareHash: String(device.hardwareHash ?? device.HardwareHash ?? "").trim(),
    manufacturer: String(device.manufacturer ?? device.Manufacturer ?? "").trim(),
    model: String(device.model ?? device.Model ?? "").trim(),
    groupTag: String(device.groupTag ?? device.GroupTag ?? "").trim(),
    assignedUser: String(device.assignedUser ?? device.AssignedUser ?? "").trim(),
    purchaseDate: String(device.purchaseDate ?? device.PurchaseDate ?? "").trim(),
  };
}

export function validateIntake(rawDevices, options = {}) {
  const devices = rawDevices.map(normalizeDevice);
  const today = options.today ? new Date(`${options.today}T00:00:00Z`) : new Date();
  const refreshYears = Number(options.refreshYears ?? 4);
  const findings = [];

  const serialCounts = new Map();
  const hashCounts = new Map();
  devices.forEach((device) => {
    const serial = device.serialNumber.toLowerCase();
    const hash = device.hardwareHash.toLowerCase();
    serialCounts.set(serial, (serialCounts.get(serial) ?? 0) + 1);
    hashCounts.set(hash, (hashCounts.get(hash) ?? 0) + 1);
  });

  const addFinding = (severity, check, device, message, action) => {
    findings.push({ severity, check, device, message, action });
  };

  devices.forEach((device) => {
    if (serialCounts.get(device.serialNumber.toLowerCase()) > 1) {
      addFinding(
        "high",
        "duplicate-serial",
        device.serialNumber,
        "Serial number appears more than once in the intake file.",
        "Confirm the physical asset tag and remove duplicate rows before import.",
      );
    }

    if (hashCounts.get(device.hardwareHash.toLowerCase()) > 1) {
      addFinding(
        "high",
        "duplicate-hash",
        device.serialNumber,
        "Hardware hash appears more than once in the intake file.",
        "Recollect the hardware hash and confirm the source device.",
      );
    }

    if (device.groupTag && !(device.groupTag in KNOWN_GROUP_TAGS)) {
      addFinding(
        "medium",
        "unknown-group-tag",
        device.serialNumber,
        `Group tag '${device.groupTag}' is not in the lab expected-assignment map.`,
        "Confirm the optional OrderID/group-tag expectation; an authorized admin must verify tenant assignments.",
      );
    }

    if (device.groupTag !== "HELPDESK-KIOSK" && !device.assignedUser) {
      addFinding(
        "low",
        "missing-assigned-user",
        device.serialNumber,
        "Assigned User is blank. This Microsoft import field is optional.",
        "Confirm the lab handoff expectation; do not block import solely for this optional field.",
      );
    }

    if (device.assignedUser && !EMAIL_PATTERN.test(device.assignedUser)) {
      addFinding(
        "medium",
        "invalid-user-upn",
        device.serialNumber,
        "Assigned user does not look like a valid UPN.",
        "Verify the spelling in Entra ID before assigning the device.",
      );
    }

    const purchaseDate = parsePurchaseDate(device.purchaseDate);
    if (device.purchaseDate && !purchaseDate) {
      addFinding(
        "low",
        "invalid-purchase-date",
        device.serialNumber,
        "Purchase date could not be parsed.",
        "Use YYYY-MM-DD for device purchase dates.",
      );
    } else if (purchaseDate && (today - purchaseDate) / DAY_MS > refreshYears * 365) {
      addFinding(
        "low",
        "refresh-review",
        device.serialNumber,
        `Device is older than ${refreshYears} years.`,
        "Confirm it should be redeployed instead of refreshed.",
      );
    }
  });

  const deviceStatuses = Object.fromEntries(
    devices.map((device) => {
      const deviceFindings = findings.filter((finding) => finding.device === device.serialNumber);
      const blocked = deviceFindings.some(({ severity }) => severity === "high" || severity === "medium");
      return [device.serialNumber, blocked ? "review" : deviceFindings.length ? "ready-with-note" : "ready"];
    }),
  );

  const severityCounts = { high: 0, medium: 0, low: 0 };
  findings.forEach(({ severity }) => {
    severityCounts[severity] += 1;
  });

  const readyDeviceCount = devices.filter(
    (device) => deviceStatuses[device.serialNumber] !== "review",
  ).length;

  return {
    devices,
    findings,
    deviceStatuses,
    summary: {
      deviceCount: devices.length,
      readyDeviceCount,
      blockedDeviceCount: devices.length - readyDeviceCount,
      severityCounts,
    },
  };
}

export function buildImportRows(devices) {
  return devices.map((rawDevice) => {
    const device = normalizeDevice(rawDevice);
    return {
      "Device Serial Number": device.serialNumber,
      "Windows Product ID": "",
      "Hardware Hash": device.hardwareHash,
      "Group Tag": device.groupTag,
      "Assigned User": device.assignedUser,
    };
  });
}

export function rowsToCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  if (rows.length > MAX_MANUAL_IMPORT_ROWS) throw new Error(`Manual import supports no more than ${MAX_MANUAL_IMPORT_ROWS} rows.`);
  if (headers.join("|") !== STRICT_IMPORT_COLUMNS.join("|")) throw new Error("Strict import headers must match the Microsoft column names and order exactly.");
  rows.forEach((row, rowIndex) => headers.forEach((header) => {
    const value = String(row[header] ?? "");
    if (/[",\r\n]/.test(value)) throw new Error(`Row ${rowIndex + 2} field '${header}' would require quotation marks, which the strict import export does not allow.`);
  }));
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => row[header]).join(",")),
  ].join("\n");
}

export function buildReportPayload(result, tenantName = "Contoso Demo Lab") {
  return {
    tenant_name: tenantName,
    device_count: result.summary.deviceCount,
    ready_device_count: result.summary.readyDeviceCount,
    blocked_device_count: result.summary.blockedDeviceCount,
    severity_counts: Object.fromEntries(
      Object.entries(result.summary.severityCounts).filter(([, count]) => count > 0),
    ),
    expected_group_tag_mappings: KNOWN_GROUP_TAGS,
    boundary: "Offline validation cannot verify Microsoft Entra group membership or Intune assignments.",
    devices: result.devices.map((device) => ({
      serial_number: device.serialNumber,
      hardware_hash: device.hardwareHash,
      group_tag: device.groupTag,
      assigned_user: device.assignedUser,
      manufacturer: device.manufacturer,
      model: device.model,
      purchase_date: device.purchaseDate,
    })),
    findings: result.findings,
  };
}

export function renderMarkdown(payload) {
  const lines = [
    `# Autopilot Readiness Report: ${payload.tenant_name}`,
    "",
    "## Summary",
    "",
    `- Devices reviewed: ${payload.device_count}`,
    `- Ready for import: ${payload.ready_device_count}`,
    `- Needs review: ${payload.blocked_device_count}`,
    "",
    "## Expected Group Tag Mappings",
    "",
    ...Object.entries(payload.expected_group_tag_mappings)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, description]) => `- \`${tag}\`: ${description}`),
    "",
    "## Findings",
    "",
  ];

  if (!payload.findings.length) {
    lines.push("No blocking findings detected.");
  } else {
    lines.push("| Severity | Device | Check | Message | Action |");
    lines.push("| --- | --- | --- | --- | --- |");
    payload.findings.forEach((finding) => {
      lines.push(`| ${finding.severity} | ${finding.device} | ${finding.check} | ${finding.message} | ${finding.action} |`);
    });
  }

  lines.push(
    "",
    "## Next Actions",
    "",
    "1. Fix high severity findings before Autopilot import.",
    "2. Confirm medium severity findings with the endpoint admin.",
    "3. Save the generated import CSV in a restricted location.",
    "4. Upload only sanitized demo data to public repositories.",
    "5. Have an authorized endpoint administrator verify Entra group membership and Intune assignments.",
    "",
  );
  return lines.join("\n");
}

export function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const text = String(csvText).replace(/^\uFEFF/, "");

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (!rows.length) throw new Error("The CSV is empty.");

  const headers = rows[0].map((header) => header.trim().replaceAll(" ", ""));
  const missing = REQUIRED_COLUMNS.filter(
    (required) => !headers.some((header) => header.toLowerCase() === required.toLowerCase()),
  );
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);

  const headerLookup = Object.fromEntries(headers.map((header, index) => [header.toLowerCase(), index]));
  const get = (values, name) => String(values[headerLookup[name.toLowerCase()]] ?? "").trim();
  const devices = rows.slice(1).map((values, index) => {
    const device = {
      serialNumber: get(values, "SerialNumber"),
      hardwareHash: get(values, "HardwareHash"),
      groupTag: get(values, "GroupTag"),
      assignedUser: get(values, "AssignedUser"),
      manufacturer: get(values, "Manufacturer"),
      model: get(values, "Model"),
      purchaseDate: get(values, "PurchaseDate"),
    };
    if (!device.serialNumber || !device.hardwareHash) {
      throw new Error(`Row ${index + 2} needs SerialNumber and HardwareHash. GroupTag and AssignedUser are optional.`);
    }
    return device;
  });
  if (!devices.length) throw new Error("The CSV has headers but no device rows.");
  return devices;
}
