"""Re-encode every embedded texture of a GLB as a smaller JPEG (runtime copies of the uploaded models).

    python3 tools/asset/shrink_glb_texture.py <in.glb> <out.glb> [max_px=2048] [quality=88]

Geometry, skin and material are copied byte for byte; only the image buffer view changes.
"""
import io, json, struct, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
max_px = int(sys.argv[3]) if len(sys.argv) > 3 else 2048
quality = int(sys.argv[4]) if len(sys.argv) > 4 else 88

data = open(src, 'rb').read()
json_len = struct.unpack('<I', data[12:16])[0]
gltf = json.loads(data[20:20 + json_len])
bin_off = 20 + json_len
bin_len = struct.unpack('<I', data[bin_off:bin_off + 4])[0]
blob = data[bin_off + 8:bin_off + 8 + bin_len]

views = gltf['bufferViews']
image_views = {img['bufferView'] for img in gltf.get('images', [])}
for img in gltf.get('images', []): img['mimeType'] = 'image/jpeg'
out = bytearray()
for i, v in enumerate(views):
    chunk = blob[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
    if i in image_views:
        im = Image.open(io.BytesIO(chunk)).convert('RGB')
        print('image', im.size, '->', end=' ')
        if max(im.size) > max_px:
            im = im.resize((max_px, max_px * im.size[1] // im.size[0]), Image.LANCZOS)
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=quality, optimize=True); chunk = buf.getvalue()
        print(im.size, len(chunk) // 1024, 'KB')
    while len(out) % 4: out += b'\0'
    v['byteOffset'] = len(out); v['byteLength'] = len(chunk)
    out += chunk
while len(out) % 4: out += b'\0'
gltf['buffers'][0]['byteLength'] = len(out)
j = json.dumps(gltf, separators=(',', ':')).encode()
while len(j) % 4: j += b' '
total = 12 + 8 + len(j) + 8 + len(out)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j)
    f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)
print('wrote', dst, total // 1024, 'KB')
