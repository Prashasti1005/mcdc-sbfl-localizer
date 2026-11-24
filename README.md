# MC/DC-SBFL Fault Localizer

Sub-expression level Spectrum-Based Fault Localization (SBFL) for C/C++ in Visual Studio Code using Modified Condition/Decision Coverage (MC/DC) condition probes.

## Features

- **Sub-Expression Precision:** Decomposes compound boolean expressions (`&&`, `||`) and relational predicates (`<`, `>`, `<=`, `>=`, `==`, `!=`) into atomic condition probes alongside executable statement probes.
- **Shadow Instrumentation:** Instruments a temporary copy of your source file (`__mcdc_probe` and `_stmt_track`) without ever modifying your original code on disk.
- **Multiple SBFL Metrics:** Computes and ranks suspiciousness using **Ochiai**, **Tarantula**, and **DStar** (`*=2`), including fractional tie-breaking and MC/DC vs. Basic decision-level rank gain.
- **Inline Heatmap & Ranked Sidebar:** Highlights suspicious sub-conditions directly in the editor and lists ranked suspects in the **MC/DC Fault Localizer** sidebar view.

## Prerequisites

- **GCC** (`gcc`) installed and available on your system `PATH`.
- Visual Studio Code `1.85.0` or newer.

## Quick Start

1. Open your C/C++ project in VS Code.
2. Click the **Play** button (**MC/DC-SBFL: Run Fault Localization**) in the top-right editor title bar (or run **`MC/DC-SBFL: Create .vscode/mcdc-sbfl.json Config`** from the Command Palette `Ctrl+Shift+P`).
3. Define your test suite in `.vscode/mcdc-sbfl.json` (see schema below) and click **Play** again.
4. Inspect ranked sub-conditions directly in your editor and in the **Ranked Suspects** sidebar panel.
5. Use the sidebar title bar icons to **Switch Formula** (`Ochiai` / `Tarantula` / `DStar`) or **Clear Heatmap Highlights** when you are ready to resume editing.

## Configuration (`.vscode/mcdc-sbfl.json`)

The extension uses `.vscode/mcdc-sbfl.json` to know which C file to compile and what test inputs to execute. By default, a test case **passes** when the program exits with code `0` and **fails** otherwise.

### Example `.vscode/mcdc-sbfl.json`

```json
{
  "targetFile": "thermal_ctrl.c",
  "extraSources": [],
  "compilerFlags": ["-O0", "-lm"],
  "timeoutMs": 3000,
  "testCases": [
    { "name": "TC1_normal", "args": ["60", "40", "10", "0", "0", "0"] },
    { "name": "TC2_bad_temp", "args": ["-60", "40", "10", "0", "0", "-1"] },
    { "name": "TC3_bug_trigger", "args": ["105", "90", "10", "0", "0", "1"] }
  ]
}