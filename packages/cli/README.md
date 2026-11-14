# @rune-langium/cli

> Parse, validate, and generate Rune DSL workspaces from the command line.

Command-line entry points for batch Rune DSL parsing, validation, and code generation.

## Features

- `rune-dsl parse <paths...>`
- `rune-dsl validate <paths...>`
- `rune-dsl generate --input <paths...> --language <lang> --output <dir>`
- `rune-dsl market-data --start <date> --end <date> --output <new-dir>`

## Public benchmark data

```sh
rune-dsl market-data --start 2026-11-02 --end 2026-11-06 \
  --output ./model/benchmark-data --json
```

Explicitly acquire SOFR, SONIA and €STR fixings and compounded indices into six
provenance/checksum snapshots and an editable Rune observation provider. Append
`--series sofr sonia estr` for only rates. The output directory must be new;
existing project files are never replaced. All selected feeds are validated
before output creation. Generated code and Prototype use the saved provider
offline. Refresh into a separate directory and review/copy the active provider;
do not select competing overrides. See [series, installation and limits](../../docs/implementations/benchmark-data.md).

`--catalog <origin>` explicitly copies a pinned selection from a configured
catalog, including `selection.json`, verified captures and one materialized Rune
provider. The default remains direct acquisition. The optional
[CDM example service](../../apps/cdm-example-data-worker/README.md) is not a
Studio dependency; real projects can supply their own providers.

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
