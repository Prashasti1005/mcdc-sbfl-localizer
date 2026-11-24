import * as vscode from 'vscode';
import { RankedSuspect, SbflFormula } from './types';

export class HeatmapDecorator {
  private highCondDecoration: vscode.TextEditorDecorationType;
  private medCondDecoration: vscode.TextEditorDecorationType;
  private lowCondDecoration: vscode.TextEditorDecorationType;
  private stmtDecoration: vscode.TextEditorDecorationType;

  private activeSuspects: RankedSuspect[] = [];
  private activeFormula: SbflFormula = 'Ochiai';

  constructor() {
    this.highCondDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(239, 68, 68, 0.30)',
      border: '1px solid rgba(239, 68, 68, 0.85)',
      borderRadius: '3px',
      overviewRulerColor: '#ef4444',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.medCondDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(245, 158, 11, 0.25)',
      border: '1px solid rgba(245, 158, 11, 0.75)',
      borderRadius: '3px',
      overviewRulerColor: '#f59e0b',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.lowCondDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(234, 179, 8, 0.14)',
      borderRadius: '2px',
    });

    this.stmtDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(59, 130, 246, 0.12)',
      isWholeLine: false,
    });
  }

  public update(suspects: RankedSuspect[], formula: SbflFormula): void {
    this.activeSuspects = suspects;
    this.activeFormula = formula;
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyToEditor(editor);
    }
  }

  public clear(): void {
    this.activeSuspects = [];
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.highCondDecoration, []);
      editor.setDecorations(this.medCondDecoration, []);
      editor.setDecorations(this.lowCondDecoration, []);
      editor.setDecorations(this.stmtDecoration, []);
    }
  }

  public applyToEditor(editor: vscode.TextEditor): void {
    const filePath = editor.document.uri.fsPath;
    const matching = this.activeSuspects.filter((s) => s.probe.filePath === filePath);

    if (matching.length === 0) {
      editor.setDecorations(this.highCondDecoration, []);
      editor.setDecorations(this.medCondDecoration, []);
      editor.setDecorations(this.lowCondDecoration, []);
      editor.setDecorations(this.stmtDecoration, []);
      return;
    }

    const highRanges: vscode.DecorationOptions[] = [];
    const medRanges: vscode.DecorationOptions[] = [];
    const lowRanges: vscode.DecorationOptions[] = [];
    const stmtRanges: vscode.DecorationOptions[] = [];

    // Normalize DStar to [0, 1] for color bucketing
    const maxDStar = Math.max(1e-9, ...matching.map((m) => m.dstar));

    for (const item of matching) {
      const range = new vscode.Range(
        new vscode.Position(item.probe.startLine, item.probe.startCol),
        new vscode.Position(item.probe.endLine, item.probe.endCol)
      );

      const normScore =
        this.activeFormula === 'Tarantula'
          ? item.tarantula
          : this.activeFormula === 'DStar'
          ? item.dstar / maxDStar
          : item.ochiai;

      const activeScore =
        this.activeFormula === 'Tarantula'
          ? item.tarantula
          : this.activeFormula === 'DStar'
          ? item.dstar
          : item.ochiai;

      const activeRank =
        this.activeFormula === 'Tarantula'
          ? item.rankTarantula
          : this.activeFormula === 'DStar'
          ? item.rankDStar
          : item.rankOchiai;

      const activeGain =
        this.activeFormula === 'Tarantula'
          ? item.rankGainTarantula
          : this.activeFormula === 'DStar'
          ? item.rankGainDStar
          : item.rankGainOchiai;

      const hover = new vscode.MarkdownString(
        `### MC/DC-SBFL Suspiciousness (${this.activeFormula})\n` +
          `- **Snippet:** \`${item.probe.snippet}\`\n` +
          `- **Type:** ${item.probe.kind === 'MCDC_CONDITION' ? 'Atomic Sub-Condition' : 'Statement'}\n` +
          `- **Global Rank:** **#${activeRank}** (${activeGain >= 0 ? `+${activeGain}` : activeGain} vs. Decision-Level SBFL)\n` +
          `- **Tarantula:** \`${item.tarantula}\` (Basic: \`${item.basicTarantula}\`)\n` +
          `- **Ochiai:** \`${item.ochiai}\` (Basic: \`${item.basicOchiai}\`)\n` +
          `- **DStar:** \`${item.dstar}\` (Basic: \`${item.basicDStar}\`)\n` +
          `- **Coverage:** \`ef = ${item.ef}\` failing, \`ep = ${item.ep}\` passing`
      );

      const opt: vscode.DecorationOptions = {
        range,
        hoverMessage: hover,
        renderOptions:
          item.probe.kind === 'MCDC_CONDITION' && normScore >= 0.5
            ? {
                after: {
                  contentText: `  [${this.activeFormula}: ${activeScore} | Rank #${activeRank}]`,
                  color: normScore >= 0.8 ? '#f87171' : '#fbbf24',
                  fontStyle: 'italic',
                },
              }
            : undefined,
      };

      if (item.probe.kind === 'STATEMENT') {
        stmtRanges.push(opt);
      } else if (normScore >= 0.8) {
        highRanges.push(opt);
      } else if (normScore >= 0.5) {
        medRanges.push(opt);
      } else {
        lowRanges.push(opt);
      }
    }

    editor.setDecorations(this.highCondDecoration, highRanges);
    editor.setDecorations(this.medCondDecoration, medRanges);
    editor.setDecorations(this.lowCondDecoration, lowRanges);
    editor.setDecorations(this.stmtDecoration, stmtRanges);
  }

  public dispose(): void {
    this.highCondDecoration.dispose();
    this.medCondDecoration.dispose();
    this.lowCondDecoration.dispose();
    this.stmtDecoration.dispose();
  }
}