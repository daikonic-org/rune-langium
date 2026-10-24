# @rune-langium/cli

> Parse, validate, and generate Rune DSL workspaces from the command line.

Command-line entry points for batch Rune DSL parsing, validation, and code generation.

## Features

- `rune-dsl parse <paths...>`
- `rune-dsl validate <paths...>`
- `rune-dsl generate --input <paths...> --language <lang> --output <dir>`

## Named project builds

Build saved target configurations explicitly with the native TypeScript toolchain:

```sh
rune-dsl build --project ./my-project --target postgres sql-server
rune-dsl build --project ./my-project --all --json
```

`build-config.yml` (or `.yaml`) defines named targets, their generator IDs,
options and output directories. `rune-config.yml` retains upstream model settings.
No target is selected by default, and unavailable generators do not fall back.
The `build` command requires no Java or Maven execution; the existing legacy
`generate` command is unchanged.

Exit codes are 0 for success, 1 for project/build failures and 2 for missing or
conflicting target selection. JSON build results include status, diagnostics and
completed output paths, including preflight failures. Source and protected
project paths cannot be output destinations. Generated files are working-copy
writes; building does not stage, commit or push them.
