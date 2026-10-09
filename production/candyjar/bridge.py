#!/usr/bin/env python3
"""Private Our Home adapter. All calls are serialized by candy.js."""
import os
os.umask(0o077)
import json
import sys
from datetime import datetime
from pathlib import Path
import candyjar as game

# Do not silently reset a corrupt save (upstream _load otherwise does).
save = game._save_path()
if save.exists():
    json.loads(save.read_text(encoding='utf-8'))

def state():
    view = game.view()
    raw = game._load()
    cat = game._catalog()
    def card(cid, index=None):
        c = game._find(cid)
        item = {k: c[k] for k in ('id', 'scheme', 'shape', 'shop')}
        item['index'] = index
        if raw['dex'].get(cid):
            item.update({k: c[k] for k in ('name', 'taste', 'reveal', 'lore')})
            item['count'] = raw['dex'][cid]
        return item
    active = []
    for a in raw['active']:
        c = game._find(a['candy_id'])
        active.append({'target': a['target'], 'name': c['name'], 'reveal': c['reveal'],
                       'expires': a['expires'] + '+08:00'})
    jar = view['jar']
    return {'day': game._today(), 'serverTime': datetime.now().isoformat() + '+08:00',
            'jar': None if not jar else {'number': jar['jar'], 'name': jar['name'],
                'candies': [card(x['id'], x['i']) for x in jar['candies']]},
            'jars': [{'number': int(n), 'name': j['name'], 'category': j['cat'], 'line': j['line']}
                     for n,j in cat['_meta']['jars'].items() if n.isdigit()],
            'dex': [card(c['id']) for c in cat['candies'] if raw['dex'].get(c['id'])],
            'total': len(cat['candies']), 'reserve': [card(cid, i) for i,cid in enumerate(view['reserve'])],
            'courage': view['courage'], 'mysteryPrice': view['mystery_price'], 'active': active,
            'onceUsed': view['once_used'], 'ledger': [{**e, 'name': game._find(e['candy'])['name']}
                for e in raw['log'][-80:] if e.get('candy')]}

def main(b):
    action = b['action']
    if action == 'state':
        return {'state': state()}
    if action == 'export':
        return {'save': game._load()}
    if action == 'context':
        s = state()
        return {'context': game.context_line(), 'jar': s['jar'], 'day': s['day']}
    if action == 'choose':
        result = game.choose(b['jar'])
        if result.get('error'): return result
        return {'state': state(), 'receipt': '今天选了「' + result['jar']['name'] + '」之罐。'}
    if action == 'clear':
        st = game._load()
        for a in st['active']:
            c = game._find(a['candy_id'])
            st['faded'].append({'target': a['target'], 'name': c['name']})
        st['active'] = []; st['shield'] = {}; st['pending'] = {}
        game._write(st)
        return {'state': state(), 'receipt': '效果结束了，回到平常的我们。'}
    if action == 'buy':
        cid = b.get('id')
        if b.get('dest') == 'today':
            st = game._load(); jar = game._ensure_jar(st)
            if not jar: return {'error': '先选一罐，再来神秘柜。'}
            pool = [c for c in game._catalog()['candies'] if c['id'] not in st['dex']
                    and (c['jar'] == jar['jar'] or (jar['jar'] == 5 and c['jar'] > 0))]
            if not pool: return {'error': '这一罐的品种都收集过了，去图鉴挑一颗吧。'}
            import secrets
            cid = secrets.choice(pool)['id']
        elif not game._load()['dex'].get(cid):
            return {'error': '指名陈列只能买已经尝过的糖。'}
        result = game.buy(cid, dest=b.get('dest', 'reserve'))
        if result.get('error'): return result
        return {'state': state(), 'receipt': '买好了，糖已经放进' + ('今日罐。' if b.get('dest') == 'today' else '储藏罐。')}
    if action == 'eat':
        who = b.get('who', 'user'); source = b.get('source', 'jar')
        st = game._load(); jar = game._ensure_jar(st)
        if source == 'reserve':
            if b.get('id') not in game._reserve(st, who): return {'error': '储藏罐里没有这颗糖。'}
        elif not jar or not any(x['i'] == b.get('index') for x in jar['candies']):
            return {'error': '这颗糖已经不在罐里了，刷新后再挑一颗。'}
        text = game.eat(index=b.get('index'), who=who, target=b.get('target', who),
                        source=source, candy_id=b.get('id'))
        return {'state': state(), 'receipt': '\n'.join(text.splitlines()[:3])}
    return {'error': '没有这个糖罐动作。'}

print(json.dumps(main(json.load(sys.stdin)), ensure_ascii=False))
