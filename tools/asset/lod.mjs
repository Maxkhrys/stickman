// Builds a reduced-detail index buffer for each runtime GLB: <file>.lod.bin next to it.
// The LOD reuses the GLB's own vertex buffers (meshoptimizer only picks a subset of triangles), so at
// runtime it is just a second index on the same geometry: no extra skinning data, no extra download
// of positions/UVs. meshoptimizer keeps UV seams intact; 'Prune' drops tiny detached bits.
//
//   node tools/asset/lod.mjs <ratio> <maxRelativeError> file.glb [file.glb ...]
//   (shipped: 0.12 0.03 for characters and weapons)
//
// Output: uint32 count, then count uint32 indices (one primitive per GLB; the tool refuses others).
import fs from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';

const [ratioArg, errArg, ...files] = process.argv.slice(2);
const ratio = Number(ratioArg), maxErr = Number(errArg);
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true; // for Prune
for (const file of files) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + jl).toString()), bin = b.subarray(20 + jl + 8);
  const prims = json.meshes.flatMap((m) => m.primitives);
  if (prims.length !== 1) throw new Error(`${file}: ${prims.length} primitives, expected 1`);
  const p = prims[0];
  const read = (i, Arr) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC3: 3 }[a.type], off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const size = Arr.BYTES_PER_ELEMENT, stride = v.byteStride ?? n * size, out = new Arr(a.count * n);
    const get = { 5126: (o) => bin.readFloatLE(o), 5125: (o) => bin.readUInt32LE(o), 5123: (o) => bin.readUInt16LE(o) }[a.componentType];
    const cs = { 5126: 4, 5125: 4, 5123: 2 }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = get(off + k * (v.byteStride ?? n * cs) + c * cs);
    return out;
  };
  const pos = read(p.attributes.POSITION, Float32Array);
  const idx = p.indices != null ? read(p.indices, Uint32Array) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  const target = Math.floor((idx.length * ratio) / 3) * 3;
  const [out, err] = MeshoptSimplifier.simplify(idx, pos, 3, target, maxErr, ['Prune']);
  const buf = Buffer.alloc(4 + out.length * 4);
  buf.writeUInt32LE(out.length, 0);
  Buffer.from(out.buffer, out.byteOffset, out.byteLength).copy(buf, 4);
  fs.writeFileSync(file.replace(/\.glb$/, '.lod.bin'), buf);
  console.log(file, 'tris', idx.length / 3, '->', out.length / 3, 'error', err.toFixed(4), (buf.length / 1024).toFixed(0) + ' KB');
}
