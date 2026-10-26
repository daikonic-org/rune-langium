# Variables & Constants

## generator

### `IMPLEMENTED_TARGETS`
The targets `runGenerate` can actually produce output for in this build.

A target is "implemented" if any of:
  - it has a NAMESPACE_EMITTERS entry (covers per-namespace dispatch);
  - it has a WHOLE_MODEL_EMITTERS entry (covers hand-rolled whole-model);
  - it has a NAMESPACE_EMITTERS entry AND a PROFILES entry (covers
    synthesized whole-model dispatch).

Phase 0/0.5.1 only registers the three per-namespace emitters, so this
resolves to ['zod', 'json-schema', 'typescript']. Phase 1/2/3 add to
the appropriate registry and this list updates automatically.

018 Phase 0 Task 0.7 follow-up; expanded in 019 Phase 0.5.1.
```ts
const IMPLEMENTED_TARGETS: readonly Target[]
```

## implementations

### `NATIVE_IMPLEMENTATIONS`
```ts
const NATIVE_IMPLEMENTATIONS: readonly NativeImplementation[]
```

## types

### `TARGET_DESCRIPTORS`
Registry of all generator targets. The studio reads this to render
the targets table; `runGenerate` reads it to pick the dispatch path.
Keep in sync with the Target union — TS exhaustiveness check
on `Record&lt;Target, ...&gt;` enforces this at compile time.

018 Phase 0 Task 0.3. Phases 1-3 add the missing emitter
implementations; this registry is the contract those phases land
against.
```ts
const TARGET_DESCRIPTORS: Record<Target, TargetDescriptor>
```

## options

### `ExcelOptionsSchema`
```ts
const ExcelOptionsSchema: ZodObject<{ sheets: ZodDefault<ZodObject<{ types: ZodDefault<ZodBoolean>; enums: ZodDefault<ZodBoolean>; typeAliases: ZodDefault<ZodBoolean>; conditions: ZodDefault<ZodBoolean> }, $strip>> }, $strip>
```

### `TARGET_OPTIONS_SCHEMAS`
```ts
const TARGET_OPTIONS_SCHEMAS: { zod: ZodObject<{ layout: ZodOptional<ZodEnum<{ per-namespace: "per-namespace"; barrel: "barrel"; single-file: "single-file" }>> }, $strip>; typescript: ZodObject<{ layout: ZodOptional<ZodEnum<{ per-namespace: "per-namespace"; barrel: "barrel"; single-file: "single-file" }>>; inputChecks: ZodOptional<ZodBoolean> }, $strip>; json-schema: ZodObject<{ layout: ZodOptional<ZodEnum<{ per-namespace: "per-namespace"; single-file: "single-file" }>> }, $strip>; sql: ZodObject<{ dialect: ZodOptional<ZodEnum<{ postgres: "postgres"; sqlserver: "sqlserver" }>>; inheritance: ZodOptional<ZodEnum<{ single-table: "single-table"; table-per-type: "table-per-type" }>>; enumStrategy: ZodOptional<ZodEnum<{ check: "check"; table: "table" }>>; layout: ZodOptional<ZodEnum<{ per-namespace: "per-namespace"; single-file: "single-file" }>> }, $strip>; markdown: ZodObject<{ layout: ZodOptional<ZodEnum<{ per-namespace: "per-namespace"; barrel: "barrel" }>> }, $strip>; excel: ZodObject<{ sheets: ZodDefault<ZodObject<{ types: ZodDefault<ZodBoolean>; enums: ZodDefault<ZodBoolean>; typeAliases: ZodDefault<ZodBoolean>; conditions: ZodDefault<ZodBoolean> }, $strip>> }, $strip>; openapi: ZodObject<{ format: ZodOptional<ZodEnum<{ json: "json"; yaml: "yaml" }>>; crud: ZodOptional<ZodUnion<readonly [ZodBoolean, ZodObject<{ types: ZodArray<ZodString> }, $strip>]>> }, $strip>; xsd: ZodObject<{}, $strip>; graphql: ZodObject<{}, $strip> }
```

## helpers

### `RUNTIME_HELPER_JS_SOURCE`
Annotation-free counterpart used by the Studio execution worker.
```ts
const RUNTIME_HELPER_JS_SOURCE: string
```
