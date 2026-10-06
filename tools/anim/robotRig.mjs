// Reads the robot mannequin's skeleton straight from the GLB JSON (no image decoding, so it runs in Node).
import fs from 'node:fs';
import * as T from 'three';

export function readGlbJson(file) {
  const b = fs.readFileSync(file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString());
}

/** Rebuild the bone hierarchy at its rest (= bind) pose. Names lose the "mixamorig:" prefix. */
export function robotSkeleton(file) {
  const json = readGlbJson(file);
  // every mixamorig node, skinned or not: some exports leave the *_End / finger-tip leaves out of the skin
  const joints = json.nodes.map((n, i) => (/^mixamorig/.test(n.name ?? '') ? i : -1)).filter((i) => i >= 0);
  const bones = {}, byIndex = {};
  for (const j of joints) {
    const n = json.nodes[j], b = new T.Bone();
    b.name = n.name.replace(/^mixamorig:?/, '');
    if (n.translation) b.position.fromArray(n.translation);
    if (n.rotation) b.quaternion.fromArray(n.rotation);
    if (n.scale) b.scale.fromArray(n.scale);
    bones[b.name] = b; byIndex[j] = b;
  }
  const root = new T.Group();
  for (const j of joints) {
    const kids = json.nodes[j].children ?? [];
    for (const c of kids) if (byIndex[c]) byIndex[j].add(byIndex[c]);
  }
  for (const j of joints) if (!byIndex[j].parent) root.add(byIndex[j]);
  root.updateMatrixWorld(true);
  return { root, bones, names: joints.map(j => byIndex[j].name) };
}
