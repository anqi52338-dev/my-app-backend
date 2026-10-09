import sys, io, json, zipfile, posixpath
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import unquote

class Plain(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []; self.skip = 0; self.heading = []; self.in_heading = False
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.skip += 1
        if tag in ('p', 'div', 'br', 'h1', 'h2', 'h3', 'li'): self.parts.append('\n')
        if tag in ('h1', 'h2') and not self.heading: self.in_heading = True
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.skip = max(0, self.skip - 1)
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'li'): self.parts.append('\n')
        if tag in ('h1', 'h2'): self.in_heading = False
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)
            if self.in_heading: self.heading.append(data)

def parse(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    files = z.infolist()
    if len(files) > 3000 or sum(i.file_size for i in files) > 40 * 1024 * 1024 or any(i.flag_bits & 1 for i in files): raise ValueError('Book too large or encrypted')
    def xml(name):
        raw = z.read(name)
        if len(raw) > 2 * 1024 * 1024 or b'<!DOCTYPE' in raw or b'<!ENTITY' in raw: raise ValueError('Invalid XML')
        return ET.fromstring(raw)
    container = xml('META-INF/container.xml')
    rootfile = next(x.attrib['full-path'] for x in container.iter() if x.tag.endswith('rootfile'))
    package = xml(rootfile)
    base = posixpath.dirname(rootfile)
    title = next((x.text for x in package.iter() if x.tag.endswith('}title') and x.text), '')
    author = next((x.text for x in package.iter() if x.tag.endswith('}creator') and x.text), '')
    manifest = {x.attrib['id']: x.attrib.get('href', '') for x in package.iter() if x.tag.endswith('}item')}
    chapters = []; total = 0
    for item in package.iter():
        if not item.tag.endswith('}itemref') or item.attrib.get('linear') == 'no': continue
        href = unquote(manifest.get(item.attrib.get('idref'), '').split('#')[0])
        name = posixpath.normpath(posixpath.join(base, href))
        if name.startswith('../') or name.startswith('/'): raise ValueError('Invalid path')
        raw = z.read(name)
        if len(raw) > 3 * 1024 * 1024: raise ValueError('Chapter too large')
        p = Plain(); p.feed(raw.decode('utf-8-sig'))
        lines = [line.strip() for line in ''.join(p.parts).splitlines() if line.strip()]
        text = '\n\n'.join(lines); total += len(text)
        if total > 3000000: raise ValueError('Book too long')
        if text:
            heading = ''.join(p.heading).strip()[:100] or f'第 {len(chapters) + 1} 节'
            chunk = [] ; size = 0; part = 1
            for line in lines:
                chunk.append(line); size += len(line)
                if size > 14000:
                    chapters.append({'title': heading if part == 1 else f'{heading} · {part}', 'text': '\n\n'.join(chunk)})
                    chunk = []; size = 0; part += 1
            if chunk: chapters.append({'title': heading if part == 1 else f'{heading} · {part}', 'text': '\n\n'.join(chunk)})
    if not chapters: raise ValueError('No readable text')
    return {'title': title, 'author': author, 'chapters': chapters}

if __name__ == '__main__':
    data = sys.stdin.buffer.read(7 * 1024 * 1024)
    print(json.dumps(parse(data), ensure_ascii=False))
