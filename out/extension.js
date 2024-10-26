"use strict";
// @ts-nocheck
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require('vscode');
const path = require('path');
const os = require('os');
const cp = require('child_process');
let wordTooltipCache = {};
let lastDocumentText = ''; // for caching results
function getExecutablePath() {
    const platform = os.platform();
    const extensionPath = vscode.extensions.getExtension('mabu4315.umr-doc-helper').extensionPath;
    let executableName;
    let executableDir;
    if (platform === 'win32') {
        executableName = 'process_document.exe';
        executableDir = 'dist';
    }
    else {
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
    cp.execFile(executablePath, (error, stdout, stderr) => {
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
function generateAlignedText(tiers, colWidths) {
    return tiers.map(tier => {
        return tier.map((word, colIndex) => {
            return word.padEnd(colWidths[colIndex], ' ');
        }).join(' ');
    }).join('\n');
}
function createMarkdownContent(alignedText) {
    return `\`\`\`plaintext
${alignedText}
\`\`\``;
}
function activate(context) {
    console.log('umr-doc-helper is now active!');
    // Register a hover provider for all file types
    let disposable = vscode.languages.registerHoverProvider({ scheme: 'file', language: '*' }, {
        provideHover(document, position, token) {
            // Get the word at the hover position
            const range = document.getWordRangeAtPosition(position, /\w+/);
            const word = range ? document.getText(range) : '';
            // If there's a word at the hover position, check the cache for tooltips
            if (word) {
                if (wordTooltipCache[word]) {
                    console.log(`Tooltip from cache for word '${word}': ${wordTooltipCache[word]}`);
                    const tooltipInfo = wordTooltipCache[word] || '';
                    if (!tooltipInfo) {
                        return vscode.Hover(tooltipInfo);
                    }
                    const [first_lines, gloss_lines, column_widths, last_lines, graph] = tooltipInfo;
                    let tooltip = first_lines.join("\n") + "\n"
                        + createMarkdownContent(generateAlignedText(gloss_lines, column_widths)) + "\n" // gloss lines get spaced padding and need a monospaced font
                        + last_lines + "\n\n"
                        + graph.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;').replace(/^\s+/gm, match => match.replace(/ /g, '&nbsp;'));
                    const formattedTooltip = tooltip
                        .split('\n') // Split the tooltip into individual lines
                        .map(line => line.replace(new RegExp(`\\b${word}\\b`, 'g'), `**${word}**`)) // Bold the hovered word on each line
                        .join('  \n'); // Join lines with a soft line break (two spaces + \n)
                    const markdown = new vscode.MarkdownString(formattedTooltip);
                    markdown.isTrusted = true; // Ensure Markdown is trusted
                    return new vscode.Hover(markdown);
                }
                else {
                    console.log(`No cached tooltip for '${word}', awaiting cache update.`);
                }
            }
        }
    });
    context.subscriptions.push(disposable);
    vscode.workspace.onDidChangeTextDocument((event) => {
        const documentText = event.document.getText();
        if (documentText !== lastDocumentText) {
            lastDocumentText = documentText;
            runPythonScriptForTooltips(documentText);
        }
    });
    if (vscode.window.activeTextEditor) {
        const initialDocumentText = vscode.window.activeTextEditor.document.getText();
        lastDocumentText = initialDocumentText;
        runPythonScriptForTooltips(initialDocumentText);
    }
}
function runPythonScriptForTooltips(documentText) {
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
        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        child.stdout.on('end', () => {
            console.log('Python script ran.');
            try {
                const result = JSON.parse(output);
                console.log('Parsed result from Python:', result);
                wordTooltipCache = result; // Update the cache with the new tooltips
                resolve(); // Resolve when the cache is updated
            }
            catch (error) {
                console.error('Failed to parse Python output:', error);
                resolve(); // Still resolve to avoid blocking the UI
            }
        });
    });
}
function deactivate() {
    console.log('umr-annotaiton-helper is now deactivated');
}
//# sourceMappingURL=extension.js.map