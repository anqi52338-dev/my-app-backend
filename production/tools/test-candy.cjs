const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),os=require('node:os');
const root=process.argv[2]||path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'candy-http-test-'));
fs.writeFileSync(path.join(data,'reply.json'),JSON.stringify({text:'测试回复',sticker_id:null}));
const preload=path.join(data,'preload.cjs');
fs.writeFileSync(preload,`const fs=require('node:fs'),path=require('node:path');const id=require.resolve(${JSON.stringify(path.join(root,'claude.js'))});require.cache[id]={id,filename:id,loaded:true,exports:{configure(){},status:async()=>({running:true}),restartNext(){},onHook(){},interrupt:async()=>false,ask:async o=>{fs.writeFileSync(path.join(process.env.HOME_DATA,'captured.txt'),o.prompt(false));return {text:fs.readFileSync(path.join(process.env.HOME_DATA,'reply.json'),'utf8')};}}};`);
const child=spawn(process.execPath,['--require',preload,path.join(root,'server.js')],{env:{...process.env,HOME_DATA:data,PORT:'3118'},stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);
let providerBody;const provider=require('node:http').createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;providerBody=JSON.parse(text);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({text:'备用线路测试回复',sticker_id:null})}}]}));}).listen(3119,'127.0.0.1');
async function tests(){let cookie='';const call=async(p,method='GET',body)=>{const r=await fetch('http://127.0.0.1:3118'+p,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {code:r.status,headers:r.headers,...(r.headers.get('content-type')?.includes('application/json')?JSON.parse(text):{text})};};
for(let i=0;i<60;i++){try{await call('/api/auth');break;}catch{await new Promise(r=>setTimeout(r,100));}}
assert.equal((await call('/api/candy')).code,401);
let r=await call('/api/auth/setup','POST',{code:'candy-only-test'});cookie=r.headers.get('set-cookie').split(';')[0];
r=await call('/api/candy');assert.equal(r.state.jar,null);assert.equal(r.state.jars.length,5);assert.equal(r.prefs.autonomous,false);assert.equal(r.state.total,61);
assert.equal((await call('/api/candy/choose','POST',{jar:9})).code,400);
r=await call('/api/candy/choose','POST',{jar:2});assert.equal(r.state.jar.candies.length,20);const day=r.state.day;
assert(!JSON.stringify(r).includes('perform'));assert(!r.state.jar.candies.some(c=>c.name));
assert.equal((await call('/api/candy/choose','POST',{jar:1})).code,400);
assert.equal((await call('/api/candy/eat','POST',{day:'2000-01-01',source:'jar',target:'user',index:0})).code,409);
assert.equal((await call('/api/candy/buy','POST',{dest:'reserve',id:'batong'})).code,400);
const duplicates=await Promise.all([call('/api/candy/eat','POST',{day,source:'jar',target:'ai',index:0}),call('/api/candy/eat','POST',{day,source:'jar',target:'ai',index:0})]);
assert.equal(duplicates.filter(r=>r.code===200).length,1);r=await call('/api/candy');assert.equal(r.state.jar.candies.length,19);assert.equal(r.state.dex.length,1);
const id=r.state.dex[0].id;const credit=r.state.courage.user;
r=await call('/api/candy/buy','POST',{dest:'reserve',id,price:0});assert.equal(r.code,200);assert.equal(r.state.courage.user,credit-5);assert.equal(r.state.reserve.length,1);
r=await call('/api/candy/eat','POST',{day,source:'reserve',target:'user',index:0});assert.equal(r.code,200);assert.equal(r.state.reserve.length,0);
await call('/api/candy/clear','POST',{});r=await call('/api/candy');assert.equal(r.state.active.length,0);assert.equal(r.state.jar.candies.length,19);
// Seed a known effect only in isolated test data, then validate both chat paths.
let save=JSON.parse(fs.readFileSync(path.join(data,'candyjar_save.json'),'utf8'));save.active=[{target:'ai',candy_id:'kuakua',expires:new Date(Date.now()+600000).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}).replace(' ','T')}];fs.writeFileSync(path.join(data,'candyjar_save.json'),JSON.stringify(save));
await call('/api/chat','POST',{text:'测试效果传递'});assert(fs.readFileSync(path.join(data,'captured.txt'),'utf8').includes('夸夸'));
await call('/api/backup','PUT',{baseUrl:'http://127.0.0.1:3119',key:'isolated-test-only',model:'test',chat:true});await call('/api/chat','POST',{text:'备用线路糖果状态'});assert(providerBody.messages[0].content.includes('夸夸'));await call('/api/backup','PUT',{chat:false});
await call('/api/candy/prefs','POST',{enabled:false});await call('/api/chat','POST',{text:'关闭后的聊天'});assert(fs.readFileSync(path.join(data,'captured.txt'),'utf8').includes('糖果聊天效果已关闭'));assert(!fs.readFileSync(path.join(data,'captured.txt'),'utf8').includes('演法：'));
await call('/api/candy/prefs','POST',{enabled:true,autonomous:true});r=await call('/api/candy');let index=r.state.jar.candies[0].index;
fs.writeFileSync(path.join(data,'reply.json'),JSON.stringify({text:'想喂你一颗',sticker_id:null,candy_action:{action:'feed',index,day}}));
await call('/api/chat','POST',{text:'拿颗糖吧'});r=await call('/api/candy');assert.equal(r.offer.index,index);assert.equal(r.state.jar.candies.length,19);
r=await call('/api/candy/offer','POST',{accept:false});assert.equal(r.offer,null);assert.equal(r.state.jar.candies.length,19);
await call('/api/chat','POST',{text:'再邀请一次'});r=await call('/api/candy/offer','POST',{accept:true});assert.equal(r.state.jar.candies.length,18);
r=await call('/api/candy');index=r.state.jar.candies[0].index;
fs.writeFileSync(path.join(data,'reply.json'),JSON.stringify({text:'我尝一下',sticker_id:null,candy_action:{action:'eat',index,day}}));await call('/api/chat','POST',{text:'你也吃一颗'});r=await call('/api/candy');assert.equal(r.state.jar.candies.length,17);
const messages=(await call('/api/messages')).messages;assert(messages.at(-1).text.includes('他从糖罐里吃了一颗'));assert(!messages.at(-1).text.includes('candy_action'));
const exported=await call('/api/export');assert.equal(exported.candy.save.jar.candies.length,17);
// Expiry is enforced by server time, not browser presentation.
save=JSON.parse(fs.readFileSync(path.join(data,'candyjar_save.json'),'utf8'));save.active.forEach(a=>a.expires='2000-01-01T00:00:00');fs.writeFileSync(path.join(data,'candyjar_save.json'),JSON.stringify(save));assert.equal((await call('/api/candy')).state.active.length,0);
// Corrupt saves are preserved and fail closed.
fs.writeFileSync(path.join(data,'candyjar_save.json'),'{corrupt');assert.equal((await call('/api/candy')).code,503);assert.equal(fs.readFileSync(path.join(data,'candyjar_save.json'),'utf8'),'{corrupt');
assert.equal((await call('/api/life/prefs')).code,200);assert.equal((await call('/api/stickers')).code,200);assert.equal((await call('/api/voice')).code,200);
console.log('PASS: authenticated routes, hidden effects, daily choice, duplicate consumption, server prices, storage, clear/expiry, chat injection/toggle, AI self-eat, feed consent, corrupt-save preservation, existing module routes.');
}
tests().catch(e=>{console.error(e,stderr);process.exitCode=1;}).finally(()=>{child.kill();provider.close();fs.rmSync(data,{recursive:true,force:true});});
