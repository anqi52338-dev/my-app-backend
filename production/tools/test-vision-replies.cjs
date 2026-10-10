const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const root=process.argv[2]||path.resolve(__dirname,'..');
const memory=new DatabaseSync(':memory:');memory.exec("CREATE TABLE stickers(id INTEGER PRIMARY KEY,name TEXT,image TEXT,ts INTEGER);CREATE TABLE messages(id INTEGER PRIMARY KEY,text TEXT,image TEXT)");
const stickers=require(path.join(root,'stickers'))({db:memory});
for(const [raw,expected] of [['{"text":"你好","sticker_id":null,"candy_action":{"action":"eat","index":0}}','你好'],['你好\n```json\n{"text":"再说一句","sticker_id":null}\n```','你好\n再说一句'],['你好\n{"candy_action":{"action":"feed","index":1}}','你好'],['{"text":"带有 {括号} 和 \\"引号\\"","sticker_id":null}','带有 {括号} 和 "引号"'],['普通回复','普通回复']])assert.equal(stickers.decode(raw).text,expected);
assert.equal(stickers.decode('你好\n{"candy_action":{"action":"feed","index":1}}').candyAction.action,'feed');for(const reply of ['这是完整的一段回复，宝宝。','第一句说完。\n\n再说第二句，安安。']) {
 assert.equal(stickers.decode(reply+'\n\n'+reply).text,reply);
 assert.equal(stickers.decode(reply+reply).text,reply);
 assert.equal(stickers.decode(JSON.stringify({text:reply+'\n\n'+reply,sticker_id:null})).text,reply);
}
assert.equal(stickers.decode('好好好').text,'好好好');
assert.equal(stickers.decode('先说这一句。\n\n再说不同的一句。').text,'先说这一句。\n\n再说不同的一句。');
memory.close();
const data=fs.mkdtempSync(path.join(os.tmpdir(),'vision-regression-'));const preload=path.join(data,'preload.cjs');fs.writeFileSync(preload,`const id=require.resolve(${JSON.stringify(path.join(root,'claude.js'))});require.cache[id]={exports:{configure(){},status:async()=>({running:false}),restartNext(){}}};`);
let payloads=[],mode='ok';const provider=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;payloads.push(JSON.parse(text));res.setHeader('content-type','application/json');if(mode==='error'){res.statusCode=400;res.end(JSON.stringify({error:{message:'fixture image rejected'}}));}else res.end(JSON.stringify({choices:[{message:{content:'正常回复\n```json\n{"text":"糖果回复","sticker_id":null}\n```'}}]}));});
(async()=>{await new Promise(r=>provider.listen(3138,'127.0.0.1',r));const child=spawn(process.execPath,['--require',preload,path.join(root,'server.js')],{env:{...process.env,HOME_DATA:data,PORT:'3137',PYTHON:process.env.PYTHON||'python3'},stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',b=>err+=b);let cookie='';
async function api(url,method='GET',body){const r=await fetch('http://127.0.0.1:3137'+url,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {r,text,json:()=>JSON.parse(text)};}
try{let ready=false;for(let i=0;i<70;i++){try{await api('/api/auth');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert(ready,err);const login=await api('/api/auth/setup','POST',{code:'fixture-only'});cookie=login.r.headers.get('set-cookie').split(';')[0];await api('/api/backup','PUT',{baseUrl:'http://127.0.0.1:3138',key:'fixture-only',model:'fixture',chat:true,memory:false});
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2xkAAAAASUVORK5CYII=';
let response=await api('/api/chat','POST',{text:'第一张图片',image});assert(response.text.includes('糖果回复'));assert(!response.text.includes('```'));const blocks=p=>p.messages.filter(m=>Array.isArray(m.content)).flatMap(m=>m.content).filter(c=>c.type==='image_url');assert.equal(blocks(payloads[0])[0].image_url.url,image);
await api('/api/chat','POST',{text:'刚才图片里是什么'});assert.equal(blocks(payloads[1])[0].image_url.url,image,'text follow-up must keep original image');
await api('/api/chat','POST',{text:'第二张图片',image});assert.equal(blocks(payloads[2]).length,2,'both images retained');
mode='error';const before=payloads.length;response=await api('/api/chat','POST',{text:'再看看'});assert(response.text.includes('fixture image rejected'));assert.equal(payloads.length,before+1,'no text-only retry after provider rejects image');
const files=fs.readdirSync(path.join(data,'workspace/uploads'));fs.unlinkSync(path.join(data,'workspace/uploads',files[0]));const count=payloads.length;response=await api('/api/chat','POST',{text:'图片还在吗'});assert(response.text.includes('图片文件已丢失'));assert.equal(payloads.length,count,'missing file never sent as placeholder');
console.log('PASS: real outbound payload retains exact original images across follow-ups and multiple uploads; provider/file failures do not downgrade to text; mixed/fenced candy JSON decoded without leaking protocol.');
}finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await new Promise(r=>provider.close(r));fs.rmSync(data,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
