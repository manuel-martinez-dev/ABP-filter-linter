# ABP Filter Linter

VS Code extension that validates Adblock Plus filter syntax in `.txt` files.

## Features

- Inline squiggles for invalid snippet/filter syntax
- Typo detection with suggestions for snippet names
- Argument count and enum validation for all snippets
- Network modifier compatibility checks
- CSS selector validation for `##` rules
- ABP pseudo-class validation for `#?#` rules

## Supported Filter Types

| Syntax | Type |
|--------|------|
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

ABP-only. No AdGuard or uBlock Origin syntax.
