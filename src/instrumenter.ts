import { InstrumentationResult, ProbeLocation } from './types';

interface LineIndex {
  lineStarts: number[];
}

function buildLineIndex(code: string): LineIndex {
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  return { lineStarts };
}

function offsetToPos(idx: LineIndex, offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = idx.lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.lineStarts[mid] <= offset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { line: hi, col: offset - idx.lineStarts[hi] };
}

/**
 * Strips comments and string/char literals with spaces of equal length
 * so character offsets remain 1:1 identical to the original source file.
 */
function maskNonCode(code: string): string {
  const chars = code.split('');
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === '/' && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n') {
        chars[i++] = ' ';
      }
    } else if (chars[i] === '/' && chars[i + 1] === '*') {
      chars[i++] = ' ';
      chars[i++] = ' ';
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n') {
          chars[i] = ' ';
        }
        i++;
      }
      if (i < chars.length) {
        chars[i++] = ' ';
        chars[i++] = ' ';
      }
    } else if (chars[i] === '"') {
      chars[i++] = ' ';
      while (i < chars.length && chars[i] !== '"') {
        if (chars[i] === '\\' && i + 1 < chars.length) {
          chars[i++] = ' ';
        }
        if (i < chars.length && chars[i] !== '\n') {
          chars[i] = ' ';
        }
        i++;
      }
      if (i < chars.length) {
        chars[i++] = ' ';
      }
    } else if (chars[i] === "'") {
      chars[i++] = ' ';
      while (i < chars.length && chars[i] !== "'") {
        if (chars[i] === '\\' && i + 1 < chars.length) {
          chars[i++] = ' ';
        }
        if (i < chars.length && chars[i] !== '\n') {
          chars[i] = ' ';
        }
        i++;
      }
      if (i < chars.length) {
        chars[i++] = ' ';
      }
    } else {
      i++;
    }
  }
  return chars.join('');
}

interface Span {
  start: number;
  end: number;
}

/**
 * Recursively decomposes a boolean expression into atomic sub-condition spans
 * at top-level `&&` and `||` operators, unwrapping redundant outer parentheses.
 */
function extractAtomicConditions(masked: string, start: number, end: number): Span[] {
  let s = start;
  let e = end;

  while (s < e && /\s/.test(masked[s])) s++;
  while (e > s && /\s/.test(masked[e - 1])) e--;

  while (s < e && masked[s] === '(' && masked[e - 1] === ')') {
    let depth = 0;
    let wrapsEntire = true;
    for (let i = s; i < e; i++) {
      if (masked[i] === '(') depth++;
      else if (masked[i] === ')') {
        depth--;
        if (depth === 0 && i < e - 1) {
          wrapsEntire = false;
          break;
        }
      }
    }
    if (wrapsEntire) {
      s++;
      e--;
      while (s < e && /\s/.test(masked[s])) s++;
      while (e > s && /\s/.test(masked[e - 1])) e--;
    } else {
      break;
    }
  }

  let depth = 0;
  for (let i = s; i < e - 1; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth === 0) {
      if (
        (ch === '&' && masked[i + 1] === '&') ||
        (ch === '|' && masked[i + 1] === '|')
      ) {
        const left = extractAtomicConditions(masked, s, i);
        const right = extractAtomicConditions(masked, i + 2, e);
        return [...left, ...right];
      }
    }
  }

  return s < e ? [{ start: s, end: e }] : [];
}

interface TextEdit {
  start: number;
  end: number;
  replacement: string;
}

const RUNTIME_HEADER = `
/* === MC/DC-SBFL Shadow Runtime Probes === */
#include <stdio.h>
static int __mcdc_probe(int cid, int val) {
    int b = val ? 1 : 0;
    fprintf(stderr, "MCDC_EVAL:%d:%d\\n", cid, b);
    return b;
}
static void _stmt_track(int sid) {
    fprintf(stderr, "STMT_EVAL:%d\\n", sid);
}
/* ======================================== */
`;

