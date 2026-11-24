# MC/DC-SBFL Fault Localizer

[![Open VSX Version](https://img.shields.io/open-vsx/v/prashasti1005/mcdc-sbfl-localizer)](https://open-vsx.org/extension/prashasti1005/mcdc-sbfl-localizer)
[![GitHub Release](https://img.shields.io/github/v/release/Prashasti1005/mcdc-sbfl-localizer)](https://github.com/Prashasti1005/mcdc-sbfl-localizer/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Sub-expression level Spectrum-Based Fault Localization (SBFL) for C and C++ in VS Code.**  
Pinpoint the exact buggy atomic condition inside complex `if`, `while`, and `for` boolean expressions using non-destructive Modified Condition/Decision Coverage (MC/DC) shadow instrumentation.

---

## Why Sub-Expression Level SBFL?

Traditional statement-level fault localization highlights an entire `if ((a > 0 && b < 10) || c == 1)` line as suspicious. **MC/DC-SBFL Fault Localizer** decomposes compound boolean expressions into individual atomic sub-conditions, instruments shadow copies of your code without touching your original source files, runs your test suite in parallel, and ranks every sub-condition and executable statement by suspiciousness.

---

## Key Features

* **Atomic MC/DC Sub-Condition Instrumentation:** Isolates individual predicates inside compound boolean decisions (`&&`, `||`, `!`) alongside executable statements.
* **Non-Destructive Shadow Execution:** Compiles and runs instrumented code inside `.vscode/mcdc-shadow/`, keeping your workspace source files completely untouched.
* **Multiple SBFL Ranking Metrics:** Switch seamlessly between **Ochiai**, **Tarantula**, and **DStar** ($D^*$) suspiciousness formulas.
* **Inline Editor Heatmap & Sidebar Tree View:** Highlights high-risk sub-expressions directly in the editor with suspiciousness scores and ranks, paired with a dedicated **MC/DC Fault Localizer** Activity Bar panel for one-click navigation.
* **Parallel Test Runner:** Executes test cases concurrently with configurable timeouts and compiler flags.

---

## Prerequisites

* **OS:** Windows, macOS, or Linux
* **Compiler:** `gcc` or `g++` available in your system `PATH`
* **Editor:** VS Code `^1.85.0`, Cursor, VSCodium, Windsurf, or Gitpod

---

## Installation

### Option 1: Open VSX Registry (Cursor, VSCodium, Windsurf, Gitpod)
1. Open the **Extensions** panel (`Ctrl + Shift + X` / `Cmd + Shift + X`).
2. Search for **`MC/DC-SBFL Fault Localizer`** (`prashasti1005.mcdc-sbfl-localizer`) and click **Install**.
3. Alternatively, visit the **[Open VSX Registry Listing](https://open-vsx.org/extension/prashasti1005/mcdc-sbfl-localizer)**.

### Option 2: Standard Microsoft VS Code (`.vsix` Installer)
1. Download `mcdc-sbfl-localizer-1.0.0.vsix` from **[GitHub Releases](https://github.com/Prashasti1005/mcdc-sbfl-localizer/releases/latest)**.
2. In VS Code, open the **Extensions** panel (`Ctrl + Shift + X`), click the **`...`** menu at the top right, and select **Install from VSIX...** (or run `code --install-extension mcdc-sbfl-localizer-1.0.0.vsix`).

---

## Quick Start

### 1. Create a Sample C File (`thermal_ctrl.c`)
Your target program should accept test inputs via command-line arguments (`argv`) and return exit code `0` when the test passes, or non-zero when it fails:

```c
#include <stdio.h>
#include <stdlib.h>

/* Bug: >= 90 instead of > 95 triggers premature shutdown on valid high load */
int check_shutdown(int temp, int load, int override_flag) {
    if ((temp > 100 && load >= 90) || override_flag == 1) {
        return 1;
    }
    return 0;
}

int main(int argc, char *argv[]) {
    if (argc < 5) return 2;
    int actual = check_shutdown(atoi(argv[1]), atoi(argv[2]), atoi(argv[3]));
    int expected = atoi(argv[4]);
    return (actual == expected) ? 0 : 1;
}
```

### 2. Configure Test Cases (`.vscode/mcdc-sbfl.json`)
Run **`MC/DC-SBFL: Create .vscode/mcdc-sbfl.json Config`** from the Command Palette (`Ctrl + Shift + P`) or create `.vscode/mcdc-sbfl.json` manually:

```json
{
  "targetFile": "thermal_ctrl.c",
  "compilerFlags": ["-O0"],
  "timeoutMs": 3000,
  "testCases": [
    { "name": "TC1_normal_low",       "args": ["70", "50", "0", "0"] },
    { "name": "TC2_high_temp_low_ld", "args": ["105", "40", "0", "0"] },
    { "name": "TC3_override_active",  "args": ["60", "30", "1", "1"] },
    { "name": "TC4_true_emergency",   "args": ["105", "98", "0", "1"] },
    { "name": "TC5_bug_trigger",      "args": ["102", "90", "0", "0"] }
  ]
}
```

### 3. Run Fault Localization
1. Open `thermal_ctrl.c` and click the **Play** icon (**`MC/DC-SBFL: Run Fault Localization`**) in the top-right editor toolbar.
2. Inspect the inline heatmap highlighting `load >= 90` on line 6 as the top suspect.
3. Open the **MC/DC Fault Localizer** view in the Activity Bar to inspect all ranked probes, switch formulas, or clear highlights.

---

## Supported SBFL Formulas

Let $e_f$ and $e_p$ be the number of failing and passing test cases that execute a probe (sub-condition or statement), and $n_f, n_p$ be the total number of failing and passing test cases:

| Formula | Equation | Best Used For |
| :--- | :--- | :--- |
| **Ochiai** (Default) | $\frac{e_f}{\sqrt{(e_f + n_f) \cdot (e_f + e_p)}}$ | High precision in isolating single-fault sub-expressions |
| **Tarantula** | $\frac{e_f / (e_f + n_f)}{e_f / (e_f + n_f) + e_p / (e_p + n_p)}$ | Balanced suspiciousness across varying pass/fail ratios |
| **DStar ($D^*$)** | $\frac{e_f^*}{e_p + n_f}$ ($*=2$) | Emphasizing probes executed almost exclusively by failing runs |

---

## Commands & Settings

### Commands (`Ctrl + Shift + P`)
* `MC/DC-SBFL: Run Fault Localization` — Instruments shadow files, executes all configured tests, and updates the heatmap and sidebar.
* `MC/DC-SBFL: Create .vscode/mcdc-sbfl.json Config` — Scaffolds a starter test configuration in your workspace.
* `MC/DC-SBFL: Switch Formula (Tarantula / Ochiai / DStar)` — Re-ranks suspects live without recompiling or re-running tests.
* `MC/DC-SBFL: Clear Heatmap Highlights` — Removes all inline suspiciousness decorations from the editor.

### Extension Settings
* `mcdcSbfl.activeFormula`: Default SBFL metric (`"Ochiai"`, `"Tarantula"`, or `"DStar"`).
* `mcdcSbfl.topKDisplay`: Maximum number of ranked suspect probes displayed in the sidebar (default: `50`).

---

## Project Architecture

```text
├── src/
│   ├── extension.ts            # VS Code command & view lifecycle registration
│   ├── instrumenter.ts         # AST/token-aware C/C++ MC/DC probe injector
│   ├── runner.ts               # Shadow compilation & parallel test execution
│   ├── sbflEngine.ts           # Ochiai, Tarantula, and DStar spectrum scoring
│   ├── decorator.ts            # Inline editor heatmap & rank annotations
│   ├── suspectTreeProvider.ts  # Activity Bar ranked suspects tree view
│   └── types.ts                # Core interfaces for probes, spectra, and config
├── package.json
└── tsconfig.json
```

---

## License

Released under the [MIT License](LICENSE) © 2026 Prashasti Singh.