const assert=require('node:assert/strict'),create=require('../chat-routes');
const store=new Map([['backup',{baseUrl:'https://one.example/v1',key:'key-one',model:'model-one',chat:true,memory:false}]]);let busy=false,lastConfig,modelKey;
const system=create({kv:{get:(k,f)=>store.has(k)?store.get(k):f,set:(k,v)=>store.set(k,v)},readBody:async req=>req.body,json:(res,status,body)=>{res.status=status;res.body=body;},fail:(status,message)=>Object.assign(Error(message),{status}),isBusy:()=>busy,complete:async(m,b)=>{lastConfig=b;return 'OK';},models:{normalizeBase:s=>new URL(s).href.replace(/\/$/,''),fetchModels:async(u,key)=>{modelKey=key;return[{id:key}];}}});
async function request(path,method,body){const res={};assert(await system.route({method,body},res,new URL('https://fixture'+path)));return res;}
(async()=>{assert.equal(system.active(),'backup');assert.equal(system.selected().key,'key-one');
await request('/api/backup2','PUT',{baseUrl:'https://two.example/v1',key:'key-two',model:'model-two',maxTokens:1000});assert.equal(system.active(),'backup','saving line 2 does not switch');
await request('/api/chat-route','PUT',{route:'backup2'});assert.equal(system.selected().key,'key-two');assert.equal(system.publicConfig('backup').hasKey,true);assert(!JSON.stringify(system.publicConfig('backup2')).includes('key-two'));
await request('/api/backup/test','POST',{});assert.equal(lastConfig.key,'key-one');assert.equal(system.active(),'backup2','test does not switch');
await request('/api/backup2/models','POST',{baseUrl:'https://two.example/v1'});assert.equal(modelKey,'key-two');
await assert.rejects(request('/api/backup2/models','POST',{baseUrl:'https://other.example/v1'}),e=>e.status===400);
await assert.rejects(request('/api/backup2','PUT',{baseUrl:'https://other.example/v1'}),e=>e.status===400);assert.equal(system.selected().key,'key-two');
await request('/api/backup2','PUT',{model:'new-model',key:''});assert.equal(system.selected().key,'key-two');assert.equal(system.config('backup').model,'model-one');
busy=true;await assert.rejects(request('/api/chat-route','PUT',{route:'backup'}),e=>e.status===409);busy=false;
await assert.rejects(request('/api/backup2','PUT',{maxTokens:65536}),e=>e.status===400);
await request('/api/chat-route','PUT',{route:'subscription'});assert.equal(system.active(),'subscription');
await request('/api/backup','PUT',{chat:true});assert.equal(system.active(),'backup','old clients preserve compatibility');
console.log('PASS: existing route/key migration, separate credentials, explicit switching, independent tests/catalogs, no secret in state, same-host key binding, validation and busy switch protection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
