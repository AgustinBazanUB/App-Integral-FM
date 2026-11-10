import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGeminiLiveTurn, quickReadPlan } from '../src/shared/oliviaConversationRouter.mjs';
import { advanceVoiceCollection, safeConversationBridge } from '../src/shared/oliviaVoiceCollection.mjs';
import { fastConversationRead } from '../netlify/functions/_lib/olivia/fastConversation.mjs';
import { fixture, start } from './helpers/olivia-fixture.mjs';
import { build } from 'esbuild';

test('an independent read neither completes nor discards the spoken stock draft',()=>{
  const draft=advanceVoiceCollection('Quiero cargar stock');
  for(const text of ['Qué ubicaciones están activas','Cuáles son las ubicaciones activas','Mostrame los locales activos','Cuánto vendimos ayer']) {
    const decision=classifyGeminiLiveTurn(text,{voiceCollection:draft,collectingTask:true});
    assert.equal(decision.route,'delegate');assert.equal(decision.newTask,true);assert.equal(decision.independentRead,true);
    assert.equal(advanceVoiceCollection(text,draft),null);
  }
  assert.equal(advanceVoiceCollection('En Local Lavalle',draft).requestedLocation,'Lavalle');
  assert.equal(quickReadPlan('Qué ubicaciones están activas').kind,'locations');
  assert.equal(quickReadPlan('Qué ubicaciones están activas y cargá stock'),null);
});
test('location reads call only the authorized tool and do not manufacture names',async()=>{
  const calls=[];
  const result=await fastConversationRead({plan:{kind:'locations'},context:{},check:name=>calls.push('check:'+name),run:async(name)=>{calls.push(name);return {data:{locations:[{id:'qa',name:'Local de prueba'}],limit:100}};}});
  assert.deepEqual(calls,['check:list_locations','list_locations']);assert.match(result.content,/Local de prueba/);
  await assert.rejects(fastConversationRead({plan:{kind:'locations'},context:{},check:()=>{throw Error('denied');},run:()=>assert.fail('must not run')}),/denied/);
});
test('a text read during stock collection keeps the task and skips the model',async()=>{
  const f=fixture({role:'admin'});const {conversationId}=await start(f);
  f.documents.set('locations/qa_active',{name:'Local sintético activo',active:true});
  f.documents.set('locations/qa_inactive',{name:'Local sintético inactivo',active:false});
  await f.engine.chat(f.session,{conversationId,requestId:'stock',message:'Quiero cargar stock'});
  f.advance(2000);
  const before=structuredClone(f.documents.get('oliviaConversations/'+conversationId).taskState);
  const result=await f.engine.chat(f.session,{conversationId,requestId:'locations',message:'Qué ubicaciones están activas'});
  const content=result.messages.at(-1).content;
  assert.match(content,/Local sintético activo/);assert.doesNotMatch(content,/Local sintético inactivo|productos y cantidades/);
  assert.deepEqual(f.documents.get('oliviaConversations/'+conversationId).taskState,before);
  assert.equal(result.telemetry.modelCalls,0);
});
test('safe field requests without punctuation retain audio; claimed results remain blocked',()=>{
  assert.equal(safeConversationBridge('Dale, decime en qué ubicación querés cargarlo',{collection:{pendingQuestion:'location'}}),true);
  assert.equal(safeConversationBridge('Pasame los productos y cantidades',{collection:{pendingQuestion:'items-and-quantities'}}),true);
  assert.equal(safeConversationBridge('Ya cargué el stock. Decime en qué ubicación',{collection:{pendingQuestion:'location'}}),false);
  assert.equal(safeConversationBridge('Decime el nombre',{collection:{pendingQuestion:'location'}}),false);
});

const bundled=await build({entryPoints:['src/gestion/olivia/OliviaDelegatedTasks.jsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'task-view',setup(b){
  b.onResolve({filter:/^react\/jsx-runtime$|design-system$|OliviaMessageContent$/},args=>({path:args.path,namespace:'qa'}));
  b.onLoad({filter:/.*/,namespace:'qa'},({path})=>({contents:path==='react/jsx-runtime'?"export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='Fragment';":path.endsWith('design-system')?"export const Button='Button';":"export default 'Message';"}));
}}]});
const {default:Tasks}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
test('normal chat exposes only mutation confirmation; diagnostics keep task controls',()=>{
  const tasks=['needs-input','paused','failed','running'].map(status=>({id:status,status,summary:'Pregunta o resultado'}));
  assert.equal(Tasks({tasks}),null);
  const proposal={id:'proposal',status:'awaiting-confirmation',summary:'Resumen revisable',pendingAction:{id:'action'}};
  const tree=nodes(Tasks({tasks:[...tasks,proposal]}));
  assert.deepEqual(tree.filter(n=>n.type==='article').map(n=>n.props['data-olivia-task']),['proposal']);
  assert.equal(tree.some(n=>n.props?.children==='Cancelar tarea'),false);
  assert.equal(nodes(Tasks({tasks,developer:true})).some(n=>n.props?.children==='Retomar'),true);
});
