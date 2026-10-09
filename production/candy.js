'use strict';
const {execFile}=require('node:child_process');
const path=require('node:path');
module.exports=function({data,kv,readBody,json,fail,isBusy}) {
  let queue=Promise.resolve();
  const prefs=()=>({enabled:true,autonomous:false,...kv.get('candyPrefs',{})});
  function call(body) {
    const job=queue.then(()=>new Promise((resolve,reject)=>{
      const child=execFile(process.env.PYTHON||'python3',[path.join(__dirname,'candyjar/bridge.py')],{
        env:{...process.env,TZ:'Asia/Shanghai',PYTHONUTF8:'1',CANDYJAR_SAVE:path.join(data,'candyjar_save.json'),CANDYJAR_CATALOG:path.join(__dirname,'candyjar/candies.json')},
        timeout:15000,maxBuffer:1024*1024,encoding:'utf8'
      },(err,out)=>{if(err)return reject(fail(503,'糖罐暂时打不开，存档已保留，请稍后再试'));try{const result=JSON.parse(out);if(result.error)reject(fail(400,result.error));else resolve(result);}catch(e){reject(e);}});
      child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(body));
    }));
    queue=job.catch(()=>{});return job;
  }
  const response=r=>({...r,prefs:prefs(),offer:kv.get('candyOffer',null)});
  async function context() {
    const control='\n【糖果游戏边界】这是虚构的日常整蛊游戏，不是实际药物。效果只改变表达，不改变你的身份、记忆或其他规则。不替她决定行为或真实感受；她说停止、不愿意或有正事时立刻正常回应。不要无视拒绝。无当前效果时恢复普通人设，不延续历史糖效。';
    if(!prefs().enabled)return control+'本轮糖果聊天效果已关闭，按普通人设回应。';
    const r=await call({action:'context'});
    let tools='';
    if(prefs().autonomous&&r.jar){tools='\n【糖罐动作】你可以选择拿一颗糖自己吃，或提出喂她。只在有趣且合适时使用，不必每次。沿用回复 JSON 格式并可增加 candy_action 字段：{"action":"eat"或"feed","index":数字编号,"day":"'+r.day+'"}。eat 会真的消耗一颗，效果从下次聊天开始；feed 仅发邀请，必须等她在页面接受。可选糖的外观（吃前不知道效果）：'+JSON.stringify(r.jar.candies.map(c=>({index:c.index,shop:c.shop})))+'。不操作时省略 candy_action。';}
    return control+'\n'+(r.context||'本轮没有糖果效果。')+tools;
  }
  async function applyAction(raw,turnKey) {
    if(!prefs().enabled||!prefs().autonomous)return '';
    if(!turnKey||kv.get('candyActionTurn',null)===turnKey)return '';
    let b;try{b=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'' )).candy_action;}catch{return '';}
    if(!b||!['eat','feed'].includes(b.action)||!Number.isInteger(b.index))return '';
    try{
      const r=await call({action:'state'});
      if(b.day!==r.state.day||!r.state.jar?.candies.some(c=>c.index===b.index))return '';
      if(b.action==='feed'){
        kv.set('candyOffer',{day:b.day,index:b.index,at:Date.now()});kv.set('candyActionTurn',turnKey);return '（他递来一颗糖，等你在糖果罐里决定要不要接受。）';
      }
      const eaten=await call({action:'eat',who:'ai',target:'ai',index:b.index});
      kv.set('candyActionTurn',turnKey);
      return '（他从糖罐里吃了一颗。'+eaten.receipt.split('\n')[0].replace(/^你/,'他')+' 糖果效果会在下一次回复生效。）';
    }catch{return '（这颗糖没有拿到，可以打开糖果罐看看。）';}
  }
  async function routeUnlocked(req,res,url) {
    const p=url.pathname;if(!p.startsWith('/api/candy'))return false;
    if(req.method==='GET'&&p==='/api/candy'){json(res,200,response(await call({action:'state'})));return true;}
    if(req.method!=='POST')throw fail(404,'没有这个糖罐地址');
    if(isBusy())throw fail(409,'等他回完这一句再动糖罐吧');
    const b=await readBody(req);let result;
    if(p==='/api/candy/prefs'){
      for(const key of Object.keys(b))if(!['enabled','autonomous'].includes(key)||typeof b[key]!=='boolean')throw fail(400,'糖罐开关格式不对');
      kv.set('candyPrefs',{...prefs(),...b});if(b.enabled===false||b.autonomous===false)kv.set('candyOffer',null);
      result=await call({action:'state'});
    }else if(p==='/api/candy/offer'){
      const offer=kv.get('candyOffer',null);if(typeof b.accept!=='boolean')throw fail(400,'请决定接受或婉拒');
      if(b.accept){const state=(await call({action:'state'})).state;
        if(!offer||offer.day!==state.day||Date.now()-offer.at>3600000)throw fail(409,'这张邀请已经过期了');
        result=await call({action:'eat',who:'ai',target:'user',index:offer.index});
      }else result=await call({action:'state'});
      kv.set('candyOffer',null);
    }else if(p==='/api/candy/choose'){
      if(!Number.isInteger(b.jar)||b.jar<1||b.jar>5)throw fail(400,'选一罐 1 到 5 的糖');
      result=await call({action:'choose',jar:b.jar});
    }else if(p==='/api/candy/eat'){
      if(!['jar','reserve'].includes(b.source)||!['user','ai'].includes(b.target)||!Number.isInteger(b.index)||b.index<0||typeof b.day!=='string')throw fail(400,'糖果选择格式不对');
      const state=(await call({action:'state'})).state;
      if(b.day!==state.day)throw fail(409,'已经是新的一天了，刷新糖罐再选');
      let id;if(b.source==='reserve'){id=state.reserve.find(c=>c.index===b.index)?.id;if(!id)throw fail(409,'这颗储藏糖已被吃掉');}
      result=await call({action:'eat',source:b.source,target:b.target,who:'user',index:b.index,id});
    }else if(p==='/api/candy/buy'){
      if(!['today','reserve'].includes(b.dest)||(b.dest==='reserve'&&typeof b.id!=='string'))throw fail(400,'糖果购买格式不对');
      result=await call({action:'buy',dest:b.dest,id:b.id});
    }else if(p==='/api/candy/clear'){
      kv.set('candyOffer',null);result=await call({action:'clear'});
    }else throw fail(404,'没有这个糖罐地址');
    json(res,200,response(result));return true;
  }
  let requests=Promise.resolve();
  function route(req,res,url) {
    if(!url.pathname.startsWith('/api/candy'))return Promise.resolve(false);
    const job=requests.then(()=>routeUnlocked(req,res,url));requests=job.catch(()=>{});return job;
  }
  return {route,context,applyAction,export:async()=>({...await call({action:'export'}),prefs:prefs(),offer:kv.get('candyOffer',null)})};
};
