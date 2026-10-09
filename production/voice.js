'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const DEFAULT_VOICE = 'e5WNhrdI30aXpS2RSGm1';
const PREVIEW = '晚上好，今天过得怎么样？慢慢说，我在听。';
module.exports = function ({ db, data, uploads, readBody, json, fail, providerFetch = fetch }) {
  const configFile = path.join(data, 'voice-config.json');
  const defaults = { voiceId: DEFAULT_VOICE, model: 'eleven_multilingual_v2', dailyLimit: 3000, key: '' };
  const config = () => ({ ...defaults, ...(fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {}) });
  if (fs.existsSync(configFile)) fs.chmodSync(configFile, 0o600);
  db.exec(`CREATE TABLE IF NOT EXISTS voice_audio (hash TEXT PRIMARY KEY, message_id INTEGER, file TEXT NOT NULL, chars INTEGER NOT NULL, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS voice_usage (day TEXT PRIMARY KEY, chars INTEGER NOT NULL DEFAULT 0);`);
  const today = () => new Date().toISOString().slice(0, 10);
  const used = () => db.prepare('SELECT chars FROM voice_usage WHERE day = ?').get(today())?.chars || 0;
  const publicConfig = () => { const c = config(); return { voiceId: c.voiceId, model: c.model, dailyLimit: c.dailyLimit, usedToday: used(), hasKey: !!c.key, ready: !!(c.key && c.voiceId), previewText: PREVIEW }; };
  const inflight = new Map();
  function ready(c) { if (!c.key) throw fail(400, '先在设置的“他的声音”里保存 ElevenLabs API Key'); }
  function providerError(status) {
    if (status === 401) return fail(400, 'ElevenLabs 密钥无效，请检查 API Key');
    if (status === 403) return fail(400, 'ElevenLabs 权限不足，请检查密钥的 Text to Speech / Voices 权限和音色可用套餐');
    if (status === 404) return fail(400, '找不到这个音色，请确认 Voice ID，并把音色加入你的声音库');
    if (status === 429 || status === 402) return fail(429, 'ElevenLabs 额度不足或请求过多，请查看账号额度后再试');
    return fail(502, 'ElevenLabs 暂时没能生成语音（' + status + '），请检查音色和账号额度');
  }
  async function request(url, options) {
    try { return await providerFetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(90000) }); }
    catch { throw fail(502, '语音服务连接超时或网络异常，请稍后再试'); }
  }
  async function generate(text, messageId) {
    const c = config();
    const chars = Array.from(text).length;
    if (!chars || chars > 2000) throw fail(400, '每条语音最多 2000 字，这条消息太长了');
    const hash = crypto.createHash('sha256').update(JSON.stringify([c.voiceId, c.model, text])).digest('hex');
    const cached = db.prepare('SELECT file FROM voice_audio WHERE hash = ?').get(hash);
    if (cached && fs.existsSync(path.join(uploads, cached.file))) return { file: cached.file, cached: true, voice: publicConfig() };
    if (inflight.has(hash)) return inflight.get(hash);
    ready(c);
    if (inflight.size >= 2) throw fail(429, '正在准备其他语音，请等一会儿');
    if (used() + chars > c.dailyLimit) throw fail(429, '今天的语音字数已到你设置的上限，已有音频仍能重复播放');
    // 在外部请求前预留字数。超时可能已经被服务商计费，因此失败也保留预留记录。
    db.prepare('INSERT INTO voice_usage(day, chars) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET chars = chars + excluded.chars').run(today(), chars);
    const pending = (async () => {
      const res = await request('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(c.voiceId) + '?output_format=mp3_44100_128', {
        method: 'POST', headers: { 'xi-api-key': c.key, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: c.model }),
      });
      if (!res.ok) { await res.body?.cancel(); throw providerError(res.status); }
      if (!/^audio\//i.test(res.headers.get('content-type') || '')) { await res.body?.cancel(); throw fail(502, '语音服务返回了无效音频'); }
      const reader = res.body.getReader(); const chunks = []; let size = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 15 * 1024 * 1024) { await reader.cancel(); throw fail(502, '语音文件过大，请换一条短消息'); } chunks.push(Buffer.from(value)); }
      if (!size) throw fail(502, '语音服务返回了空音频');
      const file = 'voice-' + crypto.randomBytes(16).toString('hex') + '.mp3';
      fs.writeFileSync(path.join(uploads, file), Buffer.concat(chunks), { mode: 0o600 });
      db.prepare('INSERT INTO voice_audio(hash, message_id, file, chars, ts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(hash) DO UPDATE SET file = excluded.file, ts = excluded.ts').run(hash, messageId, file, chars, Date.now());
      return { file, cached: false, voice: publicConfig() };
    })();
    inflight.set(hash, pending);
    try { return await pending; } finally { inflight.delete(hash); }
  }
  async function route(req, res, url) {
    const p = url.pathname, key = req.method + ' ' + p;
    if (key === 'GET /api/voice') { json(res, 200, { voice: publicConfig() }); return true; }
    if (key === 'PUT /api/voice') {
      const body = await readBody(req), c = config();
      if (body.voiceId !== undefined) { if (typeof body.voiceId !== 'string' || !/^[a-zA-Z0-9_-]{10,80}$/.test(body.voiceId.trim())) throw fail(400, 'Voice ID 格式不对'); c.voiceId = body.voiceId.trim(); }
      if (body.model !== undefined) { if (!['eleven_multilingual_v2', 'eleven_flash_v2_5'].includes(body.model)) throw fail(400, '请选择支持的语音模型'); c.model = body.model; }
      if (body.dailyLimit !== undefined) { if (!Number.isInteger(body.dailyLimit) || body.dailyLimit < 100 || body.dailyLimit > 20000) throw fail(400, '每日上限请填 100 到 20000 之间的整数'); c.dailyLimit = body.dailyLimit; }
      if (body.key !== undefined) { if (typeof body.key !== 'string' || body.key.length > 500 || /[\r\n]/.test(body.key)) throw fail(400, 'API Key 格式不对'); if (body.key.trim()) c.key = body.key.trim(); }
      if (body.clearKey === true) c.key = '';
      const tmp = configFile + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(c), { mode: 0o600 }); fs.renameSync(tmp, configFile);
      json(res, 200, { voice: publicConfig() }); return true;
    }
    if (key === 'POST /api/voice/test') {
      const c = config(); ready(c);
      const result = await request('https://api.elevenlabs.io/v1/voices/' + encodeURIComponent(c.voiceId), { headers: { 'xi-api-key': c.key } });
      if (!result.ok) { await result.body?.cancel(); throw providerError(result.status); }
      const info = await result.json().catch(() => ({}));
      json(res, 200, { ok: true, name: String(info.name || '已选音色').slice(0, 120), voice: publicConfig() }); return true;
    }
    if (key === 'POST /api/voice/preview') { json(res, 200, await generate(PREVIEW, null)); return true; }
    const match = /^\/api\/voice\/messages\/(\d+)$/.exec(p);
    if (req.method === 'POST' && match) {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(match[1]));
      if (!m || m.role !== 'him' || m.type === 'sticker' || !m.text.trim()) throw fail(400, '这条消息没有可以朗读的回复');
      json(res, 200, await generate(m.text.trim(), m.id)); return true;
    }
    return false;
  }
  return { route, publicConfig };
};
