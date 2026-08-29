import {
  buildImportRows,
  buildReportPayload,
  parseCsv,
  renderMarkdown,
  rowsToCsv,
  validateIntake,
} from "./validator.mjs";

const scenarios = {
  baseline: {
    label: "Mixed intake — 4 devices",
    description: "A realistic batch with an unknown group tag and aging hardware to review.",
    devices: [
      { serialNumber: "LAB-001", hardwareHash: "BASE64HASHVALUE001", manufacturer: "Dell", model: "Latitude 5440", groupTag: "HELPDESK-STD", assignedUser: "alex.johnson@contoso.com", purchaseDate: "2025-05-10" },
      { serialNumber: "LAB-002", hardwareHash: "BASE64HASHVALUE002", manufacturer: "Lenovo", model: "ThinkPad T14", groupTag: "HELPDESK-STD", assignedUser: "jamie.rivera@contoso.com", purchaseDate: "2024-11-19" },
      { serialNumber: "LAB-003", hardwareHash: "BASE64HASHVALUE003", manufacturer: "HP", model: "EliteBook 840", groupTag: "HELPDESK-KIOSK", assignedUser: "", purchaseDate: "2022-03-02" },
      { serialNumber: "LAB-004", hardwareHash: "BASE64HASHVALUE004", manufacturer: "Dell", model: "Latitude 7420", groupTag: "UNKNOWN-TAG", assignedUser: "casey.nguyen@contoso.com", purchaseDate: "2020-01-15" },
    ],
  },
  identity: {
    label: "Identity collision — 5 devices",
    description: "A high-risk batch with duplicate serial numbers and a reused hardware hash.",
    devices: [
      { serialNumber: "NEW-101", hardwareHash: "SAFEHASH101", manufacturer: "Dell", model: "Latitude 5450", groupTag: "HELPDESK-STD", assignedUser: "taylor.brooks@contoso.com", purchaseDate: "2026-07-11" },
      { serialNumber: "NEW-102", hardwareHash: "SAFEHASH102", manufacturer: "Lenovo", model: "ThinkPad T14", groupTag: "HELPDESK-VIP", assignedUser: "morgan.lee@contoso.com", purchaseDate: "2026-06-03" },
      { serialNumber: "NEW-102", hardwareHash: "SAFEHASH103", manufacturer: "Lenovo", model: "ThinkPad T14", groupTag: "HELPDESK-STD", assignedUser: "devon.hall@contoso.com", purchaseDate: "2026-06-04" },
      { serialNumber: "NEW-104", hardwareHash: "SAFEHASH104", manufacturer: "HP", model: "EliteBook 845", groupTag: "HELPDESK-KIOSK", assignedUser: "", purchaseDate: "2026-04-18" },
      { serialNumber: "NEW-105", hardwareHash: "SAFEHASH104", manufacturer: "HP", model: "EliteBook 845", groupTag: "HELPDESK-STD", assignedUser: "samir.patel@contoso.com", purchaseDate: "2026-04-18" },
    ],
  },
  assignment: {
    label: "Assignment cleanup — 4 devices",
    description: "A Tier 1 review focused on missing users, invalid UPNs, and profile mapping.",
    devices: [
      { serialNumber: "INT-201", hardwareHash: "SAFEHASH201", manufacturer: "Dell", model: "Latitude 5440", groupTag: "HELPDESK-STD", assignedUser: "", purchaseDate: "2025-10-22" },
      { serialNumber: "INT-202", hardwareHash: "SAFEHASH202", manufacturer: "Lenovo", model: "ThinkPad L14", groupTag: "HELPDESK-STD", assignedUser: "jordan.smith@contoso", purchaseDate: "2025-08-13" },
      { serialNumber: "INT-203", hardwareHash: "SAFEHASH203", manufacturer: "HP", model: "ProBook 440", groupTag: "FIELD-SALES", assignedUser: "riley.chen@contoso.com", purchaseDate: "2025-12-01" },
      { serialNumber: "INT-204", hardwareHash: "SAFEHASH204", manufacturer: "Dell", model: "OptiPlex 7020", groupTag: "HELPDESK-KIOSK", assignedUser: "", purchaseDate: "2026-01-17" },
    ],
  },
  clean: {
    label: "Ready batch — 3 devices",
    description: "A clean intake that can move to endpoint-admin review and controlled upload.",
    devices: [
      { serialNumber: "RDY-301", hardwareHash: "SAFEHASH301", manufacturer: "Dell", model: "Latitude 5450", groupTag: "HELPDESK-STD", assignedUser: "avery.king@contoso.com", purchaseDate: "2026-05-09" },
      { serialNumber: "RDY-302", hardwareHash: "SAFEHASH302", manufacturer: "Lenovo", model: "ThinkPad T14", groupTag: "HELPDESK-VIP", assignedUser: "cameron.price@contoso.com", purchaseDate: "2026-03-21" },
      { serialNumber: "RDY-303", hardwareHash: "SAFEHASH303", manufacturer: "HP", model: "Elite Mini 800", groupTag: "HELPDESK-KIOSK", assignedUser: "", purchaseDate: "2025-11-14" },
    ],
  },
};

