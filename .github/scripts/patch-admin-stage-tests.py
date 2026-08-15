from pathlib import Path

root = Path(__file__).resolve().parents[2]
test_path = root / "tests/management-ui.test.mjs"
source = test_path.read_text(encoding="utf-8")
old = '  assert.match(source, /limit\\(pageSize \\+ 1\\)/);'
new = '  assert.match(source, /const sourceLimit = hasPostFilter/);\n  assert.match(source, /limit\\(sourceLimit\\)/);'
if old not in source:
    raise SystemExit("No se encontró la aserción antigua de paginación")
test_path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Regresión de paginación actualizada")
