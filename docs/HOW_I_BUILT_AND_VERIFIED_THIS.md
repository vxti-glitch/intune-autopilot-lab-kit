# How I built and verified this

I built this project to practice the part of an Autopilot handoff that can be demonstrated honestly without a Microsoft tenant or sacrificial device: receiving synthetic intake data, checking it, producing the strict manual-import file, and documenting what an authorized endpoint administrator would still need to verify.

## Design choices

I separated the richer intake file from the five-column Microsoft import file. The intake model can carry manufacturer, model, purchase date, expected group tag, and assigned user for local review. The strict export contains only the five case-sensitive headers Microsoft documents and rejects extra columns or values that would require quotation marks.

I keep local observations separate from tenant-dependent state. A group tag is only an expected mapping here. The browser's sync state and all twelve troubleshooting scenarios are simulations; they do not query Microsoft Graph, Intune, Entra ID, a device, or a deployment service.

## What I ran

- Python parsing, validation, report generation, and unit tests against synthetic CSV data.
- JavaScript validator tests and the local browser simulation.
- Strict-file checks for the five headers, case sensitivity, 500-device maximum, quote restriction, extra-column restriction, and ANSI-compatible output bytes.
- A local CLI run that generated the checked-in synthetic Markdown, JSON, and CSV examples.

The import requirements were checked on **2026-08-31** against [Microsoft Learn: Manually register devices with Windows Autopilot](https://learn.microsoft.com/en-us/autopilot/add-devices). The page states the five-column format, 500-device maximum, case-sensitive headers, no extra columns, no quotation marks, and ANSI-only text requirement.

## What remains unverified

I have not demonstrated tenant registration, dynamic-group evaluation, profile assignment, enrollment, Enrollment Status Page behavior, compliance, application delivery, or production device deployment. I also have not proven that a synthetic hardware hash would be accepted by Microsoft. An authorized endpoint administrator must validate tenant and device state.

## Tradeoffs

1. I write Windows-1252 as a practical ANSI-compatible output. That is explicit and testable, but “ANSI” can refer to a system code page; non-ASCII data may need organization-specific handling.
2. I reject commas, quotes, and line breaks instead of escaping them because Microsoft says quotation marks are not allowed. This is stricter than general CSV and requires cleaning the source value.
3. I model expected group-tag mappings locally so the handoff is explainable, but I deliberately do not infer that a dynamic group, profile, app, or policy actually exists or evaluated successfully.
