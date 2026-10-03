import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.js';
export default defineConfig(env=>mergeConfig(base(env),{
 plugins:[{name:'qa-local-auth-emulator',enforce:'pre',transform(code,id){if(id.endsWith('/src/gestion/services/firebase.js'))return {code:'import { connectAuthEmulator as connectQaAuthEmulator } from "firebase/auth";\n'+code.replace('export const auth = getAuth(firebaseApp);','export const auth = getAuth(firebaseApp);\nconnectQaAuthEmulator(auth, window.location.origin, {disableWarnings:true});'),map:null};}}],
 server:{host:'127.0.0.1',port:5186,proxy:{'/.netlify/functions':{target:'http://127.0.0.1:8886'},'/identitytoolkit.googleapis.com':{target:'http://127.0.0.1:9186'},'/securetoken.googleapis.com':{target:'http://127.0.0.1:9186'}}}
}));
