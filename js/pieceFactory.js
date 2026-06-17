// pieceFactory.js
// Builds stylised Staunton-style chess pieces out of primitive Three.js
// geometry (cylinders, spheres, cones, boxes, tori). No external 3D models
// are loaded — everything here is generated at runtime.

import * as THREE from 'three';

const RADIAL_SEGMENTS = 28;

/** Stack cylindrical segments bottom-to-top to form a "turned wood" trunk. */
function buildTrunk(segments, material) {
  const group = new THREE.Group();
  let y = 0;
  for (const seg of segments) {
    const geo = new THREE.CylinderGeometry(seg.rTop, seg.rBottom, seg.h, RADIAL_SEGMENTS);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = y + seg.h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    y += seg.h;
  }
  group.userData.topY = y;
  return group;
}

function disc(rTop, rBottom, h, material) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, RADIAL_SEGMENTS);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function sphere(r, material, widthSeg = 20, heightSeg = 16) {
  const geo = new THREE.SphereGeometry(r, widthSeg, heightSeg);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cone(r, h, material, seg = 20) {
  const geo = new THREE.ConeGeometry(r, h, seg);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  return m;
}

function box(w, h, d, material) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function torus(r, tube, material, seg = 24) {
  const geo = new THREE.TorusGeometry(r, tube, 10, seg);
  const m = new THREE.Mesh(geo, material);
  m.rotation.x = Math.PI / 2;
  m.castShadow = true;
  return m;
}

// Standard base/foot/neck/shaft/collar trunk shared by every piece, scaled
// per type so taller pieces (queen, king) read as taller.
function standardTrunk(material, { footR = 0.30, shaftR = 0.135, shaftH = 0.30, collarR = 0.20 }) {
  return buildTrunk([
    { h: 0.045, rTop: footR, rBottom: footR * 1.08 },   // base flare
    { h: 0.05,  rTop: footR * 0.62, rBottom: footR },     // taper into neck
    { h: 0.04,  rTop: footR * 0.62, rBottom: footR * 0.62 },
    { h: shaftH, rTop: shaftR, rBottom: footR * 0.62 * 0.92 }, // long shaft taper
    { h: 0.045, rTop: collarR, rBottom: shaftR },         // collar flare out
    { h: 0.035, rTop: collarR * 0.7, rBottom: collarR },  // collar taper back in
  ], material);
}

function crownSpikes(count, radius, material, spikeH = 0.09, spikeR = 0.028) {
  const grp = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const spike = cone(spikeR, spikeH, material, 8);
    spike.position.set(Math.cos(a) * radius, spikeH / 2, Math.sin(a) * radius);
    grp.add(spike);
  }
  return grp;
}

function makePawn(material) {
  const g = new THREE.Group();
  const trunk = standardTrunk(material, { footR: 0.27, shaftR: 0.115, shaftH: 0.18, collarR: 0.165 });
  g.add(trunk);
  const head = sphere(0.155, material);
  head.position.y = trunk.userData.topY + 0.13;
  g.add(head);
  return g;
}

function makeRook(material) {
  const g = new THREE.Group();
  const trunk = standardTrunk(material, { footR: 0.33, shaftR: 0.20, shaftH: 0.22, collarR: 0.235 });
  g.add(trunk);
  const turretH = 0.16;
  const turret = disc(0.25, 0.225, turretH, material);
  turret.position.y = trunk.userData.topY + turretH / 2;
  g.add(turret);
  const topY = trunk.userData.topY + turretH;
  const teeth = 6;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const tooth = box(0.085, 0.075, 0.06, material);
    tooth.position.set(Math.cos(a) * 0.225, topY + 0.0375, Math.sin(a) * 0.225);
    tooth.lookAt(0, tooth.position.y, 0);
    g.add(tooth);
  }
  return g;
}

function makeBishop(material) {
  const g = new THREE.Group();
  const trunk = standardTrunk(material, { footR: 0.295, shaftR: 0.125, shaftH: 0.30, collarR: 0.19 });
  g.add(trunk);
  const body = sphere(0.165, material);
  body.scale.set(1, 1.35, 1);
  body.position.y = trunk.userData.topY + 0.16;
  g.add(body);
  // mitre slit
  const slit = box(0.34, 0.045, 0.045, material);
  slit.position.y = body.position.y + 0.16;
  slit.rotation.z = Math.PI / 5.2;
  g.add(slit);
  const tip = sphere(0.045, material, 12, 10);
  tip.position.y = body.position.y + 0.30;
  g.add(tip);
  return g;
}

