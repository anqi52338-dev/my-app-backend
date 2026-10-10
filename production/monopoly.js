'use strict';
const crypto=require('node:crypto');
const BOARD=[['起点','start','♡'],['花间小屋','plot','⌂'],['夸夸卡','praise','✿'],['午后茶馆','plot','☕'],['小幸运','chance','☆'],['真心话','truth','?'],['海边书店','plot','▤'],['约会卡','date','♡'],['心动花园','plot','✿'],['休息一下','rest','☾'],['日常挑战','challenge','♧'],['窗边咖啡','plot','☕'],['真心话','truth','?'],['星光影院','plot','☆'],['小幸运','chance','☆'],['夸夸卡','praise','✿'],['月亮露台','plot','☾'],['约会卡','date','♡'],['甜点厨房','plot','♧'],['小礼物','gift','♔']].map(([name,kind,icon],index)=>({index,name,kind,icon,price:18+(index%3)*6,rent:3+index%3}));
const TASKS={challenge:['选一首今天想分享给对方的歌，说说理由。','想一个明天的小目标，再选一个最容易做到的步骤。','给对方描述身边一件让你觉得舒服的小东西。','一起安排一个三分钟的小休息。','给对方留一句明天醒来可以看到的问候。'],praise:['说出对方一个让你心动的小习惯。','用三句话夸夸对方，每一句都带一个具体理由。','给对方起一个温柔的小昵称，并解释为什么。','说一句你想让对方今天记住的话。','夸夸对方最近做得不错的一件事。'],truth:['如果一起度过一个不用赶时间的下午，你最想做什么？','你最喜欢我们相处时的哪一个瞬间？','你心情不好时，希望对方怎样陪着你？','分享一件让你感到被喜欢的小事。','说一个你希望我们慢慢养成的小习惯。'],date:['提出一个舒服的雨天约会计划。','给我们安排一场只需十分钟的小约会。','选一本书或一部电影，说说为什么想一起看。','设计一顿简单的双人早餐。','想一个不用花钱也能开心的约会。']};
module.exports=function({kv,readBody,json,fail,respond,profile,randomInt=crypto.randomInt}){
 const get=()=>kv.get('monopoly',null);let generating=null;
 const log=(s,text)=>{s.log.push({text,ts:Date.now()});s.log=s.log.slice(-80);};
 const save=s=>{s.version++;s.updated=Date.now();kv.set('monopoly',s);return s;};
 const view=s=>({game:s,board:BOARD});
 const advance=s=>{s.pending=null;s.turn++;if(s.turn>=s.rounds*2){s.status='finished';const[a,b]=s.players;s.winner=a.coins===b.coins?null:a.coins>b.coins?0:1;log(s,s.winner===null?'平局！一起把这段小日子收好。':s.players[s.winner].name+'赢啦，可以提出一个双方愿意的小约定。');}else s.actor=s.turn%2;};
 const checked=b=>{const s=get();if(!s||s.id!==b.id||s.version!==b.version)throw fail(409,'棋盘已更新，请刷新后继续');if(s.status!=='active')throw fail(409,'这局已经结束了');return s;};
 async function route(req,res,url){const p=url.pathname;if(!p.startsWith('/api/monopoly'))return false;
  if(req.method==='GET'&&p==='/api/monopoly'){json(res,200,view(get()));return true;}
  if(req.method!=='POST')throw fail(404,'没有这个棋盘地址');const b=await readBody(req);
  if(p==='/api/monopoly/new'){
   const previous=get();if(previous?.status==='active')throw fail(409,'先结束当前这一局，再开新局吧');
   if(previous&&(b.id!==previous.id||b.version!==previous.version))throw fail(409,'存档已更新，请刷新');
   const rounds=b.rounds??10;if(![5,10,15].includes(rounds))throw fail(400,'请选择 5、10 或 15 轮');
   const names=[String(b.name||'安安').trim().slice(0,20)||'安安',String(profile().hisName||'恋人').slice(0,20)];
   if(previous)kv.set('monopolyArchive',[...(kv.get('monopolyArchive',[])),previous].slice(-10));
   const s={history:[],id:crypto.randomUUID(),version:0,status:'active',rounds,turn:0,actor:0,players:names.map(name=>({name,coins:40,position:0})),owners:Array(20).fill(null),pending:null,dice:null,winner:null,log:[],created:Date.now(),seen:[]};log(s,'新的一局开始啦。每人 40 枚金币，任务随时可以跳过。');json(res,200,view(save(s)));return true;
  }
  const s=checked(b);if(typeof b.requestId!=='string'||! /^[a-f0-9-]{36}$/i.test(b.requestId))throw fail(400,'操作编号无效');
  if(s.seen.includes(b.requestId))throw fail(409,'这次操作已经处理，请刷新棋盘');
  if(p==='/api/monopoly/respond'){
   if(!s.pending?.task||s.actor!==1)throw fail(400,'现在没有他的任务');if(s.pending.reply)throw fail(409,'他已经回应过这张卡');if(generating)throw fail(409,'他正在想这一张卡');
   const stamp={id:s.id,version:s.version};generating=stamp;
   try{const text=String(await respond(s.pending.task)).trim().slice(0,1600);if(!text)throw fail(502,'这次没有收到回复，可以重试或跳过');const now=checked(b);now.pending.reply=text;now.seen.push(b.requestId);json(res,200,view(save(now)));}
   finally{if(generating===stamp)generating=null;}return true;
  }
  if(p==='/api/monopoly/roll'){
   if(s.pending)throw fail(409,'先完成或跳过这张卡');const who=s.actor,a=s.players[who],other=s.players[1-who];s.dice=randomInt(1,7);const dest=a.position+s.dice;a.position=dest%20;
   log(s,a.name+'掷出 '+s.dice+' 点，来到「'+BOARD[a.position].name+'」。');if(dest>=20){a.coins+=12;log(s,a.name+'经过起点，收到 12 枚金币。');}
   if(a.position===other.position){a.coins+=2;other.coins+=2;log(s,'在同一格碰面，两人各收获 2 枚金币。');}
   const tile=BOARD[a.position];
   if(tile.kind==='plot'){
    const owner=s.owners[tile.index];if(owner===null)s.pending={kind:'buy',index:tile.index};
    else{if(owner!==who){const rent=Math.min(a.coins,tile.rent);a.coins-=rent;other.coins+=rent;log(s,a.name+'给'+other.name+'留下 '+rent+' 枚过路金币。');}else log(s,'回到自己的小地方，歇一歇。');advance(s);}
   }else if(TASKS[tile.kind]){const deck=TASKS[tile.kind];s.pending={kind:'task',category:tile.kind,task:deck[randomInt(0,deck.length)],reply:'',index:tile.index};}
   else{if(tile.kind==='chance'){const events=[['捡到一张幸运书签',8],['买了两杯热饮',-6],['收到小小的祝福',10],['买一束花送给对方',-4]];const[text,amount]=events[randomInt(0,events.length)];a.coins=Math.max(0,a.coins+amount);log(s,text+'，'+(amount>0?'+':'')+amount+' 枚金币。');}if(tile.kind==='gift'){a.coins+=8;log(s,'一份小礼物，收获 8 枚金币。');}if(tile.kind==='rest'){a.coins+=3;log(s,'慢慢休息一会儿，收获 3 枚金币。');}advance(s);}
  }else if(p==='/api/monopoly/resolve'){
   if(!s.pending)throw fail(409,'现在没有待处理的卡片');const a=s.players[s.actor],pending=s.pending;
   if(pending.kind==='buy'){if(!['buy','skip'].includes(b.action))throw fail(400,'请选择占地或路过');const tile=BOARD[pending.index];if(b.action==='buy'){if(a.coins<tile.price)throw fail(400,'金币不够，可以先路过');a.coins-=tile.price;s.owners[tile.index]=s.actor;log(s,a.name+'用 '+tile.price+' 枚金币收下「'+tile.name+'」。');}else log(s,a.name+'路过，留着金币等下一站。');}
   else{if(!['complete','skip'].includes(b.action))throw fail(400,'请选择完成或跳过');if(b.action==='complete'){if(s.actor===1&&!pending.reply)throw fail(400,'先听听他的回应，或者跳过这张卡');a.coins+=6;log(s,a.name+'完成「'+BOARD[pending.index].name+'」，收获 6 枚金币。');}else log(s,a.name+'跳过这张卡，没有扣分。');}if(pending.kind==='task'){const answer=s.actor===1?pending.reply:String(b.answer||'').trim().slice(0,1600);s.history=[...(s.history||[]),{actor:s.actor,task:pending.task,answer,completed:b.action==='complete',ts:Date.now()}].slice(-50);}advance(s);
  }else if(p==='/api/monopoly/end'){s.status='ended';s.pending=null;log(s,'这一局已收好，随时可以开始新的旅程。');}
  else throw fail(404,'没有这个棋盘操作');s.seen=[...s.seen,b.requestId].slice(-80);json(res,200,view(save(s)));return true;
 }
 return {route,export:()=>({game:get(),archive:kv.get('monopolyArchive',[])})};
};
