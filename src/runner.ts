import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { instrumentCSource } from './instrumenter';
import { rankSuspiciousness } from './sbflEngine';
import {
  LocalizationSessionResult,
  McdcProjectConfig,
  ProbeLocation,
  TestCaseConfig,
  TestTrace,
} from './types';

function execFileAsync(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const exitCode = typeof err.code === 'number' ? err.code : 1;
        resolve({ code: exitCode, stdout: stdout ?? '', stderr: stderr ?? err.message });
      } else {
        resolve({ code: 0, stdout: stdout ?? '', stderr: stderr ?? '' });
      }
    });
  });
}

function splitShellArgs(argStr: string): string[] {
  const args: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < argStr.length; i++) {
    const ch = argStr[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length > 0) {
        args.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) {
    args.push(cur);
  }
  return args;
}

function loadUniverseTestCases(universePath: string, workspaceRoot: string): TestCaseConfig[] {
  const raw = fs.readFileSync(universePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const cases: TestCaseConfig[] = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const pMatch = trimmed.match(/-P\s*\[(.*?)\]/);
    const iMatch = trimmed.match(/-I\s*\[(.*?)\]/);

    if (pMatch || iMatch) {
      const argPart = pMatch ? pMatch[1].trim() : '';
      const stdinFile = iMatch ? path.resolve(workspaceRoot, iMatch[1].trim()) : undefined;
      cases.push({
        name: `Test #${idx + 1}`,
        args: argPart ? splitShellArgs(argPart) : [],
        stdinFile,
      });
    } else {
      let argPart = trimmed;
      let stdinFile: string | undefined;
      if (trimmed.includes('<')) {
        const [left, right] = trimmed.split('<', 2);
        argPart = left.trim();
        stdinFile = path.resolve(workspaceRoot, right.trim().replace(/^["']|["']$/g, ''));
      }
      cases.push({
        name: `Test #${idx + 1}`,
        args: argPart ? splitShellArgs(argPart) : [],
        stdinFile,
      });
    }
  });

  return cases;
}

function runInstrumentedBinary(
  binPath: string,
  tc: TestCaseConfig,
  index: number,
  cwd: string,
  timeoutMs: number
): Promise<TestTrace> {
  return new Promise((resolve) => {
    const child = spawn(binPath, tc.args ?? [], { cwd });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    if (tc.stdinFile && fs.existsSync(tc.stdinFile)) {
      fs.createReadStream(tc.stdinFile).pipe(child.stdin);
    } else {
      child.stdin.end();
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const evalCondIds: number[] = [];
      const evalStmtIds: number[] = [];

      for (const line of stderr.split(/\r?\n/)) {
        if (line.startsWith('MCDC_EVAL:')) {
          const parts = line.split(':');
          const cid = Number(parts[1]);
          if (!Number.isNaN(cid)) {
            evalCondIds.push(cid);
          }
        } else if (line.startsWith('STMT_EVAL:')) {
          const parts = line.split(':');
          const sid = Number(parts[1]);
          if (!Number.isNaN(sid)) {
            evalStmtIds.push(sid);
          }
        }
      }

      let passed = !timedOut;
      if (passed) {
        if (tc.expectedStdoutFile && fs.existsSync(tc.expectedStdoutFile)) {
          const expectedOut = fs.readFileSync(tc.expectedStdoutFile, 'utf8').trim();
          passed = stdout.trim() === expectedOut;
        } else {
          const expectedCode = tc.expectedExitCode ?? 0;
          passed = (code ?? 1) === expectedCode;
        }
      }

      resolve({
        tcIndex: index,
        name: tc.name ?? `Test #${index + 1}`,
        passed,
        evalCondIds,
        evalStmtIds,
      });
    });
  });
}

export async function executeFaultLocalization(
  workspaceRoot: string,
  config: McdcProjectConfig,
  onProgress: (msg: string) => void
): Promise<LocalizationSessionResult> {
  const targetAbsPath = path.resolve(workspaceRoot, config.targetFile);
  if (!fs.existsSync(targetAbsPath)) {
    throw new Error(`Target C file not found: ${targetAbsPath}`);
  }

  const shadowDir = path.join(workspaceRoot, '.vscode', 'mcdc-sbfl-shadow');
  fs.mkdirSync(shadowDir, { recursive: true });

  const rawCode = fs.readFileSync(targetAbsPath, 'utf8');
  const instCPath = path.join(shadowDir, 'instrumented_target.c');
  const binPath = path.join(
    shadowDir,
    process.platform === 'win32' ? 'instrumented_target.exe' : 'instrumented_target'
  );

  const extraSources = (config.extraSources ?? []).map((s) => path.resolve(workspaceRoot, s));
  const compilerFlags = config.compilerFlags ?? ['-O2', '-w', '-lm'];
  const includeDirs = [path.dirname(targetAbsPath), workspaceRoot];

  let compiled = false;
  let finalCondProbes: ProbeLocation[] = [];
  let finalStmtProbes: ProbeLocation[] = [];
  let lastGccErr = '';

  for (const includeStmts of [true, false]) {
    onProgress(
      includeStmts
        ? 'Instrumenting MC/DC atomic sub-conditions & executable statements...'
        : 'Retrying with MC/DC atomic sub-conditions (macro-safe fallback)...'
    );
    const inst = instrumentCSource(rawCode, targetAbsPath, includeStmts);
    if (inst.condProbes.length === 0) {
      throw new Error('No compound boolean decisions (&& / ||) found in target file.');
    }

    fs.writeFileSync(instCPath, inst.instrumentedCode, 'utf8');

    const gccArgs = [
      '-std=gnu89',
      instCPath,
      ...extraSources,
      ...includeDirs.flatMap((inc) => ['-I', inc]),
      ...compilerFlags,
      '-o',
      binPath,
    ];

    const res = await execFileAsync('gcc', gccArgs, workspaceRoot);
    if (res.code === 0) {
      compiled = true;
      finalCondProbes = inst.condProbes;
      finalStmtProbes = inst.stmtProbes;
      break;
    }
    lastGccErr = res.stderr;
  }

  if (!compiled) {
    throw new Error(`GCC compilation failed:\n${lastGccErr}`);
  }

  let testCases: TestCaseConfig[] = [];
  if (config.universeFile) {
    const uniPath = path.resolve(workspaceRoot, config.universeFile);
    if (!fs.existsSync(uniPath)) {
      throw new Error(`Universe test file not found: ${uniPath}`);
    }
    testCases = loadUniverseTestCases(uniPath, workspaceRoot);
  } else if (config.testCases && config.testCases.length > 0) {
    testCases = config.testCases.map((tc) => ({
      ...tc,
      stdinFile: tc.stdinFile ? path.resolve(workspaceRoot, tc.stdinFile) : undefined,
      expectedStdoutFile: tc.expectedStdoutFile
        ? path.resolve(workspaceRoot, tc.expectedStdoutFile)
        : undefined,
    }));
  } else {
    throw new Error('No testCases or universeFile configured in .vscode/mcdc-sbfl.json.');
  }

  onProgress(`Running ${testCases.length} tests in parallel...`);
  const timeoutMs = config.timeoutMs ?? 2000;
  const concurrency = Math.min(8, Math.max(2, os.cpus().length));
  const traces: TestTrace[] = new Array(testCases.length);
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < testCases.length) {
      const idx = cursor++;
      traces[idx] = await runInstrumentedBinary(
        binPath,
        testCases[idx],
        idx,
        workspaceRoot,
        timeoutMs
      );
    }
  });

  await Promise.all(workers);

  const failedCount = traces.filter((t) => !t.passed).length;
  if (failedCount === 0) {
    throw new Error(
      `All ${traces.length} tests passed (0 failing tests). SBFL requires at least 1 failing test.`
    );
  }

  onProgress(
    `Computing Tarantula, Ochiai & DStar rankings (${failedCount} failing / ${traces.length - failedCount} passing)...`
  );
  return rankSuspiciousness(targetAbsPath, traces, finalCondProbes, finalStmtProbes);
}