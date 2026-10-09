import sys, io
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
from PIL import Image
Image.MAX_IMAGE_PIXELS = 2048 * 2048
data = sys.stdin.buffer.read(6 * 1024 * 1024 + 1)
if len(data) > 6 * 1024 * 1024: raise ValueError('too large')
with Image.open(io.BytesIO(data)) as im:
    if im.format not in ('GIF', 'WEBP') or max(im.size) > 2048: raise ValueError('unsupported image')
    im.seek(0)
    frame = im.convert('RGBA')
    frame.thumbnail((256, 256))
    frame.save(sys.stdout.buffer, format='PNG')
