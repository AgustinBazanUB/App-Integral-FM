import { auth } from '../../src/gestion/services/firebase.js';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
for(const role of ['admin','seller'])document.getElementById(role).onclick=async()=>{try{await signInWithEmailAndPassword(auth,`${role}@qa.invalid`,'qa-password-only');document.getElementById('status').textContent=`Sesión ${role} QA validada`; }catch(error){document.getElementById('status').textContent=error.message;}};
document.getElementById('logout').onclick=async()=>{await signOut(auth);document.getElementById('status').textContent='Sin sesión QA';};
