const assert=require('node:assert/strict'),path=require('node:path');
const split=require(process.argv[2]||path.resolve(__dirname,'../../../frontend/production/public/reply-bubbles.js'));
for(const text of ['第一条\n\n第二条','第一条\n第二条','第一条\r\n \r\n第二条'])assert.deepEqual(split(text),['第一条','第二条']);
const paragraph='宝宝，今天的事情我听明白了。你先慢慢说，我会认真听。我们一起想想接下来怎么办。';
assert.equal(split(paragraph).length,3);assert.equal(split(paragraph).join(''),paragraph);
const action='（把书放在桌上。然后坐到旁边。）宝宝，先喝一点水。你刚才说的事情，我想再听听。';assert.equal(split(action)[0],'（把书放在桌上。然后坐到旁边。）宝宝，先喝一点水。');assert.equal(split(action).join(''),action);
for(const text of ['好。','看看 https://example.com/?q=one。这是你刚才发来的链接。','```js\nconst x=1;\n```','1. 第一项\n2. 第二项'])assert.deepEqual(split(text),[text]);
const long=Array.from({length:20},(_,i)=>`这是第${i}句独立的话。`).join('');assert(split(long).length<=4);assert.equal(split(long).join(''),long);assert.deepEqual(split(''),[]);
console.log('PASS: multi-bubble blank/single/Windows newlines, sentence fallback, short replies, complete actions, no lost/duplicate text, bounded fallback, code/link/list preservation.');
