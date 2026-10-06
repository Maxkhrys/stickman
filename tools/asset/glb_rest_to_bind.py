"""Rewrite a skinned GLB so every joint's node transform equals its bind pose.

Some exports (Tripo) ship nodes posed differently from the skin's inverse bind matrices. Retargeting
assumes rest == bind, so this bakes the bind pose into the node TRS. Usage: glb_rest_to_bind.py in.glb out.glb [--fit]

--fit: the bind matrices describe the skeleton in a different frame from the mesh (seen: Z-up, hips at
the origin). Fit that frame to the mesh (each joint vs the centroid of the vertices it owns), snap the
rotation to an axis permutation, and rewrite both the bind matrices and the node transforms in mesh space.
"""
import json, struct, sys
import numpy as np

src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
jlen = struct.unpack('<I', data[12:16])[0]
j = json.loads(data[20:20 + jlen])
bin_chunk = data[20 + jlen:]
blen = struct.unpack('<I', bin_chunk[0:4])[0]
binary = bin_chunk[8:8 + blen]

skin = j['skins'][0]
acc = j['accessors'][skin['inverseBindMatrices']]
bv = j['bufferViews'][acc['bufferView']]
off = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
ibm = np.frombuffer(binary, dtype='<f4', count=16 * len(skin['joints']), offset=off).reshape(-1, 4, 4).transpose(0, 2, 1)
parent = {}
for i, n in enumerate(j['nodes']):
    for c in n.get('children', []):
        parent[c] = i

def local(i):
    n = j['nodes'][i]
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=float).reshape(4, 4).T
    t = n.get('translation', [0, 0, 0]); r = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    x, y, z, w = r
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(s); M[:3, 3] = t
    return M

def world(i):
    m = local(i); p = parent.get(i)
    while p is not None:
        m = local(p) @ m; p = parent.get(p)
    return m

def quat(R):
    t = np.trace(R)
    if t > 0:
        s = np.sqrt(t + 1) * 2; w = 0.25 * s; x = (R[2, 1] - R[1, 2]) / s; y = (R[0, 2] - R[2, 0]) / s; z = (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = np.sqrt(1 + R[0, 0] - R[1, 1] - R[2, 2]) * 2; w = (R[2, 1] - R[1, 2]) / s; x = 0.25 * s; y = (R[0, 1] + R[1, 0]) / s; z = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = np.sqrt(1 + R[1, 1] - R[0, 0] - R[2, 2]) * 2; w = (R[0, 2] - R[2, 0]) / s; x = (R[0, 1] + R[1, 0]) / s; y = 0.25 * s; z = (R[1, 2] + R[2, 1]) / s
    else:
        s = np.sqrt(1 + R[2, 2] - R[0, 0] - R[1, 1]) * 2; w = (R[1, 0] - R[0, 1]) / s; x = (R[0, 2] + R[2, 0]) / s; y = (R[1, 2] + R[2, 1]) / s; z = 0.25 * s
    q = np.array([x, y, z, w]); return (q / np.linalg.norm(q)).tolist()

fit = '--fit' in sys.argv
X = np.eye(4)
if fit:
    pr = j['meshes'][0]['primitives'][0]['attributes']
    ct = {5121: 'u1', 5123: '<u2', 5126: '<f4'}
    def arr(i, nc):
        a = j['accessors'][i]; b = j['bufferViews'][a['bufferView']]
        return np.frombuffer(binary, dtype=ct[a['componentType']], count=a['count'] * nc, offset=b.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, nc)
    P = arr(pr['POSITION'], 3); J = arr(pr['JOINTS_0'], 4); W = arr(pr['WEIGHTS_0'], 4).astype(float)
    if W.max() > 1.5: W /= W.max()
    S, M = [], []
    for k in range(len(skin['joints'])):
        m = (W * (J == k)).sum(1) > 0.6
        if m.sum() >= 30:
            S.append(np.linalg.inv(ibm[k])[:3, 3]); M.append(P[m].mean(0))
    S, M = np.array(S), np.array(M)
    cs, cm = S.mean(0), M.mean(0)
    U, _, Vt = np.linalg.svd((S - cs).T @ (M - cm))
    Rf = Vt.T @ U.T
    Rs = np.zeros((3, 3))
    for r in range(3):
        c = int(np.argmax(np.abs(Rf[r]))); Rs[r, c] = np.sign(Rf[r, c])
    X[:3, :3] = Rs; X[:3, 3] = cm - Rs @ cs
    print('fit frame', Rs.tolist(), 'offset', X[:3, 3].round(4).tolist())
    ibm = np.array([m @ np.linalg.inv(X) for m in ibm])
    new = ibm.transpose(0, 2, 1).astype('<f4').tobytes()
    o = off
    binary = binary[:o] + new + binary[o + len(new):]
    bin_chunk = bin_chunk[:8] + binary + bin_chunk[8 + blen:]

# skin space -> world: the skinned mesh node's world matrix (bind matrices are relative to it)
mesh_node = next(i for i, n in enumerate(j['nodes']) if 'skin' in n)
mesh_world = world(mesh_node)
bind_world = {jt: mesh_world @ np.linalg.inv(ibm[k]) for k, jt in enumerate(skin['joints'])}
# process parents before children
def depth(i):
    d = 0; p = parent.get(i)
    while p is not None:
        d += 1; p = parent.get(p)
    return d
new_world = {}
for jt in sorted(skin['joints'], key=depth):
    p = parent.get(jt)
    pw = new_world.get(p) if p in new_world else world(p) if p is not None else np.eye(4)
    L = np.linalg.inv(pw) @ bind_world[jt]
    new_world[jt] = bind_world[jt]
    S = np.linalg.norm(L[:3, :3], axis=0)
    n = j['nodes'][jt]
    n.pop('matrix', None)
    n['translation'] = L[:3, 3].tolist(); n['rotation'] = quat(L[:3, :3] / S); n['scale'] = S.tolist()

js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + len(bin_chunk)) + struct.pack('<I', len(js)) + b'JSON' + js + bin_chunk
open(dst, 'wb').write(out)
print('rewrote', len(skin['joints']), 'joints ->', dst)
