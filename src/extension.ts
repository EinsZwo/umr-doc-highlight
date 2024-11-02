// @ts-nocheck

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


function getExecutablePath() {
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
  
  

  function runExecutable() {
    const executablePath = getExecutablePath();
  
    if (!executablePath) {
      return;
    }
  
    cp.execFile(executablePath, (error: { message: any; }, stdout: any, stderr: any) => {
      if (error) {
        vscode.window.showErrorMessage(`Execution error: ${error.message}`);
        return;
      }
      if (stderr) {
        vscode.window.showWarningMessage(`Standard error: ${stderr}`);
      }
      vscode.window.showInformationMessage(`Output: ${stdout}`);
    });
  }
  

function generateAlignedText(tiers: Array<Array<string>>, colWidths: Array<number>) {
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


let macros: { [key: string]: string } = {};

function loadMacros() {
  const config = vscode.workspace.getConfiguration('macroExtension');
  const userMacros = config.get<{ [key: string]: string }>('macros', {});
  const defaultMacros = {
      'p1s': '(p / person \n\t:refer-person 1\n\t:refer-number singular)',
      'p1p': '(p / person \n\t:refer-person 1\n\t:refer-number plural)',
      'p2s': '(p / person \n\t:refer-person 2\n\t:refer-number singular)',
      'p2p': '(p / person \n\t:refer-person 2\n\t:refer-number plural)',
      'p3s': '(p / person \n\t:refer-person 3\n\t:refer-number singular)',
      'p3p': '(p / person \n\t:refer-person 3\n\t:refer-number plural)'
    };
  macros = { ...defaultMacros, ...userMacros };
}


loadMacros();

// Watch for configuration changes
vscode.workspace.onDidChangeConfiguration(event => {
  if (event.affectsConfiguration('macroExtension.macros')) {
    loadMacros();
  }
});

export function activate(context: { subscriptions: any[]; }) {
    console.log('UMR Annotation Helper is now active!');

    const tooltipsPath = path.join(context.extensionPath, 'data', 'tooltips.json');
    try {
      const fileContents = fs.readFileSync(tooltipsPath, 'utf8');
      rolesetCache = JSON.parse(fileContents);
      console.log("Loaded roleset tooltips")
      console.log(` Sample entry activate-01: '${rolesetCache['activate-01']}'`)
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
  
      // Extract the last word (potential macro shortcut)
      const match = lineText.match(/(\S+)\s*$/);
      const shortcut = match ? match[1] : '';
  
      const macroText = macros[shortcut];
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
  
        // **Step 4: Replace the shortcut with the indented macro text**
        const startPosition = position.translate(0, -shortcut.length);
        const range = new vscode.Range(startPosition, position);
  
        await editor.edit(editBuilder => {
          editBuilder.replace(range, finalMacroText);
        });
  
        // **Optional: Move the cursor to the end of the inserted text**
        const lastLine = startPosition.line + indentedMacroLines.length - 1;
        const lastChar = indentedMacroLines[indentedMacroLines.length - 1].length;
        const newPosition = new vscode.Position(lastLine, lastChar);
        editor.selection = new vscode.Selection(newPosition, newPosition);
      } else {
        // No macro found, insert a tab character
        await vscode.commands.executeCommand('tab');
      }
    });
  
    context.subscriptions.push(macro_command);

    let editMacrosCommand = vscode.commands.registerCommand('macroExtension.editMacros', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'macroExtension.macros');
    });
    
    context.subscriptions.push(editMacrosCommand);
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
                    //console.log('Parsed result from Python:', result);

                   
                    wordTooltipCache = result;  // Update the cache with the new tooltips
                    resolve();                  // Resolve when the cache is updated
                } catch (error) {
                    console.error('Failed to parse Python output:', error);
                    resolve();  // Still resolve to avoid blocking the UI
                }
              });
            });
}

export function deactivate() {
    console.log('umr-annotaiton-helper is now deactivated');
}
