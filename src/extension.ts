import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

let wordTooltipCache: { [word: string]: string } = {}; 
let lastDocumentText = '';  // for caching results

const venvPath = path.join(__dirname, 'umr_doc_helper_venv'); 
const requirementsFile = path.join(__dirname, '..', 'src', 'requirements.txt');  


function findPythonExecutable(): Promise<string> {
    return new Promise((resolve, reject) => {
        const pythonCandidates = ['python', 'python3', 'py'];  // Common Python executables
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';  // Command to check for executables

        let foundPython = false;

        for (const candidate of pythonCandidates) {
            try {
                cp.execSync(`${whichCmd} ${candidate}`);
                console.log(`Using Python executable: ${candidate}`);
                resolve(candidate);  // Return the first working Python executable
                foundPython = true;
                break;
            } catch (err) {
                // If the candidate isn't found, continue to the next one
            }
        }

        if (!foundPython) {
            reject(new Error('No Python executable found! Please ensure Python is installed and added to PATH.'));
        }
    });
}

// Function to check if a virtual environment exists and create it if necessary
function checkOrCreateVirtualEnv(pythonExec: string): Thenable<void> {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(venvPath)) {
            console.log('Virtual environment not found. Creating one...');
            const createVenv = cp.spawn(pythonExec, ['-m', 'venv', venvPath]);

            createVenv.on('error', (err) => {
                console.error('Error creating virtual environment:', err);
                reject(err);
            });

            createVenv.on('close', (code) => {
                if (code === 0) {
                    console.log('Virtual environment created successfully.');
                    installDependencies(pythonExec, resolve, reject);
                } else {
                    reject(`Failed to create virtual environment. Exit code: ${code}`);
                }
            });
        } else {
            console.log('Virtual environment found.');
            installDependencies(pythonExec, resolve, reject);
        }
    });
}

// Function to install dependencies inside the virtual environment
function installDependencies(pythonExec: string, resolve: (value: void | PromiseLike<void>) => void, reject: (reason?: any) => void) {
    if (fs.existsSync(requirementsFile)) {
        console.log('Installing dependencies...');
        const venvPython = path.join(venvPath, 'Scripts', pythonExec); // assumes windows I think
        const pipInstall = cp.spawn(venvPython, ['-m', 'pip', 'install', '-r', requirementsFile]);

        pipInstall.on('error', (err) => {
            console.error('Error installing dependencies:', err);
            reject(err);
        });

        pipInstall.on('close', (code) => {
            if (code === 0) {
                console.log('Dependencies installed successfully.');
                resolve();
            } else {
                reject(`Failed to install dependencies. Exit code: ${code}`);
            }
        });
    } else {
        console.log('No requirements.txt found. Skipping dependency installation.');
        console.log(requirementsFile)
        resolve();
    }
}


export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "my-extension" is now active!');

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
                    .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')  // Replace tabs with 4 non-breaking spaces
                    .replace(/^\s+/gm, match => match.replace(/ /g, '&nbsp;'))  // Replace leading spaces with non-breaking spaces
                    .split('\n')  // Split the tooltip into individual lines
                    .map(line => line.replace(new RegExp(`\\b${word}\\b`, 'g'), `**${word}**`))  // Bold the hovered word on each line
                    .join('  \n');  // Join lines with a soft line break (two spaces + \n)

                    const markdown = new vscode.MarkdownString(formattedTooltip);
                    markdown.isTrusted = true;  // Ensure Markdown is trusted
                    return new vscode.Hover(markdown);

                } else {
                    console.log(`No cached tooltip for '${word}', awaiting cache update.`);
                }
            }
        }
    });

    context.subscriptions.push(disposable);

    vscode.workspace.onDidChangeTextDocument(event => {
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


function runPythonScriptForTooltips(documentText: string): Thenable<void> {
    return new Promise((resolve, reject) => {
        findPythonExecutable().then((pythonExec) => {
            checkOrCreateVirtualEnv(pythonExec).then(() => {
                const venvPython = path.join(venvPath, 'Scripts', 'python');  // Adjust for your OS if necessary
                const scriptPath = path.join(__dirname, '..', 'src', 'process_document.py');

                console.log(`Running Python script from: ${scriptPath} in virtual environment`);

                const pythonProcess = cp.spawn(venvPython, [scriptPath]);

                pythonProcess.on('error', (err) => {
                    console.error('Failed to start Python process:', err);
                    reject(err);
                });

                pythonProcess.stdin.write(documentText, (err) => {
                    if (err) {
                        console.error('Error writing to Python stdin:', err);
                        reject(err);
                    } else {
                        pythonProcess.stdin.end();
                    }
                });

                // Capture stdout from the Python script
                pythonProcess.stdout.on('data', (data) => {
                    try {
                        const result = JSON.parse(data.toString());
    
                        console.log('Parsed result from Python:', result);
                        wordTooltipCache = result;  // Update the cache with the new tooltips
                        resolve();  // Resolve when the cache is updated
                    } catch (error) {
                        console.error('Failed to parse Python output:', error);
                        resolve();  // Still resolve to avoid blocking the UI
                    }
                });

                // Capture stderr for debugging
                pythonProcess.stderr.on('data', (data) => {
                    console.error(`Python stderr: ${data.toString()}`);
                });

                // Log when the process finishes
                pythonProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log('Python script finished successfully.');
                    } else {
                        console.error(`Python script finished with code ${code}`);
                    }
                });
            });
        }).catch(reject);
    });
}

export function deactivate() {
    console.log('Extension "my-extension" is now deactivated');
}
