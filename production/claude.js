'use strict';
// 把长驻在 tmux 里的 Claude Code 当成“他”：贴消息进去，用官方 hooks 和 transcript 把回复接出来。
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SESSION = process.env.HOME_TMUX_SESSION || 'ourhome';
const TOOLS = 'Read,WebFetch,WebSearch';
const TURN_TIMEOUT_MS = 6 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cfg = null;            // { dataDir, workspace, hookUrl, secret }
let sessionId = null;
let transcript = null;
let started = false;       // SessionStart hook 到过了
let fresh = true;          // 这个会话还没聊过，需要先交代背景
let restartPending = false;
let turn = null;           // 进行中的回合
let chain = Promise.resolve();
let lastError = '';

class ClaudeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function tmux(args, input) {
  return new Promise((resolve, reject) => {
    if (input === undefined) {
      execFile('tmux', args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
      return;
    }
    const child = spawn('tmux', args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve('') : reject(new Error('tmux exited ' + code))));
    child.stdin.end(input);
  });
}
const hasSession = () => tmux(['has-session', '-t', SESSION]).then(() => true, () => false);
const capture = () => tmux(['capture-pane', '-p', '-t', SESSION]).catch(() => '');
const killSession = () => tmux(['kill-session', '-t', SESSION]).catch(() => {});