const state = {
  devices: structuredClone(scenarios.baseline.devices),
  result: null,
  selectedDevice: null,
  activeOutput: "csv",
  customFileName: "",
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  scenario: $("#scenario"),
  scenarioDescription: $("#scenario-description"),
  run: $("#run-audit"),
  file: $("#csv-file"),
  fileLabel: $("#file-label"),
  status: $("#audit-status"),
  tableBody: $("#device-rows"),
  findings: $("#findings-list"),
  detail: $("#device-detail"),
  output: $("#output-preview"),
  download: $("#download-output"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusLabel(status) {
  if (status === "review") return "Needs review";
  if (status === "ready-with-note") return "Ready · note";
  return "Ready";
}

function renderMetrics() {
  const { summary } = state.result;
  $("#metric-devices").textContent = summary.deviceCount;
  $("#metric-ready").textContent = summary.readyDeviceCount;
  $("#metric-review").textContent = summary.blockedDeviceCount;
  $("#metric-high").textContent = summary.severityCounts.high;
  $("#readiness-value").textContent = `${Math.round((summary.readyDeviceCount / summary.deviceCount) * 100)}%`;
  $("#readiness-bar").style.width = `${(summary.readyDeviceCount / summary.deviceCount) * 100}%`;
}

function renderTable() {
  elements.tableBody.innerHTML = state.result.devices.map((device) => {
    const status = state.result.deviceStatuses[device.serialNumber];
    return `
      <tr data-device="${escapeHtml(device.serialNumber)}" tabindex="0" aria-label="View ${escapeHtml(device.serialNumber)} details">
        <td><strong>${escapeHtml(device.serialNumber)}</strong><span class="mobile-model">${escapeHtml(device.manufacturer)} ${escapeHtml(device.model)}</span></td>
        <td>${escapeHtml(device.manufacturer)} ${escapeHtml(device.model)}</td>
        <td><span class="mono">${escapeHtml(device.groupTag)}</span></td>
        <td>${device.assignedUser ? escapeHtml(device.assignedUser) : '<span class="muted">Shared / unassigned</span>'}</td>
        <td><span class="status status--${status}">${statusLabel(status)}</span></td>
      </tr>`;
  }).join("");

  elements.tableBody.querySelectorAll("tr").forEach((row) => {
    const select = () => {
      state.selectedDevice = row.dataset.device;
      renderDetail();
      elements.tableBody.querySelectorAll("tr").forEach((item) => item.classList.toggle("is-selected", item === row));
    };
    row.addEventListener("click", select);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
  });
}

function renderFindings() {
  if (!state.result.findings.length) {
    elements.findings.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">✓</span>
        <strong>No findings detected</strong>
        <p>This synthetic batch passed the intake checks. A technician would document the review and hand off the generated CSV for controlled upload.</p>
      </div>`;
    return;
  }

  elements.findings.innerHTML = state.result.findings.map((finding) => `
    <button class="finding finding--${finding.severity}" type="button" data-device="${escapeHtml(finding.device)}">
      <span class="severity">${escapeHtml(finding.severity)}</span>
      <span class="finding-copy">
        <strong>${escapeHtml(finding.device)} · ${escapeHtml(finding.check.replaceAll("-", " "))}</strong>
        <span>${escapeHtml(finding.message)}</span>
        <small>${escapeHtml(finding.action)}</small>
      </span>
      <span class="arrow" aria-hidden="true">→</span>
    </button>`).join("");

  elements.findings.querySelectorAll(".finding").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDevice = button.dataset.device;
      renderDetail();
      document.querySelector('[data-panel="devices"]').scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

function renderDetail() {
  const device = state.result.devices.find((item) => item.serialNumber === state.selectedDevice);
  if (!device) {
    elements.detail.innerHTML = '<p class="muted">Select a device row or finding to inspect the technician handoff details.</p>';
    return;
  }
  const findings = state.result.findings.filter((finding) => finding.device === device.serialNumber);
  elements.detail.innerHTML = `
    <div class="detail-heading">
      <div><span class="eyebrow">Selected device</span><h3>${escapeHtml(device.serialNumber)}</h3></div>
      <span class="status status--${state.result.deviceStatuses[device.serialNumber]}">${statusLabel(state.result.deviceStatuses[device.serialNumber])}</span>
    </div>
    <dl class="device-facts">
      <div><dt>Hardware</dt><dd>${escapeHtml(device.manufacturer)} ${escapeHtml(device.model)}</dd></div>
      <div><dt>Group tag</dt><dd class="mono">${escapeHtml(device.groupTag)}</dd></div>
      <div><dt>Assigned user</dt><dd>${escapeHtml(device.assignedUser || "Shared / unassigned")}</dd></div>
      <div><dt>Purchase date</dt><dd>${escapeHtml(device.purchaseDate || "Not supplied")}</dd></div>
    </dl>
    <div class="handoff-note">
      <strong>Technician handoff</strong>
      <p>${findings.length ? escapeHtml(findings.map((finding) => finding.action).join(" ")) : "No corrective action identified. Confirm the source record, protect the generated import file, and route it to the endpoint administrator."}</p>
    </div>`;
}

function outputData() {
  const payload = buildReportPayload(state.result);
  if (state.activeOutput === "json") {
    return { content: JSON.stringify(payload, null, 2), name: "readiness-report.json", type: "application/json" };
  }
  if (state.activeOutput === "md") {
    return { content: renderMarkdown(payload), name: "readiness-report.md", type: "text/markdown" };
  }
  return { content: rowsToCsv(buildImportRows(state.result.devices)), name: "autopilot-import.csv", type: "text/csv" };
}

function renderOutput() {
  const data = outputData();
  elements.output.textContent = data.content;
  elements.download.textContent = `Download ${data.name}`;
}

function renderAll() {
  renderMetrics();
  renderTable();
  renderFindings();
  renderDetail();
  renderOutput();
}

function runAudit({ announce = true } = {}) {
  elements.run.disabled = true;
  elements.run.classList.add("is-running");
  elements.status.textContent = "Validating schema, identity, assignments, and device age…";
  window.setTimeout(() => {
    state.result = validateIntake(state.devices);
    state.selectedDevice = state.result.devices[0]?.serialNumber ?? null;
    renderAll();
    elements.run.disabled = false;
    elements.run.classList.remove("is-running");
    const { deviceCount, readyDeviceCount, blockedDeviceCount } = state.result.summary;
    elements.status.textContent = announce
      ? `Audit complete: ${readyDeviceCount} of ${deviceCount} devices ready; ${blockedDeviceCount} need review.`
      : "Demo loaded. Choose a scenario, then run the intake audit.";
  }, announce ? 520 : 0);
}

elements.scenario.addEventListener("change", () => {
  const scenario = scenarios[elements.scenario.value];
  state.devices = structuredClone(scenario.devices);
  state.customFileName = "";
  elements.file.value = "";
  elements.fileLabel.textContent = "Load your own CSV locally";
  elements.scenarioDescription.textContent = scenario.description;
  elements.status.textContent = `${scenario.label} selected. Run the audit to refresh the results.`;
});

elements.run.addEventListener("click", () => runAudit());

elements.file.addEventListener("change", async () => {
  const file = elements.file.files[0];
  if (!file) return;
  try {
    state.devices = parseCsv(await file.text());
    state.customFileName = file.name;
    elements.fileLabel.textContent = file.name;
    elements.scenarioDescription.textContent = `${state.devices.length} device rows loaded in this browser only. Nothing was uploaded.`;
    elements.status.textContent = "Local CSV ready. Run the audit to validate it.";
  } catch (error) {
    elements.status.textContent = `Could not load CSV: ${error.message}`;
    elements.file.value = "";
    elements.fileLabel.textContent = "Load your own CSV locally";
  }
});

document.querySelectorAll("[data-output]").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeOutput = tab.dataset.output;
    document.querySelectorAll("[data-output]").forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-selected", selected);
    });
    renderOutput();
  });
});

elements.download.addEventListener("click", () => {
  const data = outputData();
  const url = URL.createObjectURL(new Blob([data.content], { type: data.type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = data.name;
  anchor.click();
  URL.revokeObjectURL(url);
});

$("#start-tour").addEventListener("click", () => {
  $("#lab").scrollIntoView({ behavior: "smooth" });
  elements.scenario.focus({ preventScroll: true });
});

$("#current-year").textContent = new Date().getFullYear();
runAudit({ announce: false });
