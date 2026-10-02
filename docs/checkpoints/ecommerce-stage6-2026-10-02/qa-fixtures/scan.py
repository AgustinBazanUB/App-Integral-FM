from pathlib import Path
import subprocess,re,json,hashlib
patch=subprocess.check_output(['git','diff','--no-ext-diff','7ceba3915adb019644aede7bafa944290087797e','HEAD'],stderr=subprocess.DEVNULL).decode('utf-8')+subprocess.check_output(['git','diff','--no-ext-diff'],stderr=subprocess.DEVNULL).decode('utf-8')
patch+=subprocess.check_output(['git','diff','--cached','--no-ext-diff'],stderr=subprocess.DEVNULL).decode('utf-8')
untracked=subprocess.check_output(['git','ls-files','--others','--exclude-standard']).decode('utf-8').splitlines()
for name in untracked:
    if Path(name).suffix in ['.mjs','.js','.jsx','.json','.md','.yml','.toml']:
        patch+='\n'+Path(name).read_text(encoding='utf-8')
patterns={
 'private PEM literal':r'-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{64}',
 'certificate PEM literal':r'-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=]{64}',
 'GitHub/OpenAI token':r'(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{20,}',
 'AWS key':r'AKIA[0-9A-Z]{16}',
 'secret env literal':r'(?im)^\+?\s*(?:ARCA_PRIVATE_KEY_PEM|ARCA_TA_ENCRYPTION_KEY|FIREBASE_ADMIN_PRIVATE_KEY)\s*=\s*[A-Za-z0-9+/=]{40,}',
}
result={'scope':'Diff Etapa5->Etapa6 más correcciones locales y archivos nuevos versionables; excluye fixtures locales ignorados','sha256':hashlib.sha256(patch.encode()).hexdigest(),'findings':[{ 'pattern':name,'count':len(re.findall(pattern,patch))} for name,pattern in patterns.items()],'notes':['Variables de credenciales son identificadores, no valores.','La clave Firebase Web pública preexistente no es una clave administrativa.','No se imprime contenido de secretos.']}
Path('.netlify/stage6-qa/secret-scan.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False));assert all(f['count']==0 for f in result['findings'])
