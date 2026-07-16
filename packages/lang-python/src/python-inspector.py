"""docstube python-inspector: stdlib-only public-API symbol extraction (Python 3.9+).

Invoked by @docstube/lang-python as `python python-inspector.py <file...>` with cwd set to the
repo root and repo-relative POSIX file paths on argv (the caller batches argv into bounded
chunks). Prints ONE JSON object to stdout:

    {"files": [{"file": <path>, "symbols": [Symbol, ...]}
               | {"file": <path>, "error": <message>}, ...]}

    Symbol = {"name": str,
              "kind": "function" | "method" | "class" | "variable",
              "lineno": int, "end_lineno": int,
              "signature": str,      # human-readable, single line
              "declaration": str,    # hash input (see below)
              "className": str?}     # methods only

Extraction rules — public API surface only:
- module-level `def` / `async def` whose name does not start with "_"  -> function
- module-level classes whose name does not start with "_"              -> class
- public methods of those classes (name not starting with "_")         -> method;
  `__init__` is the class's constructor signal: its signature is folded into the class
  declaration and it is never emitted as a separate method symbol
- module-level assignments to ALL_CAPS names                           -> variable (constant)

Declarations are reconstructed from the AST via ast.unparse (never sliced from source text), so
comments, docstrings, and formatting can never leak into the hash input. Deliberate difference
from the TypeScript pack (which hashes the whole declaration text, bodies included): here a
symbol's declaration is its SIGNATURE ONLY — decorators + def/class line — and a class
declaration is its `class` line plus the signatures of `__init__` and its public methods. The
symbol hash therefore changes when the API shape changes and stays stable when bodies change.

Per-file syntax errors are reported as {"file", "error"} entries; a broken file never fails the
batch. The process itself always exits 0 when it could produce output.
"""

import ast
import copy
import json
import re
import sys

CONSTANT_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")

FUNCTION_NODES = (ast.FunctionDef, ast.AsyncFunctionDef)


def signature_of(node):
    """Decorators + def/class signature, reconstructed with the body dropped."""
    clone = copy.deepcopy(node)
    clone.body = [ast.Pass()]
    text = ast.unparse(clone)
    # The block colon is the last ":" in the text: the synthetic body is a bare `pass`, which
    # cannot contain one, so rindex always lands on the colon that opens the (dropped) block.
    signature = text[: text.rindex(":")]
    return " ".join(signature.split())


def function_symbol(node, kind, class_name=None):
    signature = signature_of(node)
    symbol = {
        "name": node.name,
        "kind": kind,
        "lineno": node.lineno,
        "end_lineno": node.end_lineno,
        "signature": signature,
        "declaration": signature,
    }
    if class_name is not None:
        symbol["className"] = class_name
    return symbol


def class_symbols(node):
    class_signature = signature_of(node)
    api_methods = [
        stmt
        for stmt in node.body
        if isinstance(stmt, FUNCTION_NODES) and (stmt.name == "__init__" or not stmt.name.startswith("_"))
    ]
    declaration = "; ".join([class_signature] + [signature_of(stmt) for stmt in api_methods])
    symbols = [
        {
            "name": node.name,
            "kind": "class",
            "lineno": node.lineno,
            "end_lineno": node.end_lineno,
            "signature": class_signature,
            "declaration": declaration,
        }
    ]
    for stmt in api_methods:
        if stmt.name == "__init__":
            continue
        symbols.append(function_symbol(stmt, "method", node.name))
    return symbols


def constant_symbols(node):
    if isinstance(node, ast.Assign):
        names = [target.id for target in node.targets if isinstance(target, ast.Name)]
    elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        names = [node.target.id]
    else:
        return []
    declaration = " ".join(ast.unparse(node).split())
    return [
        {
            "name": name,
            "kind": "variable",
            "lineno": node.lineno,
            "end_lineno": node.end_lineno,
            "signature": declaration,
            "declaration": declaration,
        }
        for name in names
        if CONSTANT_NAME.match(name)
    ]


def module_symbols(tree):
    symbols = []
    for node in tree.body:
        if isinstance(node, FUNCTION_NODES):
            if not node.name.startswith("_"):
                symbols.append(function_symbol(node, "function"))
        elif isinstance(node, ast.ClassDef):
            if not node.name.startswith("_"):
                symbols.extend(class_symbols(node))
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            symbols.extend(constant_symbols(node))
    return symbols


def inspect_file(path):
    try:
        with open(path, "rb") as handle:
            source = handle.read()
        # ast.parse on bytes honors PEP 263 encoding declarations.
        tree = ast.parse(source, filename=path)
    except (SyntaxError, ValueError, OSError) as error:
        return {"file": path, "error": f"{type(error).__name__}: {error}"}
    return {"file": path, "symbols": module_symbols(tree)}


def main():
    json.dump({"files": [inspect_file(path) for path in sys.argv[1:]]}, sys.stdout)


if __name__ == "__main__":
    main()
