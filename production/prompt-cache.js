'use strict';
function prepare(messages,config,runtime,{proactive=false}={}) {
  const result=messages.map(m=>{const {_runtimeContext,...clean}=m;return clean;});
  const enabled=config.cacheEnabled!==false&&/claude/i.test(config.model)&&!proactive;
  if(result[0]?.role!=='system')result.unshift({role:'system',content:''});
  const stable=result[0].content,tail=(messages[0]?._runtimeContext||'')+runtime;
  if(enabled&&typeof stable==='string'&&stable.trim())result[0].content=[{type:'text',text:stable,cache_control:{type:'ephemeral'}},{type:'text',text:tail}];
  else result[0].content=typeof stable==='string'?stable+tail:stable;
  return result;
}
function usage(data) {
  const u=data?.usage;if(!u)return {reported:false};
  const details=u.prompt_tokens_details||u.input_tokens_details||{};
  const read=u.cache_read_input_tokens??u.prompt_cache_hit_tokens??details.cached_tokens;
  const write=u.cache_creation_input_tokens??details.cache_write_tokens;
  const n=x=>Number.isFinite(x)&&x>=0?x:null;
  const input=n(u.prompt_tokens)??(n(u.input_tokens)!==null?u.input_tokens+(n(read)||0)+(n(write)||0):null);
  return {reported:read!==undefined||write!==undefined,inputTokens:input,outputTokens:n(u.completion_tokens??u.output_tokens),readTokens:n(read),writeTokens:n(write),readPercent:input&&n(read)!==null?Math.min(100,read/input*100):null,ts:Date.now()};
}
module.exports={prepare,usage};
