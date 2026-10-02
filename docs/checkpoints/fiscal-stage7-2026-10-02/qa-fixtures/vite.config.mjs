import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.js';
export default defineConfig(env=>mergeConfig(base(env),{
 plugins:[{name:'qa-local-auth-emulator',enforce:'pre',transform(code,id){if(id.endsWith('/src/gestion/services/firebase.js'))return {code:'import { connectFirestoreEmulator } from "firebase/firestore";\nimport { connectAuthEmulator as connectQaAuthEmulator } from "firebase/auth";\n'+code.replace('export const firebaseApp =','firebaseConfig.projectId = "demo-ecommerce-stage7"; firebaseConfig.apiKey = "qa-stage7-only";\nexport const firebaseApp =').replace('export const auth = getAuth(firebaseApp);','export const auth = getAuth(firebaseApp);\nconnectQaAuthEmulator(auth, window.location.origin, {disableWarnings:true});').replace('export const db = getFirestore(firebaseApp);','export const db = getFirestore(firebaseApp);\nconnectFirestoreEmulator(db, "127.0.0.1", 8187);'),map:null};}}],
 server:{host:'127.0.0.1',port:5187,proxy:{'/.netlify/functions':{target:'http://127.0.0.1:8887'},'/identitytoolkit.googleapis.com':{target:'http://127.0.0.1:9187'},'/securetoken.googleapis.com':{target:'http://127.0.0.1:9187'}}}
}));
