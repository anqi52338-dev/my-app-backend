'use strict';
const DEFAULT={timezone:'Asia/Shanghai',weatherEnabled:true,location:{name:'乐陵 · 山东',latitude:37.73,longitude:117.22},enabled:false,allDay:true,start:9,end:22,dailyLimit:10,idleMinutes:60,gapMinutes:120,enabledAt:0};
const weatherNames={0:'晴',1:'大部晴朗',2:'局部多云',3:'阴',45:'雾',48:'冻雾',51:'小毛毛雨',53:'毛毛雨',55:'较强毛毛雨',56:'冻毛毛雨',57:'冻毛毛雨',61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'强冻雨',71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'小阵雨',81:'阵雨',82:'强阵雨',85:'阵雪',86:'强阵雪',95:'雷雨',96:'雷雨伴冰雹',99:'强雷雨伴冰雹'};
module.exports=function({kv,db,readBody,json,fail,send,isBusy,isBlocked,acquire,release,fetcher=fetch,now=Date.now}) {
  const prefs=()=>({...DEFAULT,...kv.get('presencePrefs',{})});
  const parts=(ts=now(),tz=prefs().timezone)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ts).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const day=ts=>{const p=parts(ts);return `${p.year}-${p.month}-${p.day}`;};
  const stamp=ts=>new Intl.DateTimeFormat('zh-CN',{timeZone:prefs().timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'long',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'}).format(ts);
  let pendingWeather=null,lastWeatherFailure=0;
  const locationKey=p=>`${p.location.latitude},${p.location.longitude}`;
  async function request(url) {
    const res=await fetcher(url,{signal:AbortSignal.timeout(8000),redirect:'error'});
    if(!res.ok)throw new Error('天气服务暂时不可用');return res.json();
  }
  async function weather(force=false) {
    const p=prefs();if(!p.weatherEnabled)return null;
    const key=locationKey(p),cache=kv.get('weatherCache',null);
    if(cache?.key===key&&now()-cache.fetchedAt<30*60000)return cache;
    if(!force&&now()-lastWeatherFailure<5*60000)return null;
    if(pendingWeather)return pendingWeather.key===key?pendingWeather.promise:null;
    const promise=(async()=>{
      try {
        const u=new URL('https://api.open-meteo.com/v1/forecast');
        for(const [k,v]of Object.entries({latitude:p.location.latitude,longitude:p.location.longitude,current:'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',daily:'temperature_2m_max,temperature_2m_min,precipitation_probability_max',timezone:'auto',forecast_days:1}))u.searchParams.set(k,v);
        const data=await request(u),c=data.current,d=data.daily;
        if(!c||!Number.isFinite(c.temperature_2m)||!Number.isFinite(c.weather_code)||!c.time)throw new Error('天气数据不完整');
        const result={key,location:p.location.name,time:c.time,timezone:data.timezone||p.timezone,fetchedAt:now(),temperature:c.temperature_2m,feelsLike:c.apparent_temperature,humidity:c.relative_humidity_2m,wind:c.wind_speed_10m,condition:weatherNames[c.weather_code]||'天气状况未知',high:d?.temperature_2m_max?.[0],low:d?.temperature_2m_min?.[0],rainChance:d?.precipitation_probability_max?.[0]};
        if(locationKey(prefs())===key)kv.set('weatherCache',result);
        lastWeatherFailure=0;return result;
      }catch{lastWeatherFailure=now();return null;}
      finally{pendingWeather=null;}
    })();
    pendingWeather={key,promise};return promise;
  }
  async function context() {
    const p=prefs(),w=await weather();
    return `\n【当前时间与当地天气｜应用提供的数据】\n现在是 ${stamp(now())}，时区 ${p.timezone}。历史消息的日期不是今天，不要把旧时间当现在。\n`+(w?`她所在地区：${w.location}。天气数据时间 ${w.time}（${w.timezone}），获取于 ${stamp(w.fetchedAt)}：${w.condition}，气温 ${w.temperature}℃，体感 ${w.feelsLike??'未知'}℃，今日 ${w.low??'未知'}～${w.high??'未知'}℃，今日最高降雨概率 ${w.rainChance??'未知'}%。天气为地区气象数据，不代表她正在室外。\n`:(p.weatherEnabled?'当地天气暂时获取失败，不要猜测温度、晴雨或谎称已查询。\n':'天气功能未开启，不要声称知道她当地天气。\n'))+'自然地根据需要使用时间和天气，不必每句报时或播天气。\n';
  }
  const latestUser=()=>Number(db.prepare("SELECT MAX(ts) t FROM messages WHERE role='me' AND archived=0").get().t||0);
  const stats=()=>kv.get('proactiveState',{});
  const publicState=()=>{const p=prefs(),s=stats(),w=kv.get('weatherCache',null);return {prefs:p,now:now(),localTime:stamp(now()),weather:p.weatherEnabled&&w?.key===locationKey(p)&&now()-w.fetchedAt<90*60000?w:null,attemptsToday:s.day===day(now())?s.attempts||0:0,sentToday:s.day===day(now())?s.sent||0:0,lastSent:s.lastSent||0,lastError:s.lastError||'',lastAttempt:s.lastAttempt||0};};
  function validate(body) {
    const old=prefs(),p={...old};
    for(const key of ['weatherEnabled','enabled','allDay'])if(body[key]!==undefined){if(typeof body[key]!=='boolean')throw fail(400,'开关值不正确');p[key]=body[key];}
    if(body.timezone!==undefined){try{new Intl.DateTimeFormat('en',{timeZone:body.timezone}).format();}catch{throw fail(400,'时区不正确');}if(typeof body.timezone!=='string'||body.timezone.length>80)throw fail(400,'时区不正确');p.timezone=body.timezone;}
    for(const [key,min,max]of [['dailyLimit',1,10],['idleMinutes',15,1440],['gapMinutes',30,1440],['start',0,23],['end',1,24]])if(body[key]!==undefined){if(!Number.isInteger(body[key])||body[key]<min||body[key]>max)throw fail(400,'主动消息次数或间隔超出范围');p[key]=body[key];}
    if(!p.allDay&&p.start===p.end)throw fail(400,'开始与结束时段不能相同');
    if(body.location!==undefined){const l=body.location;if(!l||typeof l.name!=='string'||!l.name.trim()||l.name.length>80||!Number.isFinite(l.latitude)||Math.abs(l.latitude)>90||!Number.isFinite(l.longitude)||Math.abs(l.longitude)>180)throw fail(400,'定位或城市坐标不正确');p.location={name:l.name.trim().replace(/[\r\n]/g,' '),latitude:Math.round(l.latitude*100)/100,longitude:Math.round(l.longitude*100)/100};}
    if(p.enabled&&!old.enabled)p.enabledAt=now();
    return p;
  }
  async function route(req,res,url) {
    if(url.pathname==='/api/presence'&&req.method==='GET'){json(res,200,publicState());return true;}
    if(url.pathname==='/api/presence'&&req.method==='PUT') {const p=validate(await readBody(req));kv.set('presencePrefs',p);json(res,200,publicState());return true;}
    if(url.pathname==='/api/presence/weather'&&req.method==='POST'){await weather(true);json(res,200,publicState());return true;}
    if(url.pathname==='/api/presence/cities'&&req.method==='GET') {
      const name=(url.searchParams.get('name')||'').trim();if(name.length<2||name.length>60)throw fail(400,'请输入 2 到 60 字的城市名');
      const u=new URL('https://geocoding-api.open-meteo.com/v1/search');u.searchParams.set('name',name);u.searchParams.set('count','8');u.searchParams.set('language','zh');u.searchParams.set('format','json');
      try{const data=await request(u);json(res,200,{cities:(data.results||[]).map(c=>({name:[c.name,c.admin1,c.country].filter(Boolean).join(' · '),latitude:c.latitude,longitude:c.longitude,timezone:c.timezone}))});}catch{throw fail(502,'城市查询失败，请稍后重试，或使用手机定位');}return true;
    }
    return false;
  }
  let running=false;
  async function tick() {
    if(running||isBusy()||isBlocked())return false;
    const p=prefs(),ts=now(),s=stats(),today=day(ts),user=latestUser();
    if(!p.enabled||!user||ts-Math.max(user,p.enabledAt)<p.idleMinutes*60000)return false;
    const hour=Number(parts(ts).hour),inWindow=p.start<p.end?(hour>=p.start&&hour<p.end):(hour>=p.start||hour<p.end);
    if(!p.allDay&&!inWindow)return false;
    if(s.lastAttempt&&ts-s.lastAttempt<p.gapMinutes*60000)return false;
    if((s.day===today?s.attempts||0:0)>=p.dailyLimit)return false;
    if(!acquire())return false;
    running=true;
    const next={...s,day:today,attempts:(s.day===today?s.attempts||0:0)+1,sent:s.day===today?s.sent||0:0,lastAttempt:ts,lastError:''};
    // Reserve before any network operation. Failed or interrupted attempts also count.
    kv.set('proactiveState',next);
    try {
      const sent=await send('【主动消息任务】这不是她新发来的消息。结合当前时间、当地天气和最近真实聊天，主动发一两条自然简短的问候或分享。不要虚构她的行程、位置、已读状态或你在现实做过的事；不要催她回复、制造紧急感或连续追问。没有合适内容时返回 {"text":"","sticker_id":null}。无需每次发表情。');
      if(sent){next.sent++;next.lastSent=now();}kv.set('proactiveState',next);return !!sent;
    }catch{next.lastError='生成失败，请检查当前线路；本次尝试已计入当天上限。';kv.set('proactiveState',next);return false;}
    finally{running=false;release();}
  }
  function start(){const timer=setInterval(()=>tick().catch(()=>{}),60000);timer.unref();return timer;}
  return {prefs,weather,context,stamp,publicState,route,tick,start};
};
