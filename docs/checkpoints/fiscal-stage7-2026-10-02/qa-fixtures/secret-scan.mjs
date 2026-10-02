import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base='c975b8b46509d91122f1c4ad1ad5129acf8763f7';
const git=(args)=>execFileSync('git',args,{encoding:'utf8'});
let patch=git(['diff','--no-ext-diff',base,'--','.',':(exclude)docs/checkpoints/fiscal-stage7-2026-10-02/evidence/secret-scan.json']);
for(const path of git(['ls-files','--others','--exclude-standard']).trim().split('\n').filter(Boolean)){
 if(!path.endsWith('/evidence/secret-scan.json')&&/\.(?:mjs|js|jsx|json|md|txt|yml|toml|log|py)$/.test(path))patch+='\n'+await readFile(path,'utf8');
}
const patterns={
 privatePem:/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{64}/g,
 certificatePem:/-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=]{64}/g,
 vendorToken:/(?:ghp_|github_pat_|sk-proj-|nfp_)[A-Za-z0-9_-]{20,}/g,
 awsKey:/AKIA[0-9A-Z]{16}/g,
 secretEnvLiteral:/^\+?\s*(?:ARCA_PRIVATE_KEY_PEM|ARCA_TA_ENCRYPTION_KEY|FIREBASE_ADMIN_PRIVATE_KEY)\s*=\s*[A-Za-z0-9+/=]{40,}/gm,
 jwtLiteral:/eyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{15,}/g,
 frontendSecret:/^\+.*VITE_(?:ARCA_PRIVATE_KEY|FIREBASE_ADMIN_PRIVATE_KEY|ARCA_TA_ENCRYPTION_KEY)\s*=/gm,
};
const findings=Object.entries(patterns).map(([pattern,re])=>({pattern,count:[...patch.matchAll(re)].length}));
const result={base,scope:'Diff contra base y nuevos archivos versionables; excluye configuración local ignorada y credenciales externas',sha256:createHash('sha256').update(patch).digest('hex'),findings,pass:findings.every(f=>f.count===0),limitations:'Scan focalizado más revisión del patch; no demuestra ausencia universal de secretos.'};
await writeFile('.netlify/stage7-qa/secret-scan.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1;
