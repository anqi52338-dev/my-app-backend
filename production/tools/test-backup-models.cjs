const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{EventEmitter}=require('node:events');
const root=process.argv[2]||path.resolve(__dirname,'..'),mod=require(path.join(root,'backup-models'));
async function unit(){
assert.equal(mod.normalizeBase(' https://openrouter.ai/api/v1/// '),'https://openrouter.ai/api/v1');
for(const u of ['http://example.com','https://user:pass@example.com','https://example.com?key=x','bad'])assert.throws(()=>mod.normalizeBase(u));
for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.1.2','192.168.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2002:7f00:1::'])assert.equal(mod.publicAddress(ip),false,ip);
for(const ip of ['8.8.8.8','2606:4700:4700::1111'])assert.equal(mod.publicAddress(ip),true);
assert.deepEqual(mod.parseModels({data:[{id:'b',name:'Bee'},{id:'a'},{id:'b',name:'B'},null,{id:''}]}),[{id:'a',name:'a'},{id:'b',name:'B'}]);
assert.throws(()=>mod.parseModels({data:[]}));assert.throws(()=>mod.parseModels({html:'wrong'}));
const https=require('node:https'),dns=require('node:dns').promises,originalRequest=https.request,originalLookup=dns.lookup;
let status=200,catalog={data:[{id:'anthropic/test',name:'Claude Test'}]},requested=0;
dns.lookup=async()=>[{address:'8.8.8.8',family:4}];
https.request=(url,options,callback)=>{
requested++;assert.equal(url.pathname,'/api/v1/models');assert.equal(options.headers.authorization,'Bearer fixture-key');
options.lookup('example.com',{all:true},(err,addresses)=>{assert.equal(err,null);assert.equal(addresses[0].address,'8.8.8.8');});
const request=new EventEmitter();request.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=status;response.resume=()=>queueMicrotask(()=>request.emit('close'));callback(response);if(status===200){response.emit('data',Buffer.from(JSON.stringify(catalog)));response.emit('end');request.emit('close');}});request.destroy=e=>{request.emit('error',e);request.emit('close');};return request;
};
try{
assert.equal((await mod.fetchModels('https://example.com/api/v1','fixture-key'))[0].id,'anthropic/test');
status=302;await assert.rejects(mod.fetchModels('https://example.com/api/v1','fixture-key'),/302/);assert.equal(requested,2);
status=401;await assert.rejects(mod.fetchModels('https://example.com/api/v1','fixture-key'),/密钥/);
dns.lookup=async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}];const before=requested;await assert.rejects(mod.fetchModels('https://example.com/api/v1','fixture-key'),/公网/);assert.equal(requested,before);
}finally{https.request=originalRequest;dns.lookup=originalLookup;}
}
async function routes(){
const data=fs.mkdtempSync(path.join(os.tmpdir(),'models-route-test-')),preload=path.join(data,'preload.cjs');
fs.writeFileSync(preload,`const path=require('node:path');const id=require.resolve(${JSON.stringify(path.join(root,'claude.js'))});require.cache[id]={id,filename:id,loaded:true,exports:{configure(){},status:async()=>({running:false})}};const m=require(${JSON.stringify(path.join(root,'backup-models.js'))});m.fetchModels=async(base,key)=>{if(key!=='draft-key'&&key!=='saved-key')throw new Error('fixture mismatch');return [{id:'anthropic/fixture',name:'Fixture'}];};`);
const child=spawn(process.execPath,['--require',preload,path.join(root,'server.js')],{env:{...process.env,HOME_DATA:data,PORT:'3124'},stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);let cookie='';
const call=async(url,method='GET',body)=>{const r=await fetch('http://127.0.0.1:3124'+url,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,body:await r.json()};};
try{
let started=false;for(let i=0;i<70;i++){try{await call('/api/auth');started=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert(started,stderr);
assert.equal((await call('/api/backup/models','POST',{baseUrl:'https://example.com/api/v1',key:'draft-key'})).status,401);
let r=await call('/api/auth/setup','POST',{code:'fixture-only'});cookie=r.headers.get('set-cookie').split(';')[0];
r=await call('/api/backup/models','POST',{baseUrl:'https://example.com/api/v1',key:'draft-key'});assert.equal(r.status,200);assert.equal(r.body.models.length,1);
assert.equal((await call('/api/state')).body.backup.hasKey,false,'listing must not save key');
await call('/api/backup','PUT',{baseUrl:'https://example.com/api/v1',key:'saved-key',model:'existing',chat:false});
r=await call('/api/backup/models','POST',{baseUrl:'https://example.com/api/v1/',key:''});assert.equal(r.status,200);
r=await call('/api/backup/models','POST',{baseUrl:'https://other.example.com/api/v1',key:''});assert.equal(r.status,400,'saved credential must not be forwarded to changed URL');
assert.equal((await call('/api/backup/models','POST',{baseUrl:'http://example.com',key:'draft-key'})).status,400);
r=(await call('/api/state')).body;assert.equal(r.backup.model,'existing');assert.equal(r.backup.chat,false);assert(!JSON.stringify(r).includes('saved-key'));
// Capture the real outbound completion payload with an isolated local provider.
let captured,providerMode='ok';
const provider=require('node:http').createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;captured=JSON.parse(text);res.setHeader('content-type','application/json');
if(providerMode==='budget'){res.statusCode=402;res.end(JSON.stringify({error:{message:'requires credits'}}));}
else if(providerMode==='length')res.end(JSON.stringify({choices:[{finish_reason:'length',message:{content:''}}]}));
else res.end(JSON.stringify({choices:[{message:{content:'好'}}]}));});
await new Promise(resolve=>provider.listen(3126,'127.0.0.1',resolve));
try{
assert.equal((await call('/api/state')).body.backup.maxTokens,2048);
await call('/api/backup','PUT',{baseUrl:'http://127.0.0.1:3126',key:'fixture-provider',model:'fixture'});
assert.equal((await call('/api/backup/test','POST')).status,200);assert.equal(captured.max_tokens,2048);
assert.equal((await call('/api/backup','PUT',{maxTokens:4000})).status,200);
assert.equal((await call('/api/backup/test','POST')).status,200);assert.equal(captured.max_tokens,4000);
for(const maxTokens of [65536,0,-1,255,4001,2048.5,'2048',null])assert.equal((await call('/api/backup','PUT',{maxTokens})).status,400);
assert.equal((await call('/api/state')).body.backup.maxTokens,4000);
providerMode='budget';r=await call('/api/backup/test','POST');assert.equal(r.status,502);assert(r.body.error.includes('余额或密钥'));
providerMode='length';r=await call('/api/backup/test','POST');assert.equal(r.status,502);assert(r.body.error.includes('思考'));
}finally{await new Promise(resolve=>provider.close(resolve));}

}finally{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));fs.rmSync(data,{recursive:true,force:true});}
}
unit().then(routes).then(()=>console.log('PASS: model parsing, HTTPS/public-address checks, pinned DNS, no redirect, provider errors, authenticated listing, unsaved drafts, saved-key reuse and changed-address protection, explicit default/custom max_tokens, validation, budget and reasoning-limit errors.')).catch(e=>{console.error(e);process.exitCode=1;});
