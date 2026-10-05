import test,{before,after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,collection,getDocs} from 'firebase/firestore';
let environment;
const paths=['oliviaConfiguration/global','oliviaConversations/conversation','oliviaConversations/conversation/messages/message','oliviaConfirmations/confirmation','oliviaBudgets/budget','oliviaRequests/request','oliviaUsage/usage','oliviaRealtime/voice','oliviaAnonymousUsage/day','oliviaQuotaRequests/request','oliviaAttachments/file','oliviaUploadBudgets/day','oliviaKnowledgeDocuments/document','oliviaKnowledgeSettings/global','oliviaToolEvents/event','oliviaRealtimeToolCalls/call','oliviaRealtimeTurns/turn','oliviaLiveDelegations/delegation'];
before(async()=>{
 environment=await initializeTestEnvironment({projectId:'demo-flor-mia-olivia',firestore:{rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
 await environment.clearFirestore();
 await environment.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await Promise.all([setDoc(doc(db,'users/admin'),{role:'admin',active:true}),setDoc(doc(db,'users/seller'),{role:'seller',active:true}),...paths.map(path=>setDoc(doc(db,path),{userId:'seller',text:'Solo backend'}))]);
 });
});
after(async()=>environment?.cleanup());
for(const user of ['admin','seller',null])test(`Olivia backend collections reject direct reads and writes for ${user||'anonymous'}`,async()=>{
 const db=(user?environment.authenticatedContext(user):environment.unauthenticatedContext()).firestore();
 for(const path of paths){await assertFails(getDoc(doc(db,path)));await assertFails(setDoc(doc(db,path),{userId:user||'none',text:'Unauthorized'}));}
 await assertFails(getDocs(collection(db,'oliviaConversations')));
});
