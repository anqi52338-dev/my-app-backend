#!/usr/bin/env node
'use strict';
// Claude Code 的 hook 入口。纪律：运输类事件永远不挡消息（出错也安静退出）；
// 只有 PreToolUse 会拦——不在白名单里的工具一律拒绝，免得终端里弹出没人能点的确认框。
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'hook.json'), 'utf8')); } catch {}
if (process.env.HOME_DATA) { try { config = JSON.parse(fs.readFileSync(path.join(process.env.HOME_DATA, 'hook.json'), 'utf8')); } catch {} }

function post(payload) {
  return new Promise((resolve) => {
    if (!config.url) return resolve();
    const body = JSON.stringify(payload);
    const req = http.request(config.url, { method: 'POST', agent: false, timeout: 3000, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-hook-secret': config.secret || '' } }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.end(body);
  });
}

function decide(input) {
  const tool = input.tool_name;
  const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
  const allow = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: '聊天小手机允许的工具' } };
  if (tool === 'WebFetch' || tool === 'WebSearch') return allow;
  if (tool === 'Read') {
    const file = path.resolve(String(input.tool_input?.file_path || ''));
    const root = path.resolve(config.workspace || '/nonexistent') + path.sep;
    return file.startsWith(root) ? allow : deny('只能查看她发来的图片。');
  }
  return deny('这个聊天里不能使用该工具，请直接用文字回复。');
}

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', async () => {
  let input = {};
  try { input = JSON.parse(raw); } catch {}
  const event = input.hook_event_name;
  try {
    if (event === 'PreToolUse') {
      process.stdout.write(JSON.stringify(decide(input)));
      await post({ hook_event_name: event, session_id: input.session_id, tool_name: input.tool_name });
    } else if (event === 'UserPromptSubmit') {
      // stdout 会被注入成本轮上下文：只写当前时间
      const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
      process.stdout.write(`[现在是北京时间 ${now}]`);
    } else if (event === 'MessageDisplay') {
      await post({ hook_event_name: event, session_id: input.session_id, message_id: input.message_id, index: input.index, delta: input.delta, final: input.final });
    } else {
      await post({ hook_event_name: event, session_id: input.session_id, transcript_path: input.transcript_path, source: input.source });
    }
  } catch {}
});
