"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require('vscode');
const path = require('path');
const os = require('os');
const cp = require('child_process');
// const fs = require('fs');
let wordTooltipCache = {};
let lastDocumentText = ''; // for caching results
// function findPythonExecutable(): Promise<string> {
//     return new Promise((resolve, reject) => {
//         const pythonCandidates = ['python', 'python3', 'py'];  // Common Python executables
//         const whichCmd = process.platform === 'win32' ? 'where' : 'which';  // Command to check for executables
//         let foundPython = false;
//         for (const candidate of pythonCandidates) {
//             try {
//                 cp.execSync(`${whichCmd} ${candidate}`);
//                 console.log(`Using Python executable: ${candidate}`);
//                 resolve(candidate);  // Return the first working Python executable
//                 foundPython = true;
//                 break;
//             } catch (err) {
//                 // If the candidate isn't found, continue to the next one
//             }
//         }
//         if (!foundPython) {
//             reject(new Error('No Python executable found! Please ensure Python is installed and added to PATH.'));
//         }
//     });
// }
// // Function to check if a virtual environment exists and create it if necessary
// function checkOrCreateVirtualEnv(pythonExec: string): Thenable<void> {
//     return new Promise((resolve, reject) => {
//         if (!fs.existsSync(venvPath)) {
//             console.log('Virtual environment not found. Creating one...');
//             const createVenv = cp.spawn(pythonExec, ['-m', 'venv', venvPath]);
//             createVenv.on('error', (err: any) => {
//                 console.error('Error creating virtual environment:', err);
//                 reject(err);
//             });
//             createVenv.on('close', (code: number) => {
//                 if (code === 0) {
//                     console.log('Virtual environment created successfully.');
//                     installDependencies(pythonExec, resolve, reject);
//                 } else {
//                     reject(`Failed to create virtual environment. Exit code: ${code}`);
//                 }
//             });
//         } else {
//             console.log('Virtual environment found.');
//             installDependencies(pythonExec, resolve, reject);
//         }
//     });
// }
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
// // Function to install dependencies inside the virtual environment
// function installDependencies(pythonExec: string, resolve: (value: void | PromiseLike<void>) => void, reject: (reason?: any) => void) {
//     if (fs.existsSync(requirementsFile)) {
//         console.log('Installing dependencies...');
//         const venvPython = path.join(venvPath, 'Scripts', pythonExec); // assumes windows I think
//         const pipInstall = cp.spawn(venvPython, ['-m', 'pip', 'install', '-r', requirementsFile]);
//         pipInstall.on('error', (err: any) => {
//             console.error('Error installing dependencies:', err);
//             reject(err);
//         });
//         pipInstall.on('close', (code: number) => {
//             if (code === 0) {
//                 console.log('Dependencies installed successfully.');
//                 resolve();
//             } else {
//                 reject(`Failed to install dependencies. Exit code: ${code}`);
//             }
//         });
//     } else {
//         console.log('No requirements.txt found. Skipping dependency installation.');
//         console.log(requirementsFile)
//         resolve();
//     }
// }
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
                    const tooltipText = wordTooltipCache[word] || '';
                    const formattedTooltip = tooltipText
                        .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;') // Replace tabs with 4 non-breaking spaces
                        .replace(/^\s+/gm, match => match.replace(/ /g, '&nbsp;')) // Replace leading spaces with non-breaking spaces
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