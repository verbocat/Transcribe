"""Guards against awaiting a Metered object or forgetting to await reserve_async (both 500'd generate_stream)."""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def _is_metered_ctor(node):
    return isinstance(node, ast.Call) and getattr(node.func, "attr", getattr(node.func, "id", "")) == "Metered"


def test_metered_call_sites_are_awaited_correctly():
    problems = []
    for path in APP.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        awaited = {id(n.value) for n in ast.walk(tree) if isinstance(n, ast.Await)}
        for n in ast.walk(tree):
            if isinstance(n, ast.Await) and _is_metered_ctor(n.value):
                problems.append(f"{path.name}:{n.lineno} awaits a Metered object")
            if isinstance(n, ast.Call) and getattr(n.func, "attr", "") == "reserve_async" and id(n) not in awaited:
                problems.append(f"{path.name}:{n.lineno} reserve_async() is not awaited")
    assert not problems, problems
