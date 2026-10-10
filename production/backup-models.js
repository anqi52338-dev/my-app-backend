'use strict';
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');

const blocked4 = new net.BlockList(), blocked6 = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked4.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::',96],['::ffff:0:0',96],['64:ff9b::',96],['100::',64],['2001::',23],['2002::',16],['fc00::',7],['fe80::',10],['ff00::',8]]) blocked6.addSubnet(address, prefix, 'ipv6');
function publicAddress(address) {
  const family = net.isIP(address);
  return family === 4 ? !blocked4.check(address, 'ipv4') : family === 6 && !blocked6.check(address, 'ipv6');
}
function normalizeBase(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('请填写完整的 HTTPS API 地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('API 地址需要使用 HTTPS，且不能带账号、查询参数或片段');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href.replace(/\/+$/, '');
}
function parseModels(body) {
  const items = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : null;
  if (!items) throw new Error('这个接口没有返回兼容的模型列表，可以手动填写模型名称');
  const models = new Map();
  for (const item of items.slice(0, 10000)) {
    const id = typeof item === 'string' ? item : item?.id;
    if (typeof id !== 'string' || !id.trim() || id.length > 300 || /[\x00-\x1f\x7f]/.test(id)) continue;
    const name = typeof item?.name === 'string' ? item.name.slice(0, 160) : id;
    models.set(id, { id, name });
    if (models.size >= 3000) break;
  }
  if (!models.size) throw new Error('没有可选择的模型，请确认密钥权限，或手动填写模型名称');
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}
async function fetchModels(baseUrl, key) {
  const url = new URL(normalizeBase(baseUrl) + '/models');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await Promise.race([
    dns.lookup(hostname, { all: true }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('解析地址超时，请重试')), 10000); timer.unref(); }),
  ]);
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('获取模型仅支持公网 API 地址');
  // Pin the checked address; never follow redirects or forward credentials to another host.
  const picked = addresses[0];
  const body = await new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET', headers: { accept: 'application/json', authorization: 'Bearer ' + key },
      lookup: (_host, options, callback) => options.all ? callback(null, [picked]) : callback(null, picked.address, picked.family),
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        const message = response.statusCode === 401 || response.statusCode === 403 ? '密钥无效或没有获取模型的权限' : response.statusCode === 404 ? '接口不提供模型列表，请检查 API 地址或手动填写模型名称' : response.statusCode === 429 ? '请求太频繁，请稍后再试' : '获取模型失败，接口返回 ' + response.statusCode;
        reject(new Error(message)); return;
      }
      let size = 0; const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) request.destroy(new Error('模型列表过大，请手动填写模型名称')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('接口返回的内容不是模型列表，请检查 API 地址')); } });
    });
    const timer = setTimeout(() => request.destroy(new Error('获取模型超时，请稍后重试')), 15000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', error => reject(new Error(/超时|过大/.test(error.message) ? error.message : '无法连接模型接口，请检查 API 地址后重试')));
    request.end();
  });
  return parseModels(body);
}
module.exports = { normalizeBase, parseModels, publicAddress, fetchModels };
