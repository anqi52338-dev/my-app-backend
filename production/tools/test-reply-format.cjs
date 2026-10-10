const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE stickers(id INTEGER PRIMARY KEY,name TEXT,image TEXT,ts INTEGER);CREATE TABLE messages(id INTEGER PRIMARY KEY,text TEXT,image TEXT)");
const system=require('../stickers')({db});
db.prepare("INSERT INTO stickers(id,name,image,ts,owner,status,description,emotion_tags) VALUES(?,?,?,?,?,?,?,?)").run(7,'小白猫·求抱抱','st-7.gif',1,'assistant','active','小猫求抱抱','["撒娇"]');
db.prepare("INSERT INTO stickers(id,name,image,ts,owner,status,description,emotion_tags) VALUES(?,?,?,?,?,?,?,?)").run(8,'我的小猫','st-8.gif',1,'user','active','自己的小猫','["开心"]');
const text='宝宝，我看到你发的那张图片啦。';
for(const raw of [JSON.stringify({text,sticker_id:7}),text+'\n```json\n'+JSON.stringify({text,sticker_id:7})+'\n```',JSON.stringify(JSON.stringify({text,sticker_id:'7'})),JSON.stringify({text,sticker_id:'小白猫·求抱抱'}),text+'\n[sticker:7]',text+'\n[表情：小白猫·求抱抱] 画面：小猫求抱抱；情绪：撒娇',JSON.stringify({text:text+'\n'+text,sticker_id:7})]){
 const reply=system.decode(raw);assert.equal(reply.text,text,raw);assert.equal(reply.sticker.id,7,raw);assert.equal(reply.malformed,false,raw);
}
const nested=system.decode(JSON.stringify({text:JSON.stringify({text,sticker_id:7}),sticker_id:null}));assert.equal(nested.text,text);assert.equal(nested.sticker.id,7);
assert.equal(system.decode('前置重复\n'+JSON.stringify({text:'最后的正文',sticker_id:7})+'\n后置重复').text,'最后的正文');
assert.equal(system.decode(JSON.stringify({text:'第一稿',sticker_id:7})+'\n'+JSON.stringify({text:'最终正文',sticker_id:null})).text,'最终正文');
assert.equal(system.decode(JSON.stringify({text:'最终正文',sticker_id:null})+'\n'+JSON.stringify({candy_action:{action:'eat',index:0}})).text,'最终正文');
assert.equal(system.decode('好好好').text,'好好好');assert.equal(system.decode('第一段不同。\n\n第二段也不同。').text,'第一段不同。\n\n第二段也不同。');
const partial=system.decode(text+'\n```json\n{"text":"未完成');assert.equal(partial.malformed,true);assert(!partial.text.includes('```'));assert(!partial.text.includes('"text"'));
assert.equal(system.decode(text+'\n[sticker:9999]').sticker,null);assert.equal(system.decode(text+'\n[sticker:8]').sticker,null);
db.prepare("UPDATE stickers SET status='archived' WHERE id=7").run();assert.equal(system.decode(JSON.stringify({text,sticker_id:7})).sticker,null);
db.close();console.log('PASS: canonical JSON wins over duplicated prose; numeric/string/name IDs, double-encoded and nested JSON, metadata/markers, repeated replies, candy action coexistence, malformed fail-closed, unauthorized/unknown/archived stickers and short emphasis.');