function configure(options) {
  cfg = options;
  fs.mkdirSync(path.join(cfg.workspace, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(cfg.dataDir, 'hook.json'), JSON.stringify({ url: cfg.hookUrl, secret: cfg.secret, workspace: cfg.workspace }), { mode: 0o600 });
}

function writeLaunchFiles(systemPrompt, model) {
  const hook = `HOME_DATA="${cfg.dataDir}" "${process.execPath}" "${path.join(__dirname, 'hooks', 'hook.cjs')}"`;
  const entry = (extra = {}) => [{ ...extra, hooks: [{ type: 'command', command: hook, timeout: 10 }] }];
  const settings = {
    hooks: {
      MessageDisplay: entry(),
      Stop: entry(),
      StopFailure: entry(),
      SessionStart: entry(),
      UserPromptSubmit: entry(),
      PreToolUse: entry({ matcher: '*' }),
    },
    permissions: { allow: ['WebFetch', 'WebSearch', `Read(/${cfg.workspace}/**)`], deny: ['Bash', 'Edit', 'Write', 'NotebookEdit'] },
  };
  const settingsPath = path.join(cfg.dataDir, 'cc-settings.json');
  const promptPath = path.join(cfg.dataDir, 'cc-system-prompt.md');
  const launchPath = path.join(cfg.dataDir, 'cc-launch.sh');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  fs.writeFileSync(promptPath, systemPrompt);
  const modelFlag = model && model !== 'default' ? `--model ${model} ` : '';
  fs.writeFileSync(launchPath, [
    '#!/bin/bash',
    `export PATH="${path.dirname(process.execPath)}:$PATH"`,
    `cd "${cfg.workspace}"`,
    `exec claude ${modelFlag}--system-prompt "$(cat "${promptPath}")" --tools "${TOOLS}" --allowedTools "${TOOLS}" --settings "${settingsPath}" --session-id "${sessionId}"`,
    '',
  ].join('\n'), { mode: 0o700 });
  return launchPath;
}

function findTranscript() {
  if (transcript && fs.existsSync(transcript)) return transcript;
  const base = path.join(os.homedir(), '.claude', 'projects');
  try {
    for (const dir of fs.readdirSync(base)) {
      const file = path.join(base, dir, sessionId + '.jsonl');
      if (fs.existsSync(file)) { transcript = file; return file; }
    }
  } catch {}
  return transcript;
}

async function startSession(systemPrompt, model) {
  await killSession();
  sessionId = crypto.randomUUID();
  transcript = null; started = false; fresh = true; restartPending = false;
  const launch = writeLaunchFiles(systemPrompt, model);
  await tmux(['new-session', '-d', '-s', SESSION, '-x', '160', '-y', '50', `bash "${launch}"`]);

  // 等它起好：认掉启动弹窗，认出没登录的情况
  let lastEnter = 0; let pane = '';
  for (let waited = 0; waited < 60000; waited += 500) {
    await sleep(500);
    if (!(await hasSession())) throw new ClaudeError('crashed', 'Claude Code 启动后立刻退出了：' + pane.trim().split('\n').slice(-3).join(' '));
    pane = await capture();
    if (/Select login method|Please run \/login|Not logged in|Invalid API key|claude\.ai\/oauth|Choose the text style/i.test(pane)) {
      await killSession();
      throw new ClaudeError('needs_login', '服务器上的 Claude Code 还没有登录订阅账号');
    }
    // 第一次在这个文件夹启动会问“是否信任”，默认停在“No, exit”上，要先下移到 Yes
    if (/Yes, I trust this folder/i.test(pane) && Date.now() - lastEnter > 2000) {
      if (!/❯\s*Yes, I trust/.test(pane)) await tmux(['send-keys', '-t', SESSION, 'Down']);
      await sleep(200);
      await tmux(['send-keys', '-t', SESSION, 'Enter']); lastEnter = Date.now(); continue;
    }
    if (started && Date.now() - lastEnter > 1500) { await sleep(800); return; }
  }
  fs.writeFileSync(path.join(cfg.dataDir, 'cc-last-pane.txt'), pane);
  await killSession();
  throw new ClaudeError('start_timeout', 'Claude Code 一分钟内没有准备好');
}

async function paste(prompt) {
  const buffer = `${SESSION}-in-${Date.now()}`;
  // 多行内容必须整段贴入（bracketed paste），否则换行会被当成回车
  await tmux(['load-buffer', '-b', buffer, '-'], prompt.replace(/\r\n?/g, '\n'));
  await tmux(['paste-buffer', '-p', '-d', '-b', buffer, '-t', SESSION]);
  await sleep(900);
  await tmux(['send-keys', '-t', SESSION, 'Enter']);
}

// 读本回合 transcript 增量：正文、最近用的工具、是否已收尾
function readTurn(baseline) {
  const file = findTranscript();
  const out = { text: '', tool: null, stop: null, apiError: false, mtime: 0 };
  if (!file || !fs.existsSync(file)) return out;
  const stat = fs.statSync(file);
  out.mtime = stat.mtimeMs;
  if (stat.size <= baseline) return out;
  const length = Math.min(stat.size - baseline, 8 * 1024 * 1024);
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, length, stat.size - length); } finally { fs.closeSync(fd); }
  const parts = []; const seen = new Set();
  for (const line of buf.toString('utf8').split('\n')) {
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.type !== 'assistant' || row.isSidechain || !Array.isArray(row.message?.content)) continue;
    if (row.uuid) { if (seen.has(row.uuid)) continue; seen.add(row.uuid); }
    if (row.isApiErrorMessage) out.apiError = true;
    out.stop = row.message.stop_reason || out.stop;
    for (const block of row.message.content) {
      if (block.type === 'text' && block.text?.trim() && parts[parts.length - 1] !== block.text.trim()) parts.push(block.text.trim());
      if (block.type === 'tool_use') out.tool = block.name;
    }
  }
  out.text = parts.join('\n\n');
  return out;
}

function liveText(t) {
  const messages = [];
  for (const frames of t.frames.values()) {
    let text = '';
    for (let i = 0; i < frames.length && frames[i] !== undefined; i++) text += frames[i];
    if (text.trim()) messages.push(text.trim());
  }
  return messages.join('\n\n');
}

