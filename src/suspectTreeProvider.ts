import * as path from 'path';
import * as vscode from 'vscode';
import { sortSuspectsByFormula } from './sbflEngine';
import { LocalizationSessionResult, RankedSuspect, SbflFormula } from './types';

export class SuspectTreeItem extends vscode.TreeItem {
  constructor(
    public readonly suspect: RankedSuspect,
    formula: SbflFormula,
    positionIndex: number
  ) {
    const score =
      formula === 'Tarantula'
        ? suspect.tarantula
        : formula === 'DStar'
        ? suspect.dstar
        : suspect.ochiai;
    const rank =
      formula === 'Tarantula'
        ? suspect.rankTarantula
        : formula === 'DStar'
        ? suspect.rankDStar
        : suspect.rankOchiai;
    const gain =
      formula === 'Tarantula'
        ? suspect.rankGainTarantula
        : formula === 'DStar'
        ? suspect.rankGainDStar
        : suspect.rankGainOchiai;

    const kindBadge = suspect.probe.kind === 'MCDC_CONDITION' ? 'COND' : 'STMT';
    super(`#${positionIndex + 1} [${kindBadge}] ${suspect.probe.snippet}`, vscode.TreeItemCollapsibleState.None);

    const fileName = path.basename(suspect.probe.filePath);
    const lineOneBased = suspect.probe.startLine + 1;
    const gainTag = gain > 0 ? ` | ↑${gain} ranks` : '';

    this.description = `${formula}: ${score} (Rank #${rank}${gainTag}) · ${fileName}:${lineOneBased}`;
    this.tooltip =
      `${suspect.probe.snippet}\n` +
      `Location: ${fileName}:${lineOneBased}:${suspect.probe.startCol + 1}\n` +
      `Tarantula: ${suspect.tarantula} | Ochiai: ${suspect.ochiai} | DStar: ${suspect.dstar}\n` +
      `Failed tests (ef): ${suspect.ef} | Passed tests (ep): ${suspect.ep}`;

    this.iconPath = new vscode.ThemeIcon(
      suspect.probe.kind === 'MCDC_CONDITION' ? 'symbol-boolean' : 'symbol-method',
      positionIndex < 3
        ? new vscode.ThemeColor('errorForeground')
        : new vscode.ThemeColor('editorWarning.foreground')
    );

    this.command = {
      command: 'mcdcSbfl.jumpToSuspect',
      title: 'Jump to Suspect',
      arguments: [suspect],
    };
  }
}

export class SuspectTreeProvider implements vscode.TreeDataProvider<SuspectTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SuspectTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private session: LocalizationSessionResult | undefined;
  private formula: SbflFormula = 'Ochiai';

  public setSession(session: LocalizationSessionResult | undefined, formula: SbflFormula): void {
    this.session = session;
    this.formula = formula;
    this._onDidChangeTreeData.fire();
  }

  public setFormula(formula: SbflFormula): void {
    this.formula = formula;
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: SuspectTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(): SuspectTreeItem[] {
    if (!this.session) {
      return [];
    }
    const maxItems = vscode.workspace
      .getConfiguration('mcdcSbfl')
      .get<number>('topKDisplay', 50);
    const sorted = sortSuspectsByFormula(this.session.suspects, this.formula).slice(0, maxItems);
    return sorted.map((s, idx) => new SuspectTreeItem(s, this.formula, idx));
  }
}