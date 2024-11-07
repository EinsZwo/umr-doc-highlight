// @ts-nocheck

let diagnosticCollection: vscode.DiagnosticCollection;


interface MacroDefinition {
  pattern: string;    
  replacement: string;    
}

import { rejects } from "assert";
import { DebugConsoleMode } from "vscode";
import * as fs from 'fs';

const vscode = require('vscode');
const path = require('path');
const os = require('os');
const cp = require('child_process');

let wordTooltipCache: { [word: string]: string } = {}; 
let lastDocumentText = '';  // for caching results
let rolesetCache: { [word: string]: string} = {}

let timeout: NodeJS.Timer | undefined = undefined;

function triggerDiagnosticsUpdate(document: vscode.TextDocument) {
  // time-gated for performance
  if (timeout) {
    clearTimeout(timeout);
  }
  timeout = setTimeout(() => {
    updateDiagnostics(document);
    timeout = undefined;
  }, 500); 
}

function updateDiagnostics(document: vscode.TextDocument): void {
  const config = vscode.workspace.getConfiguration('extension');
  const diagnosticsEnabled = config.get<boolean>('enableDiagnostics', true);

  if (!diagnosticsEnabled) {
    diagnosticCollection.set(document.uri, []);
    return;
  }

  if (document.languageId !== 'plaintext') {
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();

  // find things like "(identifier /""
  const pattern = /\(\s*([a-zA-Z0-9_]+)\s*\/\s*/g;
  let match: RegExpExecArray | null;

  interface IdentifierOccurrence {
    range: vscode.Range;
    lineNumber: number;
    lineText: string;
  }

  const identifiers: { [key: string]: IdentifierOccurrence[] } = {};

  while ((match = pattern.exec(text))) {
    const identifier = match[1];

    const startPos = document.positionAt(match.index + match[0].indexOf(identifier));
    const endPos = startPos.translate(0, identifier.length);
    const range = new vscode.Range(startPos, endPos);
    const lineNumber = startPos.line;
    const lineText = document.lineAt(lineNumber).text.trim();

    const occurrence: IdentifierOccurrence = {
      range,
      lineNumber,
      lineText,
    };

    if (!identifiers[identifier]) {
      identifiers[identifier] = [];
    }
    identifiers[identifier].push(occurrence);
  }

  // Find duplicates and create diagnostics
  for (const identifier in identifiers) {
    const occurrences = identifiers[identifier];
    if (occurrences.length > 1) {
      // For each occurrence, create a diagnostic
      for (let i = 0; i < occurrences.length; i++) {
        const currentOccurrence = occurrences[i];

        // Collect information about other occurrences for the popup
        const otherOccurrencesInfo = occurrences
          .filter((_, index) => index !== i)
          .map(occurrence => {
            const lineNumber = occurrence.lineNumber;
            const lineText = occurrence.lineText;            
            return `[Line ${lineNumber + 1}]: ${lineText}`;
          })
          .join('\n');

        const message = `Duplicate identifier '${identifier}'. ` 
        const diagnostic = new vscode.Diagnostic(
          currentOccurrence.range,
          message,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = 'UMR duplicate variables';

        diagnostics.push(diagnostic);
      }
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
}



function getIdentifierOccurrences(document: vscode.TextDocument, identifier: string): IdentifierOccurrence[] {
  // helper function to find all occurences of a certain UMR varianle ID
  const text = document.getText();
  const pattern = new RegExp(`\\(\\s*(${identifier})\\s*\\/\\s*`, 'g');
  let match: RegExpExecArray | null;

  const occurrences: IdentifierOccurrence[] = [];

  while ((match = pattern.exec(text))) {
    const startPos = document.positionAt(match.index + match[0].indexOf(identifier));
    const endPos = startPos.translate(0, identifier.length);
    const range = new vscode.Range(startPos, endPos);

    const lineNumber = startPos.line;
    const lineText = document.lineAt(lineNumber).text.trim();

    const occurrence: IdentifierOccurrence = {
      range,
      lineNumber,
      lineText,
    };

    occurrences.push(occurrence);
  }

  return occurrences;
}

class DuplicateIdentifierHoverProvider implements vscode.HoverProvider {
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const range = document.getWordRangeAtPosition(position, /\b[a-zA-Z0-9_]+\b/);
    if (!range) {
      return;
    }

    const word = document.getText(range);

    const occurrences = getIdentifierOccurrences(document, word);
    if (occurrences.length <= 1) {
      return;
    }

    const otherOccurrences = occurrences.filter(occ => !occ.range.contains(position));
    if (otherOccurrences.length === 0) {
      return;
    }

    const uri = document.uri;
    const links = otherOccurrences.map(occurrence => {
      const lineNumber = occurrence.lineNumber;
      const lineText = occurrence.lineText;

      const commandUri = encodeURI(
        `command:extension.goToLine?${encodeURIComponent(JSON.stringify([uri.toString(), occurrence.lineNumber]))}`
      );

      return `- [Line ${lineNumber + 1}](${commandUri} "Jump to line ${lineNumber+1}"): ${lineText}`;
    });

    const markdownContent = new vscode.MarkdownString(`\nDeclarations of '${word}' in this document:\n${links.join('\n')}`);
    markdownContent.isTrusted = true;

    return new vscode.Hover(markdownContent, range);
  }
}


function getExecutablePath() {
    // finds the platform-specific Python executable for getting tooltip info
    const platform = os.platform();
    const extensionPath = vscode.extensions.getExtension('mabu4315.umr-doc-helper').extensionPath;
  
    let executableName;
    let executableDir;
  
    if (platform === 'win32') {
      executableName = 'process_document.exe';
      executableDir = 'dist';
    } else {
      vscode.window.showErrorMessage('Unsupported platform');
      return null;
    }
  
    return path.join(extensionPath, 'src', executableDir, executableName);
  }


function generateAlignedText(tiers: Array<Array<string>>, colWidths: Array<number>) {
  // aligns hoverbubble text for variable info
  if((!tiers) || (!tiers.map)) {
    return ""
  }
  return tiers.map(tier => {
    return tier.map((word: string, colIndex: number) => {
      return word.padEnd(colWidths[colIndex], ' ');
    }).join(' ');
  }).join('\n');
}

function createMarkdownContent(alignedText: string) {
  return `\`\`\`plaintext
${alignedText}
\`\`\``;
}


let macros: MacroDefinition[] = [];

function loadMacros() {
  // loads the default and user-specified macros
  const config = vscode.workspace.getConfiguration('extension');
  const userMacrosObject = config.get<{ [pattern: string]: string }>('macros', {});
  const userMacros: MacroDefinition[] = Object.entries(userMacrosObject).map(([pattern, replacement]) => ({
    pattern,
    replacement,
  }));

  console.log("Loaded user macros...:")
  for (let macro of userMacros) {
    console.log(` ${macro.pattern} -> ${macro.replacement}`)
  }

  // const defaultMacros: MacroDefinition[] = [
  //   {
  //     pattern: 'p1s',
  //     replacement: '(p / person \n\t:refer-person 1\n\t:refer-number singular)',
  //   },
  //   {
  //     pattern: 'p1p',
  //     replacement: '(p / person \n\t:refer-person 1\n\t:refer-number plural)',
  //   },
  //   {
  //     pattern: 'p2s',
  //     replacement: '(p / person \n\t:refer-person 2\n\t:refer-number singular)',
  //   },
  //   {
  //     pattern: 'p2p',
  //     replacement: '(p / person \n\t:refer-person 2\n\t:refer-number plural)',
  //   },
  //   {
  //     pattern: 'p3s',
  //     replacement: '(p / person \n\t:refer-person 3\n\t:refer-number singular)',
  //   },
  //   {
  //     pattern: 'p3p',
  //     replacement: '(p / person \n\t:refer-person 3\n\t:refer-number plural)',
  //   },
  //   {
  //     pattern: 'ord(\\d+)',
  //     replacement: '(o / ordinal-entity :value $1)',
  //   },
  // ];
  macros = [  ...userMacros ]//, ...defaultMacros ];
}


loadMacros();

// Watch for configuration changes to update macros
vscode.workspace.onDidChangeConfiguration(event => {
  if (event.affectsConfiguration('extension.macros')) {
    loadMacros();
  }
});

export function activate(context: { subscriptions: any[]; }) {
    console.log('UMR Annotation Helper is now active!');

    const tooltipsPath = path.join(context.extensionPath, 'data', 'tooltips.json');
    try {
      const fileContents = fs.readFileSync(tooltipsPath, 'utf8');
      // TODO: make more customizable; allow specifing a Propbank-like resource that can be scraped and used to generate similar tooltips, but language-specific
      // implement caching based on (git commit hashes?)
      rolesetCache = JSON.parse(fileContents);
      console.log("Loaded roleset tooltips")
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load tooltips: ${err.message}`);
    }

    // Register a hover provider for all file types
    let hover_provider = vscode.languages.registerHoverProvider({ scheme: 'file', language: '*' }, {
        provideHover(document: { getWordRangeAtPosition: (arg0: any, arg1: RegExp) => any; getText: (arg0: any) => any; }, position: any, token: any) {
            // Get the word at the hover position
            const range = document.getWordRangeAtPosition(position, /\w+/);
            const word = range ? document.getText(range) : '';

            const possible_roleset_range = document.getWordRangeAtPosition(position, /[a-zA-Z][a-zA-Z\-]*-\d+/);
          
            let roleset = ''
            if (possible_roleset_range) {
              roleset = document.getText(possible_roleset_range)
            }

            if (roleset) {
              if (rolesetCache[roleset]) {
                  const formattedTooltip = rolesetCache[roleset]
                  const markdown = new vscode.MarkdownString(formattedTooltip);
                  markdown.isTrusted = true;  
                  return new vscode.Hover(markdown);
                }
                else {
                  console.log(`Couldn't find tooltip for roleset '${roleset}'.`)
                }
            }

            if (word) {
                if (wordTooltipCache[word]) {                    
                    const tooltipInfo = wordTooltipCache[word] || '';

                    if (!tooltipInfo) {
                      return null
                    }

                    const [first_lines, gloss_lines, column_widths, last_lines, graph] = tooltipInfo

                    let tooltip = ""
                    
                    const aligned_text = generateAlignedText(gloss_lines, column_widths)

                    if (!aligned_text) {
                      return null
                    }

                    if (Array.isArray(first_lines)) {
                      tooltip = first_lines.join("\n")
                    }
                    else if (typeof first_lines == 'string') {
                        tooltip = first_lines
                    }
                                
                    tooltip = tooltip + "\n"
                    + createMarkdownContent(aligned_text) + "\n"            // gloss lines get spaced padding and need a monospaced font
                    + last_lines + "\n\n"
                    + graph.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;').replace(/^\s+/gm, match => match.replace(/ /g, '&nbsp;'))  

                  
                    const formattedTooltip = tooltip
                    .split('\n')                                                                  // Split the tooltip into individual lines
                    .map(line => line.replace(new RegExp(`\\b${word}\\b`, 'g'), `**${word}**`))   // Bold the hovered word on each line
                    .join('  \n');                                                                // Join w/ a soft line break

                    const markdown = new vscode.MarkdownString(formattedTooltip);
                    markdown.isTrusted = true;
                    return new vscode.Hover(markdown);

                } 
                else {
                    console.log(`No tooltip for available for '${word}'.`);
                }
            }
        }
    });

    context.subscriptions.push(hover_provider);

    // build initial mappings for the variable tooltips
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document) {
      const document = editor.document;
      const fullText = document.getText();
      if (fullText !== lastDocumentText) {
        lastDocumentText = fullText;
        runPythonScriptForTooltips(fullText);
    }
      console.log("Building initial item mappings");
    } else {
      console.log("No active editor on activation; skipping tooltip cache update");
    }


    // register handler for tooltip cache update
    vscode.workspace.onDidChangeTextDocument((event: { document: { getText: () => any; }; }) => {
        const documentText = event.document.getText();
        if (documentText !== lastDocumentText) {
            lastDocumentText = documentText;
            runPythonScriptForTooltips(documentText);
        }
    });


    console.log("Registering macros...")
    let macro_command = vscode.commands.registerCommand('extension.expandMacro', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const document = editor.document;
      const position = editor.selection.active;
  
      // Get the text from the start of the line to the cursor
      const lineText = document.lineAt(position.line).text.substr(0, position.character);
  
      // Iterate over macros to find a matching pattern
    let matched = false;
    for (const macro of macros) {
      try {
        const regex = new RegExp(`${macro.pattern}$`);
        const match = lineText.match(regex);

        if (match) {
          const matchedText = match[0];
          const startPosition = position.translate(0, -matchedText.length);
          const range = new vscode.Range(startPosition, position);
          
          const matches = match.slice(1); // The captured groups
          const macroText = processReplacementString(macro.replacement, matches);

          if (macroText) {
            // **Step 1: Get the current line's indentation**
            const line = document.lineAt(position.line);
            const lineIndentation = line.text.substr(0, line.firstNonWhitespaceCharacterIndex);
      
            const macroLines = macroText.split('\n');
            const indentedMacroLines = macroLines.map((lineContent, index) => {

              if (index === 0) {
                // First line: use current indentation
                return lineContent;
              } else {
                // Subsequent lines: add indent level
                return lineIndentation + lineContent;
              }
            });
      
          const finalMacroText = indentedMacroLines.join('\n');
  
          // **Replace shortcut with macro text
          await editor.edit(editBuilder => {
            editBuilder.replace(range, finalMacroText);
          });

          // **Calculate the new cursor position, accounting for indentation**
          const replacementLines = finalMacroText.split('\n');
          const numberOfLinesInserted = replacementLines.length - 1;
          const newLine = startPosition.line + numberOfLinesInserted;

          // Get the start column of the replacement (includes existing indentation)
          const startColumn = startPosition.character;

          // Length of the last line of the replacement text
          const lastLine = replacementLines[replacementLines.length - 1];
          const lastLineLength = lastLine.length;

          // **Calculate the new character position**
          let newChar = startColumn + lastLineLength;

          // **Create the new position**
          const newPosition = new vscode.Position(newLine, newChar);

          // **Set the editor's selection to the new position**
          editor.selection = new vscode.Selection(newPosition, newPosition);
          editor.revealRange(new vscode.Range(newPosition, newPosition));

          matched = true;
          break

        }
    }
  }
    catch (error) {
        console.log(error)
        vscode.window.showErrorMessage(`Invalid regex pattern in macro: ${macro.pattern}`);
    }
  }

  if (!matched) {
      await vscode.commands.executeCommand('tab');
  }
  });
  
    context.subscriptions.push(macro_command);

    let editMacrosCommand = vscode.commands.registerCommand('extension.editMacros', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'extension.macros');
    });
    
    context.subscriptions.push(editMacrosCommand);



    // diagnostics for highlighting

    diagnosticCollection = vscode.languages.createDiagnosticCollection('UMR duplicate variables');
    context.subscriptions.push(diagnosticCollection);
  
    // Listen to document changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        triggerDiagnosticsUpdate(event.document);
      })
    );
    
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(document => {
        triggerDiagnosticsUpdate(document);
      })
    );
  
    // Also, update diagnostics for all open documents when the extension is activated
    vscode.workspace.textDocuments.forEach(document => {
      triggerDiagnosticsUpdate(document);
    });

    // Re-run diagnostics for all open documents if the user setting changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('extension.enableDiagnostics')) {
          vscode.workspace.textDocuments.forEach(document => {
            updateDiagnostics(document);
          });
        }
      })
    );

      // 
    context.subscriptions.push(
      vscode.commands.registerCommand('extension.goToLine', (uri: vscode.Uri, line: number) => {
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
        if (editor) {
          const position = new vscode.Position(line, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(new vscode.Range(position, position));
        } else {
          vscode.window.showTextDocument(uri).then(editor => {
            const position = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
          });
        }
      })
    );


    context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        { language: 'plaintext' },
        new DuplicateIdentifierHoverProvider()
      )
    );
    
}

