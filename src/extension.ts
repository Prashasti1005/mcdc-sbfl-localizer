import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HeatmapDecorator } from './decorator';
import { executeFaultLocalization } from './runner';
import { SuspectTreeProvider } from './suspectTreeProvider';
import {
  LocalizationSessionResult,
  McdcProjectConfig,
  RankedSuspect,
  SbflFormula,
} from './types';

export function activate(context: vscode.ExtensionContext): void {
  const decorator = new HeatmapDecorator();
  const treeProvider = new SuspectTreeProvider();
  const outputChannel = vscode.window.createOutputChannel('MC/DC-SBFL Localizer');

  let latestSession: LocalizationSessionResult | undefined;

  const getActiveFormula = (): SbflFormula =>
    vscode.workspace
      .getConfiguration('mcdcSbfl')
      .get<SbflFormula>('activeFormula', 'Ochiai');

  vscode.window.registerTreeDataProvider('mcdcSbflSuspectsView', treeProvider);

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const ed of editors) {
        decorator.applyToEditor(ed);
      }
    }),

    vscode.commands.registerCommand('mcdcSbfl.initConfig', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showErrorMessage('Open a C/C++ project folder first.');
        return;
      }

      const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
      const relTarget =
        activeFile && activeFile.startsWith(folder.uri.fsPath)
          ? path.relative(folder.uri.fsPath, activeFile).replace(/\\/g, '/')
          : 'main.c';

      const configDir = path.join(folder.uri.fsPath, '.vscode');
      const configPath = path.join(configDir, 'mcdc-sbfl.json');
      fs.mkdirSync(configDir, { recursive: true });

      const template: McdcProjectConfig = {
        targetFile: relTarget,
        extraSources: [],
        compilerFlags: ['-O2', '-w', '-lm'],
        testCases: [
          { name: 'Passing Case 1', args: ['1', '2'], expectedExitCode: 0 },
          { name: 'Failing Case 1', args: ['0', '-1'], expectedExitCode: 0 },
        ],
        timeoutMs: 2000,
      };

      fs.writeFileSync(configPath, JSON.stringify(template, null, 2), 'utf8');
      const doc = await vscode.workspace.openTextDocument(configPath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(
        'Created .vscode/mcdc-sbfl.json. Configure your testCases or universeFile and run MC/DC Fault Localization.'
      );
    }),

    vscode.commands.registerCommand('mcdcSbfl.runLocalization', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showErrorMessage('Open a workspace folder first.');
        return;
      }

      const configPath = path.join(folder.uri.fsPath, '.vscode', 'mcdc-sbfl.json');
      if (!fs.existsSync(configPath)) {
        const choice = await vscode.window.showWarningMessage(
          'No .vscode/mcdc-sbfl.json found. Create one now?',
          'Create Config'
        );
        if (choice === 'Create Config') {
          await vscode.commands.executeCommand('mcdcSbfl.initConfig');
        }
        return;
      }

      let config: McdcProjectConfig;
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as McdcProjectConfig;
      } catch (err) {
        vscode.window.showErrorMessage(`Invalid JSON in .vscode/mcdc-sbfl.json: ${String(err)}`);
        return;
      }

      outputChannel.clear();
      outputChannel.show(true);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'MC/DC-SBFL Fault Localization',
          cancellable: false,
        },
        async (progress) => {
          try {
            const session = await executeFaultLocalization(
              folder.uri.fsPath,
              config,
              (msg) => {
                progress.report({ message: msg });
                outputChannel.appendLine(`[MC/DC-SBFL] ${msg}`);
              }
            );

            latestSession = session;
            const formula = getActiveFormula();
            treeProvider.setSession(session, formula);
            decorator.update(session.suspects, formula);

            outputChannel.appendLine(
              `\n✅ Completed: ${session.totalTests} tests (${session.failedTests} failed, ${session.passedTests} passed) | ` +
                `${session.totalCondProbes} MC/DC sub-conditions + ${session.totalStmtProbes} statements.`
            );

            vscode.window.showInformationMessage(
              `MC/DC-SBFL ranked ${session.suspects.length} suspect elements (${session.failedTests} failing tests).`
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine(`❌ Error: ${message}`);
            vscode.window.showErrorMessage(`MC/DC-SBFL failed: ${message}`);
          }
        }
      );
    }),

    vscode.commands.registerCommand('mcdcSbfl.switchFormula', async () => {
      const formulas: SbflFormula[] = ['Ochiai', 'Tarantula', 'DStar'];
      const picked = (await vscode.window.showQuickPick(formulas, {
        placeHolder: 'Select SBFL Suspiciousness Formula',
      })) as SbflFormula | undefined;
      if (!picked) {
        return;
      }
      await vscode.workspace
        .getConfiguration('mcdcSbfl')
        .update('activeFormula', picked, vscode.ConfigurationTarget.Workspace);

      treeProvider.setFormula(picked);
      if (latestSession) {
        decorator.update(latestSession.suspects, picked);
      }
    }),

    vscode.commands.registerCommand('mcdcSbfl.clearHighlights', () => {
      latestSession = undefined;
      decorator.clear();
      treeProvider.setSession(undefined, getActiveFormula());
    }),

    vscode.commands.registerCommand('mcdcSbfl.jumpToSuspect', async (suspect: RankedSuspect) => {
      if (!suspect) {
        return;
      }
      const doc = await vscode.workspace.openTextDocument(suspect.probe.filePath);
      const editor = await vscode.window.showTextDocument(doc);
      const range = new vscode.Range(
        new vscode.Position(suspect.probe.startLine, suspect.probe.startCol),
        new vscode.Position(suspect.probe.endLine, suspect.probe.endCol)
      );
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }),

    decorator,
    outputChannel
  );
}

export function deactivate(): void {}