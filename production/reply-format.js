'use strict';
function cleanTimestamps(value) {
  const isLabel=s=>/\d{4}(?:年|[-/])\d{1,2}(?:月|[-/])\d{1,2}/.test(s)&&/\d{1,2}[:：]\d{2}/.test(s)&&!s.replace(/\d{4}(?:年|[-/])\d{1,2}(?:月|[-/])\d{1,2}日?/g,'').replace(/\d{1,2}[:：]\d{2}(?:[:：]\d{2})?/g,'').replace(/(?:星期|周)[一二三四五六日天]/g,'').replace(/(?:GMT|UTC)\s*[+-]?\d{0,2}(?::\d{2})?/gi,'').replace(/[\sT:：,，·|｜+\-]/g,'');
  return String(value||'').replace(/(^|\n)[ \t]*(?:\[([^\]\n]{8,90})\]|【([^】\n]{8,90})】|（([^）\n]{8,90})）)[ \t]*(?:[|｜·][ \t]*)?/g,(all,start,a,b,c)=>isLabel(a||b||c)?start:all)
    .replace(/(^|\n)[ \t]*(\d{4}年\d{1,2}月\d{1,2}日(?:星期[一二三四五六日天])?\s+(?:GMT|UTC)[+-]\d{1,2}(?::\d{2})?\s+\d{1,2}:\d{2}(?::\d{2})?)[ \t]*(?:\n|$)/g,'$1').trim();
}
function normalizeJson(source) {
  let out='',quoted=false,escaped=false;
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(quoted) {
      if(escaped){out+=c;escaped=false;continue;}
      if(c==='\\'){out+=c;escaped=true;continue;}
      if(c==='"'){quoted=false;out+=c;continue;}
      if(c.charCodeAt(0)<32){out+=JSON.stringify(c).slice(1,-1);continue;}
    }else {
      if(c==='"')quoted=true;
      if(c===','){let j=i+1;while(/\s/.test(source[j]||'')&&j<source.length)j++;if('}]'.includes(source[j]||'X'))continue;}
    }
    out+=c;
  }
  return out;
}
function textValue(value) {
  if(typeof value==='string')return value;
  if(Array.isArray(value)&&value.every(x=>typeof x==='string'||x&&typeof x.text==='string'&&(!x.type||x.type==='text')))return value.map(x=>typeof x==='string'?x:x.text).join('\n\n');
  return null;
}
function parseProtocol(fragment) {
  try{return {value:JSON.parse(fragment),repaired:false};}catch{}
  try{return {value:JSON.parse(normalizeJson(fragment)),repaired:true};}catch{}
  // Recover only a fully closed text string. Never invent a truncated sentence,
  // execute code, or recover side effects from an incomplete object.
  const m=/"text"\s*:\s*"/.exec(fragment);
  if(m) {
    const start=m.index+m[0].length-1;let escaped=false;
    for(let i=start+1;i<fragment.length;i++) {
      if(escaped){escaped=false;continue;}
      if(fragment[i]==='\\'){escaped=true;continue;}
      if(fragment[i]==='"') {
        if(!/^\s*(?:[,}]|$)/.test(fragment.slice(i+1)))break;
        try {const text=JSON.parse(normalizeJson(fragment.slice(start,i+1)));return {value:{text},repaired:true};}catch{break;}
      }
    }
  }
  return {value:null,repaired:false};
}
module.exports={cleanTimestamps,parseProtocol,textValue};
