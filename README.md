# ABP Filter Linter

VS Code extension that validates Adblock Plus filter syntax in `.txt` files.

## Installation

Download `abp-filter-linter-0.3.0.vsix` from the repository and run:

```bash
code --install-extension abp-filter-linter-0.3.0.vsix
```

Then reload VSCode (`Ctrl+Shift+P` → Developer: Reload Window).

## Features

- Inline squiggles for invalid snippet/filter syntax
- Full line background highlight (red for errors, yellow for warnings)
- Typo detection with suggestions for snippet names
- Argument count and enum validation for all snippets
- Network modifier compatibility checks
- CSS selector validation for `##` rules
- ABP pseudo-class validation for `#?#` rules
- Duplicate filter detection
- Only activates on `.txt` files

## Supported Filter Types

| Syntax | Type |
| -------- | ------ |
| `#$#` | Snippet filters |
| `##` | Element hiding |
| `#?#` | Extended selectors |
| `#@#` | Element hiding exceptions |
| `@@` | Exception/allowlist rules |
| `\|\|` | Network blocking rules |

## Development

```bash
npm install
npm run build
npm test
```

Press `F5` in VS Code to launch the Extension Development Host.

## Scope

ABP/AdBlock-only. No AdGuard or uBlock Origin syntax.
