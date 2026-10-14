# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Pradeep Mouli

import ast
import json
import inspect
import math
import sys
from types import ModuleType

if sys.version_info < (3, 13):
    raise RuntimeError("Python projection checks require Python >=3.13; set PYTHON_BINARY")

request = json.load(sys.stdin)
ast.parse(request["source"], feature_version=(3, 13))
compiled = compile(request["source"], "<Rune Python projection>", "exec")
if request.get("syntax_only"):
    json.dump([], sys.stdout)
    sys.exit(0)
module = ModuleType("rune_projection")
sys.modules[module.__name__] = module
scope = module.__dict__
exec(compiled, scope)

def normalize(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    return value

# The fixture corpus stores named records. Adapt only its outer test invocation;
# generated internal calls execute their public positional API unchanged.
def record_call(function, payload):
    parameters = list(inspect.signature(function).parameters)
    if parameters == ["data"] and "data" not in payload:
        return function(payload)
    values = [payload.get(name, payload.get(name.removesuffix("_input"))) for name in parameters]
    return function(*values)

scope["record_call"] = record_call

class RecordInvocation(ast.NodeTransformer):
    def visit_Call(self, node):
        self.generic_visit(node)
        if (isinstance(node.func, ast.Name) and node.func.id in scope
            and inspect.isfunction(scope[node.func.id]) and (not node.func.id.startswith("rune") or node.func.id.startswith("rune_decl_"))
            and len(node.args) == 1 and not node.keywords
            and (isinstance(node.args[0], ast.Dict)
                 or isinstance(node.args[0], ast.Name) and node.args[0].id == "data"
                 or isinstance(node.args[0], ast.Call) and isinstance(node.args[0].func, ast.Name) and node.args[0].func.id == "dict")):
            return ast.copy_location(ast.Call(func=ast.Name(id="record_call", ctx=ast.Load()),
                args=[node.func, node.args[0]], keywords=[]), node)
        return node

results = []
for case in request["cases"]:
    scope["data"] = case.get("data", {})
    try:
        results.append({"value": normalize(eval(compile(ast.fix_missing_locations(RecordInvocation().visit(ast.parse(case["expression"], mode="eval"))), "<corpus invocation>", "eval"), scope))})
    except Exception as error:
        results.append({"error": str(error)})
json.dump(results, sys.stdout, allow_nan=False)
