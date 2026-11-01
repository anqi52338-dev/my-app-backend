const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),history=require('../chat-history'),create=require('../presence');
const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE messages(id INTEGER PRIMARY KEY,role TEXT,text TEXT,ts INTEGER,archived INTEGER DEFAULT 0)');
const insert=db.prepare('INSERT INTO messages(role,text,ts,archived) VALUES(?,?,?,0)');let ts=Date.parse('2026-11-01T00:30:00Z');
insert.run('me','我想接着聊昨天那本小说',ts-3*3600000);insert.run('him','我们刚才说到女主的选择',ts-2*3600000);
for(let i=0;i<40;i++)insert.run('him','之前的主动消息 '+i,ts-3600000+i);
const selected=history(db,{proactive:true});assert(selected.some(m=>m.text==='我想接着聊昨天那本小说'));assert(selected.some(m=>m.text==='之前的主动消息 39'));assert(selected.length<=28);assert.equal(new Set(selected.map(m=>m.id)).size,selected.length);assert(!history(db).some(m=>m.role==='me'),'fixture demonstrates ordinary recent history lost the actual conversation');
let requests=0;const calls=[],store=new Map([['presencePrefs',{enabled:true,allDay:true,enabledAt:ts-3*3600000,gapMinutes:120}]]),kv={get:(k,f)=>store.has(k)?store.get(k):f,set:(k,v)=>store.set(k,structuredClone(v))};
const make=()=>{let p;p=create({kv,db,now:()=>ts,readBody:async r=>r.body,json(){},fail:(status,message)=>Object.assign(Error(message),{status}),isBusy:()=>false,isBlocked:()=>false,acquire:()=>true,release(){},fetcher:async()=>{requests++;return{ok:true,json:async()=>({current:{time:'2026-11-01T08:30',temperature_2m:15,weather_code:2},timezone:'Asia/Shanghai',daily:{}})};},send:async(task,options)=>{calls.push({task,options,context:await p.context(options)});return true;}});return p;};
(async()=>{let p=make();await p.tick();assert.equal(requests,1);assert(calls[0].options.allowWeather);assert(calls[0].task.includes('最后一段真实聊天'));assert(calls[0].task.includes('不要每次重开话题'));
for(let i=1;i<=2;i++){ts+=2*3600000;p=make();await p.tick();assert.equal(requests,1);assert.equal(calls.at(-1).options.allowWeather,false);assert(!calls.at(-1).context.includes('15℃'));assert(calls.at(-1).context.includes('不查询'));}
ts+=2*3600000;await p.tick();assert.equal(requests,2);assert(calls.at(-1).options.allowWeather,'six hours passed');
const oldCalls=requests;await p.context();assert.equal(requests,oldCalls,'normal conversation still uses fresh weather cache');
// Existing installations seed the first cooldown from the previous proactive send.
ts+=2*3600000;store.set('proactiveState',{lastSent:ts-3600000,lastAttempt:ts-3*3600000,day:'old',sent:2});p=make();await p.tick();assert(!calls.at(-1).options.allowWeather);assert.equal(requests,oldCalls);
ts+=2*3600000;p=make();await p.tick();assert(!calls.at(-1).options.allowWeather,'restart preserves seeded weather cooldown');
const prefs=p.prefs();store.set('presencePrefs',{...prefs,location:{name:'另一个城市',latitude:31.23,longitude:121.47}});ts+=2*3600000;await p.tick();assert(calls.at(-1).options.allowWeather,'explicit location changes use the right city');
db.close();console.log('PASS: anchored last human conversation plus recent proactive messages; 6h weather cooldown persists across restarts; skipped turns have no request or temperature context; legacy cooldown migration; location change and normal-chat cache remain correct.');
})().catch(e=>{console.error(e);process.exitCode=1;});
