# umr-doc-helper README

Simple tooltip helper for annotating UMR documents.

## Features

This extension adds support for UMR document annotation, targed specifically at support lower-resourced languages.

- Roleset lookup. Currently pulls from English PropBank, but we plan to support new UMR rolesets and allow for customization to support whatever valency lexicon you have.
- Syntax highlighting for duplicate variable names. Hovering over a duplicate variable (not a re-entrancy) generates a hover bubble allowing you to jump to other declarations in the document.
- Macro support, including regular expressions and capture groups. Activate them with (macro) + TAB. Customize them in the settings.

### Settings

To configure this extension, go to Settings > Extensions > UMR Annotation Configuration. 

For macros, we have included a few suggested defaults, though customize them as you see fit. Use \n to generate a newline, and \t to indent with a tab (helpful for capturing descendents when generating a subgraph via a macro.) Capture groups are specified with (<regex>) on the left side, and with $1, $2 (etc.) on the right-hand side.

Turn off syntax highlighting with the checkbox setting.

## Requirements

Currently only supports Windows OS. Other OS support forthcoming.

## Known Issues

- Hover context providers which show the gloss and corresponding graph for a variable assumes a specific data format

## Release Notes

### 0.1.0

First reasonable release
