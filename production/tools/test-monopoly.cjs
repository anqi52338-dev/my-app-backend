const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const values=new Map(),kv={get:(key,fallback)=>values.has(key)?JSON.parse(values.get(key)):fallback,set:(key,value)=>values.set(key,JSON.stringify(value))};
let rolls=[],modelCalls=0,delayed=null;
const engine=require(path.resolve(__dirname,'../monopoly'))({kv,readBody:async req=>req.body,json:(res,status,body)=>{res.status=status;res.body=body;},fail:(status,message)=>Object.assign(new Error(message),{status}),profile:()=>({hisName:'恋人'}),randomInt:(min,max)=>{const value=rolls.length?rolls.shift():min;assert(value>=min&&value<max);return value;},respond:async task=>{modelCalls++;assert(task);if(delayed)return await delayed;return '想和安安一起读一页书。';}});
async function request(action,body={},expected=200){const res={},game=kv.get('monopoly',null);try{await engine.route({method:action?'POST':'GET',body:action==='new'?body:{id:game?.id,version:game?.version,requestId:crypto.randomUUID(),...body}},res,new URL('http://fixture/api/monopoly'+(action?'/'+action:'')));assert.equal(res.status,expected);return res.body;}catch(error){if(expected===200)throw error;assert.equal(error.status,expected,error.message);return error;}}
(async()=>{
 await request('new',{rounds:7},400);let state=await request('new',{rounds:5,name:'安安'});assert.equal(state.board.length,20);assert.equal(state.game.players[0].coins,40);await request('new',{rounds:5},409);
 rolls=[1];state=await request('roll');assert.equal(state.game.pending.kind,'buy');await request('roll',{},409);const stale=state.game.version;
 state=await request('resolve',{action:'buy'});assert.equal(state.game.owners[1],0);assert.equal(state.game.players[0].coins,16);await request('roll',{version:stale},409);
 rolls=[2,0];state=await request('roll');assert.equal(state.game.actor,1);assert.equal(state.game.pending.kind,'task');await request('resolve',{action:'complete'},400);
 state=await request('respond');assert.equal(modelCalls,1);assert(state.game.pending.reply.includes('安安'));await request('respond',{},409);state=await request('resolve',{action:'complete'});assert.equal(state.game.history[0].actor,1);assert.equal(state.game.history[0].completed,true);assert.equal(state.game.players[1].coins,46);
 rolls=[5];await request('roll');await request('resolve',{action:'buy'},400);state=await request('resolve',{action:'skip'});assert.equal(state.game.players[0].coins,16);
 rolls=[6];await request('roll');await request('resolve',{action:'skip'});
 rolls=[4,0];state=await request('roll');assert.equal(state.game.pending.category,'challenge');state=await request('resolve',{action:'complete',answer:'明天读两页书。'});assert.equal(state.game.history[1].answer,'明天读两页书。');assert.equal(state.game.players[0].coins,22);
 // Exact accounting: rent and passing start use server-generated dice only.
 let game=kv.get('monopoly');game.actor=1;game.players[1].position=0;kv.set('monopoly',game);rolls=[1];state=await request('roll');assert.equal(state.game.players[0].coins,26);assert.equal(state.game.players[1].coins,42);
 game=kv.get('monopoly');game.actor=0;game.players[0].position=19;game.players[1].position=0;kv.set('monopoly',game);rolls=[1];state=await request('roll');assert.equal(state.game.players[0].position,0);assert.equal(state.game.players[0].coins,40);assert.equal(state.game.players[1].coins,44);
 // End cannot be undone by a delayed model answer.
 game=kv.get('monopoly');game.actor=1;game.pending={kind:'task',task:'给对方一句问候。',reply:'',index:2};kv.set('monopoly',game);
 let release;delayed=new Promise(resolve=>release=resolve);const pending=request('respond',{},409);await new Promise(resolve=>setImmediate(resolve));await request('respond',{},409);state=await request('end');release('迟到的回复');await pending;assert.equal(kv.get('monopoly').status,'ended');assert.equal(kv.get('monopoly').pending,null);delayed=null;
 const oldId=kv.get('monopoly').id;state=await request('new',{id:oldId,version:kv.get('monopoly').version,rounds:5});assert.equal(kv.get('monopolyArchive').length,1);
 // Ten turns are five full rounds; skips never penalize either player.
 for(let i=0;i<10;i++){rolls=[];state=await request('roll');if(state.game.pending)state=await request('resolve',{action:'skip'});}
 assert.equal(state.game.status,'finished');assert.equal(state.game.turn,10);assert(engine.export().archive.length===1);
 console.log('PASS: 20 tiles, authoritative dice, prices/rent/start rewards, turn order, unaffordable purchases, task replies/history, free skips, stale versions, duplicate actions, delayed answers after end, archive and round completion.');
})().catch(error=>{console.error(error);process.exitCode=1;});
