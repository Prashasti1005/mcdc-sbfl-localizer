export type SbflFormula = 'Tarantula' | 'Ochiai' | 'DStar';

export type ProbeKind = 'MCDC_CONDITION' | 'STATEMENT';

export interface ProbeLocation {
  id: number;
  kind: ProbeKind;
  filePath: string;
  /** 0-based start line */
  startLine: number;
  /** 0-based start column */
  startCol: number;
  /** 0-based end line */
  endLine: number;
  /** 0-based end column */
  endCol: number;
  /** Exact source snippet (e.g., atomic condition `a > 0` or statement) */
  snippet: string;
  /** Parent decision group ID so Basic vs. MC/DC rank gain can be computed */
  decisionGroupId?: number;
}

export interface InstrumentationResult {
  instrumentedCode: string;
  condProbes: ProbeLocation[];
  stmtProbes: ProbeLocation[];
}

export interface TestCaseConfig {
  name?: string;
  args?: string[];
  stdinFile?: string;
  /** Optional expected stdout/stderr file for oracle comparison; if omitted, exit code 0 == PASS */
  expectedStdoutFile?: string;
  expectedExitCode?: number;
}

export interface McdcProjectConfig {
  /** Entry C file containing main() */
  targetFile: string;
  /** Additional C source files to compile together */
  extraSources?: string[];
  /** Extra compiler flags (e.g., ["-Iinclude", "-DHAVE_CONFIG_H", "-lm"]) */
  compilerFlags?: string[];
  /** Path to a SIR-style .universe testplan file OR explicit testCases array */
  universeFile?: string;
  testCases?: TestCaseConfig[];
  /** Per-test timeout in milliseconds */
  timeoutMs?: number;
}

export interface TestTrace {
  tcIndex: number;
  name: string;
  passed: boolean;
  evalCondIds: number[];
  evalStmtIds: number[];
}

export interface RankedSuspect {
  probe: ProbeLocation;
  ef: number;
  ep: number;
  tarantula: number;
  ochiai: number;
  dstar: number;
  /** Decision-level baseline score (all sub-conditions in the branch tied) */
  basicTarantula: number;
  basicOchiai: number;
  basicDStar: number;
  /** 1-based expected rank across all probes in the program */
  rankTarantula: number;
  rankOchiai: number;
  rankDStar: number;
  /** Rank improvement over decision-level Basic SBFL */
  rankGainTarantula: number;
  rankGainOchiai: number;
  rankGainDStar: number;
  examPercentTarantula: number;
  examPercentOchiai: number;
  examPercentDStar: number;
}

export interface LocalizationSessionResult {
  timestamp: string;
  targetFile: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalCondProbes: number;
  totalStmtProbes: number;
  suspects: RankedSuspect[];
}