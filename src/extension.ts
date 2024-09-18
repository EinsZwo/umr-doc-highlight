import * as vscode from 'vscode';
import * as cp from 'child_process';

let wordTooltipCache: { [word: string]: string } = {};  // Cache to store tooltips for words
let lastDocumentText = '';  // Track the document content to detect changes

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

    // Listen for document changes to update the cache when the document changes
    vscode.workspace.onDidChangeTextDocument(event => {
        const documentText = event.document.getText();
        if (documentText !== lastDocumentText) {
            lastDocumentText = documentText;
            runPythonScriptForTooltips(documentText);
        }
    });

    // Run the Python script and build the cache when the document is first opened
    if (vscode.window.activeTextEditor) {
        const initialDocumentText = vscode.window.activeTextEditor.document.getText();
        lastDocumentText = initialDocumentText;
        runPythonScriptForTooltips(initialDocumentText);
    }
}

// Function to run the Python script and update the cache with tooltips for all words
function runPythonScriptForTooltips(documentText: string): Thenable<void> {
    return new Promise((resolve, reject) => {
        const pythonPath = 'python';  // Ensure Python is installed and available
        const scriptPath = vscode.Uri.file(__dirname + '/../src/process_document.py').fsPath;

        // Log the Python script path
        console.log(`Running Python script at: ${scriptPath}`);

        try {
            // Spawn the Python process
            const pythonProcess = cp.spawn(pythonPath, [scriptPath]);

            // Ensure the Python process started successfully
            pythonProcess.on('error', (err) => {
                console.error('Failed to start Python process:', err);
                reject(err);  // Reject the promise on error
            });

            // Send the entire document text to the Python script via stdin
            pythonProcess.stdin.write(documentText, (err) => {
                if (err) {
                    console.error('Error writing to Python stdin:', err);
                    reject(err);  // Reject if there's an error writing
                } else {
                    console.log('Document text sent to Python script.');
                    pythonProcess.stdin.end();  // End stdin after writing
                }
            });

            // Capture stdout from the Python script (should contain the cache for tooltips)
            pythonProcess.stdout.on('data', (data) => {
                console.log('Received data from Python script.');
                try {
                    const result = JSON.parse(data.toString());

                    // for (let word in result) {
                    //     result[word] = result[word]
                    //         .replace(/\n/g, '\n\n')
                    //         .replace(new RegExp(`\\b${word}\\b`, 'g'), `**${word}**`);
                    // }

                    console.log('Parsed result from Python:', result);
                    wordTooltipCache = result;  // Update the cache with the new tooltips
                    resolve();  // Resolve when the cache is updated
                } catch (error) {
                    console.error('Failed to parse Python output:', error);
                    resolve();  // Still resolve to avoid blocking the UI
                }
            });

            // Capture stderr for debugging (log any errors from the Python script)
            pythonProcess.stderr.on('data', (data) => {
                console.error(`Python stderr: ${data.toString()}`);
            });

            // Log when the process finishes
            pythonProcess.on('close', (code) => {
                console.log(`Python script finished with code ${code}`);
            });
        } catch (error) {
            console.error('Error spawning Python process:', error);
            reject(error);
        }
    });
}

export function deactivate() {
    console.log('Extension "my-extension" is now deactivated');
}