function onHook(event) {
  const name = event.hook_event_name;
  if (event.session_id && sessionId && event.session_id !== sessionId) return;
  if (event.transcript_path) transcript = event.transcript_path;
  if (name === 'SessionStart') { started = true; return; }
  if (!turn) return;
  if (name === 'MessageDisplay' && typeof event.delta === 'string') {
    const id = event.message_id || 'm';
    if (!turn.frames.has(id)) turn.frames.set(id, []);
    turn.frames.get(id)[Number(event.index) || 0] = event.delta;
    turn.push();
  } else if (name === 'PreToolUse') {
    turn.onStatus?.(event.tool_name);
  } else if (name === 'Stop') {
    turn.finish('stop');
  } else if (name === 'StopFailure') {
    turn.finish('failure');
  }
}

async function runTurn(prompt, { onDelta, onStatus }) {
  const baseline = (() => { const f = findTranscript(); try { return f ? fs.statSync(f).size : 0; } catch { return 0; } })();
  let resolveDone; const done = new Promise((r) => { resolveDone = r; });
  let shown = '';
  const t = turn = {
    frames: new Map(), onStatus, reason: null, interrupted: false,
    finish(reason) { if (!t.reason) { t.reason = reason; resolveDone(); } },
    push() {
      const live = liveText(t); const fromFile = readTurn(baseline).text;
      const text = live.length >= fromFile.length ? live : fromFile;
      if (text && text !== shown) { shown = text; onDelta?.(text); }
    },
  };
  try {
    await paste(prompt);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const state = readTurn(baseline);
      if (state.tool) onStatus?.(state.tool);
      t.push();
      // Stop hook 丢了的兜底：transcript 显示已收尾且几秒没再动
      if (state.stop === 'end_turn' && Date.now() - state.mtime > 4000) t.finish('idle');
      if (Date.now() - startedAt > TURN_TIMEOUT_MS) t.finish('timeout');
    }, 700);
    await done;
    clearInterval(timer);

    // 正文以 transcript 为准，它可能比 hook 晚落盘一点
    let final = readTurn(baseline);
    for (let i = 0; i < 8 && !final.text && t.reason === 'stop'; i++) { await sleep(250); final = readTurn(baseline); }
    const text = final.text || liveText(t);
    if (t.reason === 'timeout') { await tmux(['send-keys', '-t', SESSION, 'Escape']).catch(() => {}); if (!text) throw new ClaudeError('timeout', '他太久没有回应'); }
    if ((t.reason === 'failure' || final.apiError) && !t.interrupted) throw new ClaudeError('api_error', text || 'Claude 那边出错了（可能是订阅额度用完了）');
    if (!text && !t.interrupted) throw new ClaudeError('empty', '这次没有收到回复');
    fresh = false;
    return { text, interrupted: t.interrupted };
  } finally { turn = null; }
}

// 一次只跑一个回合。prompt 是函数：新会话时让调用方把背景拼在前面。
function ask({ prompt, systemPrompt, model, onDelta, onStatus }) {
  const job = chain.then(async () => {
    try {
      if (restartPending || !(await hasSession())) await startSession(systemPrompt, model);
      const result = await runTurn(prompt(fresh), { onDelta, onStatus });
      lastError = '';
      return result;
    } catch (e) {
      lastError = e.code || e.message;
      if (e.code === 'api_error' || e.code === 'timeout' || e.code === 'crashed') restartPending = true;
      throw e;
    }
  });
  chain = job.catch(() => {});
  return job;
}

async function interrupt() {
  if (!turn) return false;
  const t = turn; t.interrupted = true;
  // Escape 是“打断本轮”，Ctrl-C 会把进程杀掉
  await tmux(['send-keys', '-t', SESSION, 'Escape']).catch(() => {});
  // 被打断后输入框里可能留着半截内容，下一句干脆开新会话，背景会重新交代
  restartPending = true;
  setTimeout(() => t.finish('interrupted'), 1500);
  return true;
}

module.exports = {
  ClaudeError, configure, ask, interrupt, onHook,
  restartNext() { restartPending = true; },
  busy: () => !!turn,
  status: async () => ({ running: await hasSession(), lastError }),
  shutdown: killSession,
};