export function instrumentCSource(
  rawCode: string,
  filePath: string,
  includeStmts = true
): InstrumentationResult {
  const masked = maskNonCode(rawCode);
  const lineIndex = buildLineIndex(rawCode);
  const condProbes: ProbeLocation[] = [];
  const stmtProbes: ProbeLocation[] = [];
  const edits: TextEdit[] = [];
  const coveredRanges: Span[] = [];

  // 1. Instrument all `if (...)` and `while (...)` decisions (both single and compound)
  const ctrlRegex = /\b(if|while)\s*\(/g;
  let match: RegExpExecArray | null;
  let decisionGroupId = 0;

  while ((match = ctrlRegex.exec(masked)) !== null) {
    const openParen = masked.indexOf('(', match.index);
    if (openParen === -1) continue;

    let depth = 1;
    let i = openParen + 1;
    while (i < masked.length && depth > 0) {
      if (masked[i] === '(') depth++;
      else if (masked[i] === ')') depth--;
      i++;
    }
    if (depth !== 0) continue;

    const closeParen = i - 1;
    const atoms = extractAtomicConditions(masked, openParen + 1, closeParen);
    if (atoms.length === 0) continue;

    const currentGroupId = decisionGroupId++;
    coveredRanges.push({ start: match.index, end: closeParen + 1 });

    for (const atom of atoms) {
      const cid = condProbes.length;
      const startPos = offsetToPos(lineIndex, atom.start);
      const endPos = offsetToPos(lineIndex, atom.end);
      const exprText = rawCode.slice(atom.start, atom.end).trim();

      condProbes.push({
        id: cid,
        kind: 'MCDC_CONDITION',
        filePath,
        startLine: startPos.line,
        startCol: startPos.col,
        endLine: endPos.line,
        endCol: endPos.col,
        snippet: exprText,
        decisionGroupId: currentGroupId,
      });

      edits.push({
        start: atom.start,
        end: atom.end,
        replacement: `__mcdc_probe(${cid}, (${rawCode.slice(atom.start, atom.end)}))`,
      });
    }

    // Instrument single-line inline body statements like `if (argc < 7) return 99;`
    if (includeStmts) {
      let bodyStart = closeParen + 1;
      while (bodyStart < masked.length && /\s/.test(masked[bodyStart])) {
        bodyStart++;
      }
      if (
        bodyStart < masked.length &&
        masked[bodyStart] !== '{' &&
        !masked.slice(bodyStart).startsWith('if')
      ) {
        let bodyEnd = bodyStart;
        let pDepth = 0;
        while (bodyEnd < masked.length) {
          const c = masked[bodyEnd];
          if (c === '(' || c === '[') pDepth++;
          else if (c === ')' || c === ']') pDepth--;
          else if (c === ';' && pDepth === 0) {
            bodyEnd++;
            break;
          }
          bodyEnd++;
        }
        const stmtText = rawCode.slice(bodyStart, bodyEnd).trim();
        if (stmtText.endsWith(';') && stmtText.length > 1) {
          const sid = stmtProbes.length;
          const sPos = offsetToPos(lineIndex, bodyStart);
          const ePos = offsetToPos(lineIndex, bodyEnd);
          stmtProbes.push({
            id: sid,
            kind: 'STATEMENT',
            filePath,
            startLine: sPos.line,
            startCol: sPos.col,
            endLine: ePos.line,
            endCol: ePos.col,
            snippet: stmtText,
          });
          coveredRanges.push({ start: bodyStart, end: bodyEnd });
          edits.push({
            start: bodyStart,
            end: bodyEnd,
            replacement: `{ _stmt_track(${sid}); ${rawCode.slice(bodyStart, bodyEnd)} }`,
          });
        }
      }
    }
  }

  // 2. Instrument standalone executable statements inside function bodies
  if (includeStmts) {
    const lines = rawCode.split('\n');
    const maskedLines = masked.split('\n');
    let braceDepth = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const mLine = maskedLines[lineIdx];
      const lineStartOffset = lineIndex.lineStarts[lineIdx];

      const openBraces = (mLine.match(/\{/g) || []).length;
      const closeBraces = (mLine.match(/\}/g) || []).length;
      const trimmed = mLine.trim();

      const isInsideFunc = braceDepth >= 1;
      braceDepth += openBraces - closeBraces;

      if (!isInsideFunc || !trimmed || !trimmed.endsWith(';')) continue;
      if (trimmed.startsWith('#')) continue;
      if (/^(if|else|while|for|switch|case|default|typedef|struct|enum|extern|static\s+const)\b/.test(trimmed)) {
        continue;
      }
      if (/^(int|char|float|double|long|short|unsigned|signed|void|const|struct)\b/.test(trimmed) && !trimmed.includes('=')) {
        continue;
      }

      const firstNonSpace = mLine.search(/\S/);
      if (firstNonSpace === -1) continue;
      const absStart = lineStartOffset + firstNonSpace;
      const absEnd = lineStartOffset + mLine.trimEnd().length;

      const overlaps = coveredRanges.some(
        (r) => !(absEnd <= r.start || absStart >= r.end)
      );
      if (overlaps) continue;

      const sid = stmtProbes.length;
      const stmtText = rawCode.slice(absStart, absEnd).trim();
      stmtProbes.push({
        id: sid,
        kind: 'STATEMENT',
        filePath,
        startLine: lineIdx,
        startCol: firstNonSpace,
        endLine: lineIdx,
        endCol: mLine.trimEnd().length,
        snippet: stmtText,
      });

      edits.push({
        start: absStart,
        end: absEnd,
        replacement: `_stmt_track(${sid}); ${rawCode.slice(absStart, absEnd)}`,
      });
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let instrumentedBody = rawCode;
  for (const edit of edits) {
    instrumentedBody =
      instrumentedBody.slice(0, edit.start) +
      edit.replacement +
      instrumentedBody.slice(edit.end);
  }

  return {
    instrumentedCode: RUNTIME_HEADER + '\n' + instrumentedBody,
    condProbes,
    stmtProbes,
  };
}