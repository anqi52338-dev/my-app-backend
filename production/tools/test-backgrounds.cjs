const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'background-test-'));
const preload=path.join(data,'preload.cjs');fs.writeFileSync(preload,`const id=require.resolve(${JSON.stringify(path.join(root,'claude.js'))});require.cache[id]={exports:{configure(){},status:async()=>({running:false}),restartNext(){}}};`);
const child=spawn(process.execPath,['--require',preload,path.join(root,'server.js')],{env:{...process.env,HOME_DATA:data,PORT:'3146'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);let cookie='';
async function api(url,method='GET',body){const res=await fetch('http://127.0.0.1:3146'+url,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{res,body:await res.json()};}
(async()=>{try{
let ready=false;for(let i=0;i<70;i++){try{await api('/api/auth');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert(ready,errors);
const auth=await api('/api/auth/setup','POST',{code:'fixture-only'});cookie=auth.res.headers.get('set-cookie').split(';')[0];
await api('/api/profile','PUT',{persona:'Preserve existing persona',hisName:'Fixture'});
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2xkAAAAASUVORK5CYII=';
let saved=await api('/api/profile','PUT',{bg:'custom',bgImage:image});assert.equal(saved.res.status,200);const name=saved.body.profile.bgImage;assert(name.startsWith('bg-'));assert.equal(saved.body.profile.persona,'Preserve existing persona');
const file=await fetch('http://127.0.0.1:3146/api/file/'+name,{headers:{cookie}});assert.equal(file.status,200);assert.equal(Buffer.from(await file.arrayBuffer()).toString('base64'),image.split(',')[1]);assert.equal((await fetch('http://127.0.0.1:3146/api/file/'+name)).status,401);
assert.equal((await api('/api/state')).body.profile.bgImage,name);
for(const bg of ['cream','letter','moon','sage']){const r=await api('/api/profile','PUT',{bg});assert.equal(r.res.status,200);assert.equal(r.body.profile.bgImage,name);}
await api('/api/profile','PUT',{bg:'custom'});
const before=(await api('/api/state')).body.profile;
for(const patch of [{bg:'evil'},{bgImage:null},{bgImage:'data:image/svg+xml;base64,PHN2Zz4='},{bgImage:'data:image/png;base64,dGVzdA=='},{bg:'custom',bgImage:''}]){assert.equal((await api('/api/profile','PUT',patch)).res.status,400);assert.deepEqual((await api('/api/state')).body.profile,before);}
saved=await api('/api/profile','PUT',{bg:'ivory',bgImage:''});assert.equal(saved.res.status,200);assert.equal(saved.body.profile.bgImage,'');assert.equal((await api('/api/profile','PUT',{bg:'custom'})).res.status,400);
console.log('PASS: authenticated upload, exact file bytes, persisted profile, preset/custom switching, invalid input keeps settings, reset and private file authentication.');
}finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.rmSync(data,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
