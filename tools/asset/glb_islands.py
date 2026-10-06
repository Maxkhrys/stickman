"""List or remove disconnected mesh islands in a single-mesh GLB.

    python3 tools/asset/glb_islands.py list <in.glb>
    python3 tools/asset/glb_islands.py strip <in.glb> <out.glb> <xmin,ymin,zmin,xmax,ymax,zmax>

`strip` drops every island whose bounding box lies entirely inside the given box (model units), by
rewriting the index buffer. Used to remove the loose display cartridge baked into the uploaded guns.
"""
import json, struct, sys
import numpy as np

def read(path):
    data = open(path, 'rb').read()
    jl = struct.unpack('<I', data[12:16])[0]
    g = json.loads(data[20:20 + jl])
    bo = 20 + jl
    bl = struct.unpack('<I', data[bo:bo + 4])[0]
    return g, bytearray(data[bo + 8:bo + 8 + bl])

CT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def acc(g, blob, i):
    a = g['accessors'][i]; v = g['bufferViews'][a['bufferView']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count'] * NC[a['type']]
    return np.frombuffer(bytes(blob[off:off + n * np.dtype(CT[a['componentType']]).itemsize]), CT[a['componentType']]).reshape(a['count'], NC[a['type']])

def islands(g, blob):
    p = g['meshes'][0]['primitives'][0]
    pos = acc(g, blob, p['attributes']['POSITION'])
    idx = acc(g, blob, p['indices']).reshape(-1, 3).astype(np.int64)
    # weld by position so UV seams don't split islands
    _, weld = np.unique(np.round(pos, 4), axis=0, return_inverse=True)
    weld = weld.reshape(-1)
    parent = np.arange(weld.max() + 1)
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for t in weld[idx]:
        a, b, c = find(t[0]), find(t[1]), find(t[2])
        parent[b] = a; parent[find(c)] = a
    roots = np.array([find(weld[t[0]]) for t in idx])
    out = {}
    for r in np.unique(roots):
        tri = np.where(roots == r)[0]
        v = pos[idx[tri].reshape(-1)]
        out[int(r)] = (tri, v.min(0), v.max(0))
    return p, idx, out

cmd = sys.argv[1]
g, blob = read(sys.argv[2])
p, idx, isl = islands(g, blob)
if cmd == 'list':
    for r, (tri, lo, hi) in sorted(isl.items(), key=lambda kv: -len(kv[1][0]))[:40]:
        print(len(tri), np.round(lo, 1), np.round(hi, 1))
    print(len(isl), 'islands')
else:
    box = np.array([float(x) for x in sys.argv[4].split(',')])
    keep = np.ones(len(idx), bool); dropped = 0
    for r, (tri, lo, hi) in isl.items():
        if (lo >= box[:3]).all() and (hi <= box[3:]).all():
            keep[tri] = False; dropped += len(tri)
    print('dropping', dropped, 'triangles of', len(idx))
    a = g['accessors'][p['indices']]; v = g['bufferViews'][a['bufferView']]
    new = idx[keep].reshape(-1).astype(CT[a['componentType']])
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    blob[off:off + new.nbytes] = new.tobytes()
    a['count'] = int(new.size)
    j = json.dumps(g, separators=(',', ':')).encode()
    while len(j) % 4: j += b' '
    total = 12 + 8 + len(j) + 8 + len(blob)
    with open(sys.argv[3], 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j)
        f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(bytes(blob))
