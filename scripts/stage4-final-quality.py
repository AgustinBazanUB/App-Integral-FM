from pathlib import Path

# UX: unanswered boolean/number questions must stay unknown. Defaulting them to
# false/0 would manufacture an answer the user never provided.
p = Path("src/gestion/pages/MetaAdsCampaignPlanningWorkspace.jsx")
s = p.read_text()
old = 'const answerInitial=(questions,answers)=>Object.fromEntries((questions||[]).map(q=>[q.key,answers?.[q.key]??(q.type==="multi_choice"?[]:q.type==="boolean"?false:q.type==="number"?0:"")]));'
new = 'const answerInitial=(questions,answers)=>Object.fromEntries((questions||[]).map(q=>[q.key,answers?.[q.key]??(q.type==="multi_choice"?[]:q.type==="boolean"?null:q.type==="number"?null:"")]));'
if old not in s:
    raise SystemExit("answerInitial marker not found")
s = s.replace(old, new, 1)
old = 'if(question.type==="boolean")return <Select value={value===true?"yes":value===false?"no":""} disabled={disabled} onChange={e=>onChange(e.target.value==="yes")}><option value="yes">Sí</option><option value="no">No</option></Select>;'
new = 'if(question.type==="boolean")return <Select value={value===true?"yes":value===false?"no":""} disabled={disabled} onChange={e=>onChange(e.target.value===""?null:e.target.value==="yes")}><option value="">Elegí una opción</option><option value="yes">Sí</option><option value="no">No</option></Select>;'
if old not in s:
    raise SystemExit("boolean Select marker not found")
s = s.replace(old, new, 1)
p.write_text(s)

# Static UX regression coverage.
p = Path("tests/meta-ads-campaign-planner-ui.test.mjs")
s = p.read_text()
needle = 'test("Fixtures existen sólo para tests"'
if 'Preguntas booleanas y numéricas empiezan sin respuesta inventada' not in s:
    insert = '''test("Preguntas booleanas y numéricas empiezan sin respuesta inventada",async()=>{const source=await read("../src/gestion/pages/MetaAdsCampaignPlanningWorkspace.jsx");assert.match(source,/q\.type===?"boolean"\?null:q\.type===?"number"\?null/);assert.match(source,/<option value="">Elegí una opción<\/option>/);assert.match(source,/e\.target\.value===""\?null:e\.target\.value==="yes"/);});\n'''
    idx = s.index(needle)
    s = s[:idx] + insert + s[idx:]
p.write_text(s)

# Historical Stage 3 doc remains historical; only append a continuity note.
p = Path("docs/META-ADS-STAGE-3.md")
s = p.read_text()
note = '''\n### Nota de continuidad desde Etapa 4\n\nLa rama de Etapa 4 implementa el consumidor previsto en esta sección y está documentada en `docs/META-ADS-STAGE-4.md`. Campaign Planner fija `theoryId / theoryVersionId / theoryVersion` al comenzar y consume exactamente esa versión; no cambia una campaña existente cuando se activa una metodología posterior.\n'''
if '### Nota de continuidad desde Etapa 4' not in s:
    s = s.rstrip() + "\n" + note
p.write_text(s)

print("Applied final Stage 4 UX and documentation quality adjustments")