function makeKnight(material) {
  const g = new THREE.Group();
  const trunk = standardTrunk(material, { footR: 0.30, shaftR: 0.155, shaftH: 0.14, collarR: 0.205 });
  g.add(trunk);
  const baseY = trunk.userData.topY;

  // chest / lower neck
  const chest = box(0.27, 0.20, 0.24, material);
  chest.position.y = baseY + 0.10;
  g.add(chest);

  // neck rising and leaning back
  const neck = box(0.20, 0.30, 0.19, material);
  neck.position.set(-0.01, baseY + 0.32, -0.02);
  neck.rotation.x = -0.32;
  g.add(neck);

  // head, leaning forward from the neck
  const head = box(0.19, 0.16, 0.36, material);
  head.position.set(-0.01, baseY + 0.49, 0.10);
  head.rotation.x = 0.55;
  g.add(head);

  // muzzle taper
  const muzzle = box(0.14, 0.12, 0.16, material);
  muzzle.position.set(-0.01, baseY + 0.435, 0.255);
  muzzle.rotation.x = 0.55;
  g.add(muzzle);

  // ear
  const ear = cone(0.045, 0.13, material, 8);
  ear.position.set(-0.01, baseY + 0.62, 0.01);
  ear.rotation.x = -0.35;
  g.add(ear);

  // mane ridge
  const mane = box(0.08, 0.26, 0.07, material);
  mane.position.set(-0.01, baseY + 0.33, -0.10);
  mane.rotation.x = -0.32;
  g.add(mane);

  return g;
}

function makeQueen(material) {
  const g = new THREE.Group();
  const trunk = standardTrunk(material, { footR: 0.32, shaftR: 0.135, shaftH: 0.40, collarR: 0.22 });
  g.add(trunk);
  const baseY = trunk.userData.topY;
  const crownBody = disc(0.215, 0.235, 0.16, material);
  crownBody.position.y = baseY + 0.08;
  g.add(crownBody);
  const ring = torus(0.215, 0.018, material);
  ring.position.y = baseY + 0.16;
  g.add(ring);
  const spikes = crownSpikes(8, 0.18, material, 0.13, 0.032);
  spikes.position.y = baseY + 0.16;
  g.add(spikes);
  const orb = sphere(0.075, material, 16, 14);
  orb.position.y = baseY + 0.16 + 0.13 + 0.045;
  g.add(orb);
  return g;
}

function makeKing(material) {
  const g = new THREE.Group();
  const trunk = standardTrunk(material, { footR: 0.33, shaftR: 0.145, shaftH: 0.44, collarR: 0.235 });
  g.add(trunk);
  const baseY = trunk.userData.topY;
  const crownBody = disc(0.225, 0.245, 0.18, material);
  crownBody.position.y = baseY + 0.09;
  g.add(crownBody);
  const ring = torus(0.225, 0.02, material);
  ring.position.y = baseY + 0.18;
  g.add(ring);
  const ballY = baseY + 0.18 + 0.075;
  const ball = sphere(0.10, material, 18, 14);
  ball.position.y = ballY;
  g.add(ball);
  // cross
  const crossV = box(0.045, 0.20, 0.045, material);
  crossV.position.y = ballY + 0.10 + 0.10;
  g.add(crossV);
  const crossH = box(0.135, 0.045, 0.045, material);
  crossH.position.y = crossV.position.y + 0.015;
  g.add(crossH);
  return g;
}

const BUILDERS = {
  p: makePawn,
  r: makeRook,
  n: makeKnight,
  b: makeBishop,
  q: makeQueen,
  k: makeKing,
};

// Approximate overall piece heights (used for camera/board scaling, etc).
export const PIECE_SCALE = 1.55;

/**
 * Create a piece mesh group for the given type ('p','r','n','b','q','k')
 * and color ('w' | 'b') using the supplied materials.
 */
export function createPiece(type, material) {
  const builder = BUILDERS[type];
  if (!builder) throw new Error(`Unknown piece type "${type}"`);
  const group = builder(material);
  group.scale.setScalar(PIECE_SCALE);
  group.traverse(obj => { if (obj.isMesh) obj.userData.isPieceMesh = true; });
  return group;
}

export function makePieceMaterials() {
  const white = new THREE.MeshStandardMaterial({
    color: 0xf1e6d2,
    roughness: 0.42,
    metalness: 0.06,
  });
  const black = new THREE.MeshStandardMaterial({
    color: 0x5a2026,
    roughness: 0.38,
    metalness: 0.10,
  });
  return { w: white, b: black };
}
