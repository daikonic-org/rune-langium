---
"@rune-langium/codegen": minor
---

Use Temporal date/time values in generated TypeScript functions and Data classes.
Function-input schemas convert ISO JSON strings once; generated bodies retain typed
values and native calendar operations. Exported function callers should validate
and adapt JSON through the function-input schema before execution.

Expose body-only function and condition projection fragments while retaining full
exported declarations, and render proven primitive/enum Python operators directly.