function processReplacementString(replacement: string, matches: string[]): string {
  // helper for using capture groups in macros
  // Replace matched groups
  let result = replacement.replace(/\$([0-9]+)/g, (_, index) => {
    return matches[parseInt(index) - 1] || '';
  });

  // Process escape sequences
  result = result.replace(/\\n/g, '\n')
                 .replace(/\\t/g, '\t')
                 .replace(/\\r/g, '\r')
                 .replace(/\\'/g, '\'')
                 .replace(/\\"/g, '"')
                 .replace(/\\\\/g, '\\');

  return result;
}


function runPythonScriptForTooltips(documentText: string): Thenable<void> {
    return new Promise((resolve, reject) => {
            const executablePath = getExecutablePath();
            if (!executablePath) {
                console.log('No executable found');
                return;
            }
            const child = cp.spawn(executablePath);
    
            child.stdin.write(documentText);
            child.stdin.end();
    
            let output = '';
            child.stdout.on('data', (data: { toString: () => string; }) => {
                output += data.toString();
            });
    
            child.stdout.on('end', () => {    
                console.log('Python script ran.');

                try {

                    const result = JSON.parse(output);
                   
                    wordTooltipCache = result;  // Update the cache with the new tooltips
                    resolve();
                } catch (error) {
                    console.error('Failed to parse Python output:', error);
                    resolve();
                }
              });
            });
}

export function deactivate() {
    console.log('umr-annotation-helper is now deactivated');
    if (diagnosticCollection) {
      diagnosticCollection.dispose();
    }
}
