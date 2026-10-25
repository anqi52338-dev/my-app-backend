'use strict';
module.exports=function({kv,readBody,json,fail,isBusy,complete,models}) {
  const config=(slot='backup')=>{
    const b=kv.get(slot,{});
    return {baseUrl:'',key:'',model:'',memory:true,...b,maxTokens:Number.isInteger(b.maxTokens)&&b.maxTokens>=256&&b.maxTokens<=4000?b.maxTokens:2048};
  };
  const active=()=>kv.get('chatRoute',config().chat?'backup':'subscription');
  const selected=()=>config(active()==='backup2'?'backup2':'backup');
  const ready=b=>!!(b.baseUrl&&b.key&&b.model);
  const publicConfig=slot=>{const {key,...b}=config(slot);return {...b,chat:active()===slot,hasKey:!!key};};
  async function route(req,res,url) {
    const p=url.pathname;
    if(p==='/api/chat-route'&&req.method==='PUT') {
      const b=await readBody(req);
      if(!['subscription','backup','backup2'].includes(b.route))throw fail(400,'请选择一条聊天线路');
      if(isBusy())throw fail(409,'等当前回复或记忆整理结束后再切换线路');
      if(b.route!=='subscription'&&!ready(config(b.route)))throw fail(400,'先保存这条线路的地址、Key 和模型');
      kv.set('chatRoute',b.route);json(res,200,{route:active()});return true;
    }
    const m=/^\/api\/(backup2?)(?:\/(models|test))?$/.exec(p);if(!m)return false;
    const slot=m[1],action=m[2];
    if(req.method==='PUT'&&!action) {
      const body=await readBody(req),old=config(slot),next={...old};
      if(body.key!==undefined&&typeof body.key!=='string')throw fail(400,'Key 请填写文字');
      for(const k of ['baseUrl','model'])if(typeof body[k]==='string')next[k]=body[k].trim().slice(0,300);
      if(next.baseUrl&& !/^https?:\/\//i.test(next.baseUrl))throw fail(400,'请填写完整的 API 地址');
      if(next.baseUrl.replace(/\/+$/,'')!==old.baseUrl.replace(/\/+$/,'')&&old.key&&!body.key?.trim()&&!body.clearKey)throw fail(400,'更换 API 地址时请填写新地址对应的 Key');
      if(typeof body.key==='string'&&body.key.trim())next.key=body.key.trim().slice(0,300);
      if(body.clearKey)next.key='';
      if(body.maxTokens!==undefined) {
        if(!Number.isInteger(body.maxTokens)||body.maxTokens<256||body.maxTokens>4000)throw fail(400,'最大输出长度需要是 256 到 4000 之间的整数');
        next.maxTokens=body.maxTokens;
      }
      if(typeof body.memory==='boolean')next.memory=body.memory;
      // Preserve the old endpoint contract without letting saving line 2 switch line 1.
      if(typeof body.chat==='boolean') {
        if(isBusy())throw fail(409,'等当前回复结束后再切换线路');
        if(body.chat&&!ready(next))throw fail(400,'先把地址、Key 和模型填完整');
      }
      kv.set(slot,next);
      if(body.chat===true)kv.set('chatRoute',slot);
      else if(body.chat===false&&active()===slot)kv.set('chatRoute','subscription');
      json(res,200,{ok:true,config:publicConfig(slot)});return true;
    }
    if(req.method==='POST'&&action==='models') {
      const body=await readBody(req),saved=config(slot);let baseUrl;
      try{baseUrl=models.normalizeBase(body.baseUrl||saved.baseUrl);}catch(e){throw fail(400,e.message);}
      let same=false;try{same=baseUrl===models.normalizeBase(saved.baseUrl);}catch{}
      const key=typeof body.key==='string'&&body.key.trim()?body.key.trim():(same?saved.key:'');
      if(!key)throw fail(400,'请填写这个地址对应的 Key；已保存的 Key 仅用于原地址');
      if(key.length>300||/[\x00-\x1f\x7f]/.test(key))throw fail(400,'Key 格式不正确');
      try{json(res,200,{models:await models.fetchModels(baseUrl,key)});}catch(e){throw fail(502,e.message);}return true;
    }
    if(req.method==='POST'&&action==='test') {
      const b=config(slot);if(!ready(b))throw fail(400,'先把地址、Key 和模型填完整并保存');
      try{const text=await complete([{role:'user',content:'回复“好”这一个字。'}],b);json(res,200,{ok:true,text:text.slice(0,40)});}catch(e){throw fail(502,e.message);}return true;
    }
    return false;
  }
  return {config,active,selected,ready,publicConfig,route};
};
