// Fly World: a closed loop between a 3D world and the whole-brain fly model (world_server.py).
// The world and body run here. Every CHUNK ms of brain time we send what the fly senses and
// get back motor/descending neuron rates, which decide eating, grooming, escape and steering.
import * as THREE from "three";
import { buildHeaven } from "./heaven.js";

const $ = (s) => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const CHUNK = 40;          // ms of brain time per round trip
const WORLD_R = 46;

// ======================================================================= renderer
const canvas = $("#world");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 400);

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  t.anisotropy = 4;
  return t;
}

// sky dome with a vertical gradient
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
  vertexShader: `varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec3 p; uniform vec3 top, mid, bottom;
    void main(){ float h = p.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bottom, pow(-h, 0.5)); gl_FragColor = vec4(c, 1.0); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat);
scene.add(sky);

const hemi = new THREE.HemisphereLight(0xffffff, 0x445522, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
scene.fog = new THREE.Fog(0xffffff, 30, 120);

// ======================================================================= heaven (world/heaven.js)
const H = buildHeaven({ canvasTex, rand });
const heaven = H.group;
scene.add(heaven);

// floating light motes / petals in heaven, ash and embers in hell
const dotTex = canvasTex(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.45, "rgba(255,255,255,.8)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
});
function makeParticles(n, color, size, additive) {
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size, map: dotTex, alphaTest: 0.02, transparent: true, opacity: 0.85, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  pts.userData = { pos, vel, n };
  return pts;
}
const motes = makeParticles(500, "#fff3b0", 0.12, true);
const petals = makeParticles(160, "#ffd1e8", 0.22, false);
heaven.add(motes, petals);

// ======================================================================= hell
const hell = new THREE.Group();
hell.visible = false;
scene.add(hell);
{
  const paths = Array.from({ length: 70 }, () => {
    let x = rand(0, 1024), y = rand(0, 1024); const pts = [[x, y]];
    for (let k = 0; k < 8; k++) { x += rand(-40, 40); y += rand(-40, 40); pts.push([x, y]); }
    return { pts, wide: rand(3, 6), glow: rand(1.5, 3.5), g: rand(60, 140) };
  });
  const crack = (g, w, h, glow) => {     // the same cracks in the colour map and the glow map
    g.fillStyle = glow ? "#000" : "#1b0f0c"; g.fillRect(0, 0, w, h);
    if (!glow) for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${rand(20, 60)},${rand(10, 25)},${rand(8, 20)},.8)`; g.fillRect(rand(0, w), rand(0, h), 3, 3); }
    g.lineCap = "round";
    for (const p of paths) {
      g.strokeStyle = glow ? `rgba(255,${p.g},20,1)` : "#050202";
      g.lineWidth = glow ? p.glow : p.wide;
      g.beginPath(); g.moveTo(...p.pts[0]); for (const q of p.pts.slice(1)) g.lineTo(...q); g.stroke();
    }
  };
  const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshStandardMaterial({
    map: canvasTex(1024, 1024, (g, w, h) => crack(g, w, h, false), 10),
    emissiveMap: canvasTex(1024, 1024, (g, w, h) => crack(g, w, h, true), 10),
    emissive: "#ff3a10", emissiveIntensity: 1.2, roughness: 0.95,
  }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  hell.add(ground);
  // black spikes and dead trees
  const rockMat = new THREE.MeshStandardMaterial({ color: "#140a08", roughness: 0.9, flatShading: true });
  for (let i = 0; i < 60; i++) {
    const g = new THREE.ConeGeometry(rand(0.4, 1.6), rand(2, 9), 6, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setX(k, p.getX(k) + rand(-0.15, 0.15));
    const r = new THREE.Mesh(g, rockMat);
    const d = rand(6, 60), a = rand(0, Math.PI * 2);
    r.position.set(Math.cos(a) * d, g.parameters.height / 2 - 0.2, Math.sin(a) * d);
    r.rotation.z = rand(-0.25, 0.25); r.castShadow = true;
    hell.add(r);
  }
  for (let i = 0; i < 10; i++) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 6, 6), rockMat); trunk.position.y = 3; tree.add(trunk);
    for (let k = 0; k < 5; k++) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.1, rand(1.5, 3), 5), rockMat);
      br.position.y = rand(3, 5.6); br.rotation.z = rand(-1.2, 1.2); br.rotation.y = rand(0, 6); tree.add(br);
    }
    const d = rand(10, 45), a = rand(0, Math.PI * 2);
    tree.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); tree.traverse((o) => (o.castShadow = true));
    hell.add(tree);
  }
  const lavaLight = new THREE.PointLight("#ff4a1a", 60, 40, 1.6); lavaLight.position.set(0, 2, 0);
  hell.add(lavaLight); hell.userData.lava = lavaLight;
}
const ash = makeParticles(900, "#8a8580", 0.13, false);
const embers = makeParticles(260, "#ff7a2a", 0.14, true);
hell.add(ash, embers);

// ======================================================================= the fly
function makeFly() {
  const fly = new THREE.Group();
  const body = new THREE.Group(); fly.add(body);
  const cuticle = new THREE.MeshStandardMaterial({ color: "#6e5d45", roughness: 0.55, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: "#2b231a", roughness: 0.6 });
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), cuticle);
  thorax.scale.set(1, 0.92, 1.18); body.add(thorax);
  const abdTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = "#c9a565"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { g.fillStyle = "rgba(45,30,14,.85)"; g.fillRect(0, 40 + i * 46, w, 18); }
  });
  const abdGeo = new THREE.SphereGeometry(0.22, 24, 16); abdGeo.rotateX(Math.PI / 2);   // poles along the body: stripes become rings
  const abd = new THREE.Mesh(abdGeo, new THREE.MeshStandardMaterial({ map: abdTex, roughness: 0.45 }));
  abd.scale.set(0.95, 0.82, 1.55); abd.rotation.x = -0.12; abd.position.set(0, -0.02, -0.4);
  body.add(abd);
  const head = new THREE.Group(); head.position.set(0, 0.04, 0.27); body.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), cuticle));
  const eyeTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = "#a3121a"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < w; x += 6) {
      g.fillStyle = `rgba(255,${rand(60, 110)},${rand(60, 90)},${rand(0.25, 0.6)})`; g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill();
    }
  });
  const eyeMat = new THREE.MeshStandardMaterial({ map: eyeTex, roughness: 0.35, emissive: "#3a0003" });
  for (const s of [1, -1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), eyeMat);
    e.position.set(0.085 * s, 0.025, 0.05); e.scale.set(0.8, 1.05, 1); head.add(e);
  }
  const ants = [];
  for (const s of [1, -1]) {
    const a = new THREE.Group(); a.position.set(0.03 * s, 0.06, 0.12); head.add(a);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.09, 6), dark);
    seg.position.y = 0.045; a.add(seg);
    const ar = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.12, 4), dark);
    ar.position.set(0, 0.1, 0.03); ar.rotation.x = 0.9; a.add(ar);
    a.rotation.x = 0.7; a.rotation.z = -0.25 * s;
    ants.push(a);
  }
  const prob = new THREE.Group(); prob.position.set(0, -0.08, 0.06); head.add(prob);
  const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.16, 8), cuticle); pm.position.y = -0.08; prob.add(pm);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshStandardMaterial({ color: "#9a8060" }));
  tip.position.y = -0.16; tip.scale.set(1.2, 0.7, 1); prob.add(tip);
  prob.rotation.x = 0.5;
  // wings
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.bezierCurveTo(0.12, 0.08, 0.6, 0.13, 0.78, 0.04); shape.bezierCurveTo(0.7, -0.08, 0.2, -0.1, 0, 0);
  const veins = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = "rgba(220,235,255,1)"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(70,60,50,.9)"; g.lineWidth = 2;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(0, h / 2); g.quadraticCurveTo(w * 0.5, h * (0.2 + i * 0.15), w, h * (0.3 + i * 0.1)); g.stroke(); }
  });
  const wingMat = new THREE.MeshStandardMaterial({ map: veins, transparent: true, opacity: 0.38, side: THREE.DoubleSide, roughness: 0.2, depthWrite: false });
  const wingGeo = new THREE.ShapeGeometry(shape, 16);
  const uv = wingGeo.attributes.uv, wp = wingGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, wp.getX(i) / 0.78, wp.getY(i) / 0.3 + 0.5);
  const wings = [];
  for (const s of [1, -1]) {
    const w = new THREE.Group(); w.position.set(0.06 * s, 0.13, 0.02); body.add(w);
    const m = new THREE.Mesh(wingGeo, wingMat); m.rotation.x = -Math.PI / 2; m.scale.x = s; w.add(m);
    wings.push({ g: w, s });
  }
  // legs: 3 segments drawn between IK points every frame
  const legMat = new THREE.MeshStandardMaterial({ color: "#2e261c", roughness: 0.6 });
  const unit = new THREE.CylinderGeometry(1, 1, 1, 6); unit.translate(0, 0.5, 0);
  const legs = [];
  const hips = [[0.1, -0.08, 0.12], [0.12, -0.1, 0.0], [0.1, -0.1, -0.12]];
  const rest = [[0.34, 0.42], [0.46, 0.02], [0.4, -0.42]];
  for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
    const segs = [0.022, 0.018, 0.012].map((r) => { const m = new THREE.Mesh(unit, legMat); m.userData.r = r; m.castShadow = true; body.add(m); return m; });
    legs.push({ s, k, hip: new THREE.Vector3(hips[k][0] * s, hips[k][1], hips[k][2]), rest: new THREE.Vector3(rest[k][0] * s, 0, rest[k][1]),
      tripod: (k === 1) === (s === 1) ? 0 : 1, segs, foot: new THREE.Vector3() });
  }
  fly.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  fly.userData = { body, head, ants, prob, wings, legs };
  return fly;
}
const fly = makeFly();
scene.add(fly);

const _y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
function setSeg(m, a, b) {
  _d.subVectors(b, a); const len = _d.length();
  m.position.copy(a); m.quaternion.setFromUnitVectors(_y, _d.normalize());
  m.scale.set(m.userData.r, len, m.userData.r);
}

// ======================================================================= items
const items = [];
const itemGroup = new THREE.Group(); scene.add(itemGroup);
const MATS = {
  sugar: new THREE.MeshStandardMaterial({ color: "#ffd56a", emissive: "#ff9a00", emissiveIntensity: 0.35, roughness: 0.15, transparent: true, opacity: 0.92 }),
  cube: new THREE.MeshStandardMaterial({ color: "#fffaf0", roughness: 0.4, emissive: "#fff2c0", emissiveIntensity: 0.1 }),
  water: new THREE.MeshPhysicalMaterial({ color: "#bfe6ff", roughness: 0.02, transmission: 0.92, thickness: 0.6, ior: 1.33, transparent: true, opacity: 0.85, clearcoat: 1 }),
  bitter: new THREE.MeshStandardMaterial({ color: "#4a1d5e", roughness: 0.25, metalness: 0.1, emissive: "#14051c" }),
};
function fruit(kind) {
  const g = new THREE.Group();
  if (kind === "strawberry") {
    const seeds = canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = "#e3263a"; c.fillRect(0, 0, w, h);
      for (let y = 6; y < h; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < w; x += 12) { c.fillStyle = "#ffe27a"; c.beginPath(); c.ellipse(x, y, 1.6, 2.6, 0, 0, 7); c.fill(); }
    });
    const geo = new THREE.SphereGeometry(0.55, 24, 16), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); const k = 1 - Math.max(0, -y) * 0.9; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    geo.computeVertexNormals();
    const berry = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: seeds, roughness: 0.3 }));
    berry.rotation.z = 1.25; berry.position.y = 0.42; g.add(berry);
    for (let k = 0; k < 6; k++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshStandardMaterial({ color: "#3f9a3e" }));
      leaf.scale.set(1, 0.15, 0.4); const a = (k / 6) * Math.PI * 2; leaf.position.set(-0.5, 0.62 + Math.sin(a) * 0.12, Math.cos(a) * 0.12); leaf.rotation.x = a; g.add(leaf);
    }
  } else {
    const mat = new THREE.MeshPhysicalMaterial({ color: "#b0102a", roughness: 0.15, clearcoat: 1 });
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.36, 22, 16), mat); c.position.set(s * 0.32, 0.36, 0); g.add(c);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1, 6), new THREE.MeshStandardMaterial({ color: "#5c7a2a" }));
      st.position.set(s * 0.18, 1.05, 0); st.rotation.z = s * 0.35; g.add(st);
    }
  }
  return g;
}
function addItem(type, x, z, amount = 1, kind, opts = {}) {
  let mesh, reach = 0.55, endless = false;
  if (kind === "pond") { mesh = new THREE.Object3D(); reach = opts.r + 0.35; endless = true; }
  else if (kind === "strawberry" || kind === "cherry") { mesh = fruit(kind); reach = 0.85; }
  else if (type === "sugar" && kind === "cube") { mesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), MATS.cube); mesh.position.y = 0.21; mesh.rotation.y = rand(0, 3); }
  else if (type === "sugar") { mesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 12), MATS.sugar); mesh.scale.y = 0.28; mesh.position.y = 0.04; }
  else if (type === "water") { mesh = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), MATS.water); mesh.scale.y = 0.8; mesh.position.y = 0.26; }
  else { mesh = new THREE.Group(); for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), MATS.bitter); b.position.set(rand(-0.15, 0.15), 0.2, rand(-0.15, 0.15)); mesh.add(b); } }
  mesh.position.x = x; mesh.position.z = z;
  mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  itemGroup.add(mesh);
  const it = { type, kind: kind === "strawberry" || kind === "cherry" ? "fruit" : kind, fruit: kind, mesh, amount, full: amount, x, z, reach, endless, rejectUntil: 0, base: mesh.scale.clone() };
  items.push(it);
  return it;
}
function removeItem(it) { itemGroup.remove(it.mesh); items.splice(items.indexOf(it), 1); }
function seedHeavenItems() {
  for (const f of H.flowers) {                       // nectar drops at the foot of every flower
    const a = rand(0, 6.28);
    addItem("sugar", f.position.x + Math.cos(a) * 1.1, f.position.z + Math.sin(a) * 1.1, 1);
  }
  for (const [x, z, kind] of H.fruitSpots) addItem("sugar", x, z, 1, kind);
  addItem("water", H.pond.x, H.pond.z, 1, "pond", { r: H.pond.r });
  const free = () => { for (;;) { const r = rand(4, 40), a = rand(0, 6.28), x = Math.cos(a) * r, z = Math.sin(a) * r; if (Math.hypot(x - H.pond.x, z - H.pond.z) > H.pond.r + 1.5) return [x, z]; } };
  for (let i = 0; i < 10; i++) addItem("water", ...free(), 1);
  for (let i = 0; i < 6; i++) addItem("bitter", ...free(), 1);
}

// ======================================================================= predators (swooping shadows)
const predators = [];
function spawnPredator() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: realm === "hell" ? "#0a0505" : "#27324a", roughness: 0.8 });
  const bodyM = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), mat); bodyM.scale.set(0.7, 0.6, 1.6); g.add(bodyM);
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.lineTo(3.2, 0.6); wingShape.lineTo(2.6, -0.4); wingShape.lineTo(1.6, -0.1); wingShape.lineTo(0.9, -0.7); wingShape.lineTo(0, -0.5);
  const wg = new THREE.ShapeGeometry(wingShape);
  const wl = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: mat.color, side: THREE.DoubleSide }));
  wl.rotation.x = -Math.PI / 2; const wr = wl.clone(); wr.scale.x = -1;
  const pl = new THREE.Group(); pl.add(wl); const pr = new THREE.Group(); pr.add(wr); g.add(pl, pr);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.35, depthWrite: false }));
  shadowBlob.rotation.x = -Math.PI / 2; shadowBlob.position.y = 0.03;
  scene.add(g, shadowBlob);
  const a = rand(0, Math.PI * 2);
  const start = new THREE.Vector3(fly.position.x + Math.cos(a) * 38, rand(10, 16), fly.position.z + Math.sin(a) * 38);
  g.position.copy(start);
  const target = fly.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  const dir = target.clone().sub(start).normalize();
  predators.push({ g, pl, pr, shadowBlob, dir, speed: 15, t: 0, lastAng: null });
}
function updatePredators(dt) {
  for (const p of [...predators]) {
    p.t += dt;
    p.g.position.addScaledVector(p.dir, p.speed * dt);
    if (p.g.position.y < 1.2) p.dir.y = Math.max(p.dir.y, 0.05);
    p.g.lookAt(p.g.position.clone().add(p.dir));
    const flap = Math.sin(p.t * 9) * 0.6; p.pl.rotation.z = flap; p.pr.rotation.z = -flap;
    p.shadowBlob.position.set(p.g.position.x, 0.03, p.g.position.z);
    p.shadowBlob.material.opacity = clamp(0.5 - p.g.position.y * 0.02, 0.1, 0.5);
    if (p.t > 6) { scene.remove(p.g, p.shadowBlob); predators.splice(predators.indexOf(p), 1); }
  }
}

// ======================================================================= realm switching
let realm = "heaven";
const REALMS = {
  heaven: { top: "#5eaefc", mid: "#ffe1bd", bottom: "#b8d99a", fog: "#ffe6cc", fogNear: 45, fogFar: 230, hemiSky: "#fff3dc", hemiGround: "#6f9a4a", hemiI: 1.15,
    sun: "#ffe9c4", sunI: 2.8, exposure: 1.08,
    note: "Heaven: a golden meadow of giant flowers, fruit, a lotus pond, butterflies and endless sky." },
  hell: { top: "#120202", mid: "#5c0c04", bottom: "#200302", fog: "#2b0602", fogNear: 8, fogFar: 70, hemiSky: "#ff5a2a", hemiGround: "#200000", hemiI: 0.45,
    sun: "#ff6a3a", sunI: 0.7, exposure: 1.0,
    note: "Hell: scorched ground, falling ash, swooping shadows. Nothing to eat, nothing to drink." },
};
function applyRealm(name) {
  realm = name;
  const R = REALMS[name];
  skyMat.uniforms.top.value.set(R.top); skyMat.uniforms.mid.value.set(R.mid); skyMat.uniforms.bottom.value.set(R.bottom);
  scene.fog.color.set(R.fog); scene.fog.near = R.fogNear; scene.fog.far = R.fogFar;
  hemi.color.set(R.hemiSky); hemi.groundColor.set(R.hemiGround); hemi.intensity = R.hemiI;
  sun.color.set(R.sun); sun.intensity = R.sunI;
  renderer.toneMappingExposure = R.exposure;
  heaven.visible = name === "heaven"; hell.visible = name === "hell";
  for (const it of [...items]) removeItem(it);
  if (name === "heaven") seedHeavenItems();
  document.body.className = name;
  $("#toHeaven").classList.toggle("on", name === "heaven"); $("#toHell").classList.toggle("on", name === "hell");
  $("#realmNote").textContent = R.note;
  for (const b of ["#dropSugar", "#dropWater", "#dropBitter"]) {
    $(b).disabled = name === "hell";
    $(b).title = name === "hell" ? "Nothing can exist in hell" : $(b).title;
  }
  F.target = null;
}
function switchRealm(name) {
  if (name === realm) return;
  const fade = $("#fade"); fade.className = name === "hell" ? "hell show" : "show";
  setTimeout(() => { applyRealm(name); fade.className = name === "hell" ? "hell" : ""; }, 700);
}

// ======================================================================= the fly's body (state + reflexes)
const F = {
  x: 0, z: 0, y: 0, heading: 0, speed: 0, vy: 0,
  mode: "walk", modeT: 0, energy: 0.55, water: 0.5, phase: 0,
  target: null, at: null, flightLeft: 0, flightKind: "", touchUntil: 0, nextTouch: 0, wander: 0,
  stats: { sugar: 0, water: 0, refused: 0, grooms: 0, escapes: 0, flights: 0 },
};
const M = { mn9: 0, groom: 0, gf: 0, mdn: 0, turn_l: 0, turn_r: 0, walk: 0 };   // smoothed brain outputs (Hz)
let lastSenses = {};
let doing = { tag: "body", text: "Waking up", why: "" };
function setDoing(tag, text, why) { doing = { tag, text, why }; }
function setMode(m) { if (F.mode !== m) { F.mode = m; F.modeT = 0; } }

function nearestFood() {
  const hunger = 1 - F.energy, thirst = 1 - F.water;
  let best = null, bd = 1e9;
  for (const it of items) {
    if (it.amount <= 0.02 || it.rejectUntil > now) continue;
    let want = it.type === "sugar" ? hunger : it.type === "water" ? thirst : 0.25;   // bitter smells fruity enough to check
    if (want < 0.25) continue;
    const d = Math.hypot(it.x - F.x, it.z - F.z) / (0.4 + want);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

// ======================================================================= the mind: the fly's own random urges
// Urges rise and fade in random bouts. They are not actions: they are sent INTO the brain, at the central
// neurons that feed each command neuron, and only what the command neurons then do moves the body.
const URGES = {
  walk:    { label: "wander",     dur: [1.5, 8],   amp: [0.45, 1] },
  turn_l:  { label: "turn left",  dur: [0.3, 1.6], amp: [0.3, 0.9] },
  turn_r:  { label: "turn right", dur: [0.3, 1.6], amp: [0.3, 0.9] },
  back:    { label: "back up",    dur: [0.6, 1.8], amp: [0.6, 1] },
  groom:   { label: "groom",      dur: [1, 3.5],   amp: [0.5, 1] },
  probe:   { label: "probe",      dur: [0.5, 1.6], amp: [0.5, 1] },
  takeoff: { label: "take off",   dur: [0.3, 0.6], amp: [0.8, 1] },
};
const mind = { level: {}, bout: {}, extra: {}, trim: 0, focus: "", stop: new Set() };
for (const k in URGES) { mind.level[k] = 0; mind.bout[k] = null; }

function urgeRates() {           // bouts per second, shaped by its state and the world
  const h = 1 - F.energy, q = 1 - F.water, inHell = realm === "hell", flying = F.mode === "fly";
  const busy = F.mode === "feed" || F.mode === "taste";
  const tired = F.energy < 0.05 ? 0.15 : 1;
  return {
    walk: busy || flying ? 0 : 0.3 * (0.5 + h + q) * (inHell ? 0.55 : 1) * tired,
    turn_l: 0.45, turn_r: 0.45,
    back: busy || flying ? 0 : inHell ? 0.07 : 0.035,
    groom: busy || flying ? 0 : inHell ? 0.11 : 0.045,
    probe: busy || flying ? 0 : 0.05 + 0.12 * h,
    takeoff: busy || flying ? 0 : inHell ? 0.006 : F.energy > 0.35 && F.water > 0.15 ? 0.04 : 0.004,
  };
}

function updateMind(dt) {
  const rates = urgeRates();
  for (const k in URGES) {
    const U = URGES[k];
    if (!mind.bout[k] && Math.random() < (rates[k] || 0) * dt)
      mind.bout[k] = { left: rand(...U.dur), amp: rand(...U.amp) };
    const b = mind.bout[k];
    if (b && ((b.left -= dt) <= 0 || !rates[k])) {
      mind.bout[k] = null;
      if (!(k === "probe" && (F.mode === "feed" || F.mode === "taste"))) mind.stop.add(`u_${k}`);   // release the circuit
    }
    const target = mind.bout[k] ? mind.bout[k].amp : 0;
    mind.level[k] += (target - mind.level[k]) * (1 - Math.exp(-dt / 0.25));
    mind.level[k] = clamp(mind.level[k] + rand(-0.02, 0.02), 0, 1);
  }
  // purposes that bias the urges: hunger/thirst (the smell compass points, the urge to turn goes into the
  // brain) and the edge of the world
  mind.extra = { walk: 0, turn_l: 0, turn_r: 0 };
  mind.focus = "";
  let goal = null;
  const food = F.mode === "walk" || F.mode === "fly" ? nearestFood() : null;
  F.target = food;
  if (food) { goal = Math.atan2(food.x - F.x, food.z - F.z); mind.focus = food.type; }
  if (Math.hypot(F.x, F.z) > WORLD_R) { goal = Math.atan2(-F.x, -F.z); mind.focus = "edge"; }
  if (goal != null) {
    const e = wrap(goal - F.heading), want = clamp(Math.abs(e) * 1.1, 0, 0.9);
    mind.extra[e > 0 ? "turn_l" : "turn_r"] = want;
    if (F.mode === "walk") mind.extra.walk = 0.55;
  }
  // self-control: the feeding circuit can latch on by itself; if MN9 keeps firing with no food and no urge to
  // probe, release it
  const idleMN9 = M.mn9 > 25 && mind.level.probe < 0.1 && F.mode !== "feed" && F.mode !== "taste";
  mind.mn9Idle = idleMN9 ? (mind.mn9Idle || 0) + dt : 0;
  if (mind.mn9Idle > 1.0) { mind.stop.add("u_probe"); mind.mn9Idle = 0; }
  // slow self-correction for the wiring's built-in veer while walking (like learning to walk straight)
  if (M.walk > 20) mind.trim = clamp(mind.trim + dt * 0.004 * (M.turn_r - M.turn_l), -0.6, 0.6);
}

function urgesHz() {
  const L = (k) => clamp(mind.level[k] + (mind.extra[k] || 0), 0, 1);
  const tl = L("turn_l") + Math.max(mind.trim, 0), tr = L("turn_r") + Math.max(-mind.trim, 0);
  return {
    u_walk: Math.round(L("walk") * 80), u_turn_l: Math.round(clamp(tl, 0, 1) * 45), u_turn_r: Math.round(clamp(tr, 0, 1) * 45),
    u_back: Math.round(L("back") * 100), u_groom: Math.round(L("groom") * 100), u_probe: Math.round(L("probe") * 90),
    u_takeoff: Math.round(L("takeoff") * 120),
  };
}

function senses() {
  const s = {};
  const it = F.at;
  if (it && (F.mode === "taste" || F.mode === "feed")) {
    if (it.type === "sugar") s.sugar = Math.round(40 + 160 * (1 - F.energy));      // hunger raises sugar-neuron gain
    if (it.type === "water") s.water = Math.round(120 + 240 * (1 - F.water));      // thirst raises water-neuron gain
    if (it.type === "bitter") { s.bitter = 200; s.sugar = 120; }                   // fruity, but bitter
  }
  if (now < F.touchUntil) s.touch = 150;
  // looming: expansion of each predator's angular size, split by which eye sees it
  for (const p of predators) {
    const dx = p.g.position.x - F.x, dy = p.g.position.y - (F.y + 0.3), dz = p.g.position.z - F.z;
    const r = Math.hypot(dx, dy, dz), ang = 2 * Math.atan(2.5 / r);
    if (p.lastAng != null) {
      const rate = (ang - p.lastAng) / Math.max(now - p.lastT, 0.01);
      if (rate > 0.05 && r < 30) {
        const side = dx * Math.cos(F.heading) - dz * Math.sin(F.heading);   // dot with the fly's left vector
        const hz = Math.round(clamp(rate * 160, 0, 180));
        if (side > 0.6) s.loom_l = Math.max(s.loom_l || 0, hz);
        else if (side < -0.6) s.loom_r = Math.max(s.loom_r || 0, hz);
        else { s.loom_l = Math.max(s.loom_l || 0, hz); s.loom_r = Math.max(s.loom_r || 0, hz); }
        F.loomAt = now;
      }
    }
    p.nextAng = ang;
  }
  return s;
}

const why = (k, fallback) => mind.level[k] > 0.25 ? `its own urge to ${URGES[k].label}` : fallback;
let now = 0;
function updateFly(dt) {
  F.modeT += dt;
  updateMind(dt);
  const turnBrain = clamp((M.turn_l - M.turn_r) * 0.016, -3.2, 3.2);    // DNa02: ipsilateral turning, rad/s per Hz
  const weak = clamp(F.energy * 2.2, 0.12, 1);
  const inHell = realm === "hell";
  F.energy = clamp(F.energy - dt * (0.0015 + (F.mode === "fly" ? 0.006 : Math.abs(F.speed) > 0.1 ? 0.002 : 0)) * (inHell ? 2 : 1), 0, 1);
  F.water = clamp(F.water - dt * 0.002 * (inHell ? 3 : 1), 0, 1);
  const move = () => { F.x += Math.sin(F.heading) * F.speed * dt; F.z += Math.cos(F.heading) * F.speed * dt; };

  // --- takeoff: the Giant Fiber, whether a shadow or its own urge drove it
  const escape = now - (F.loomAt || -9) < 1.5;
  if (F.mode !== "fly" && M.gf > (escape ? 35 : 50)) {
    setMode("fly"); F.vy = escape ? 4.5 : 3; F.speed = escape ? 6 : 3; F.at = null;
    F.flightKind = escape ? "escape" : "free"; F.escapeHz = M.gf;
    F.flightLeft = escape ? rand(3, 6) : inHell ? rand(2, 4) : rand(5, 12);
    if (escape) F.stats.escapes++; else F.stats.flights++;
  }
  if (F.mode === "fly") {
    F.flightLeft -= dt;
    const landing = F.flightLeft <= 0;
    const goal = F.flightKind === "escape" ? 4.5 : 4 + 3 * Math.sin(now * 0.35 + F.x * 0.05);
    F.heading += turnBrain * 0.8 * dt;
    F.speed += ((F.flightKind === "escape" ? 6 : 4.5) * weak - F.speed) * dt;
    F.vy += (((landing ? 0 : goal) - F.y) * 1.6 - F.vy) * dt * 2;
    F.y = Math.max(0, F.y + F.vy * dt);
    move();
    if (landing && F.y < 0.05) { F.y = 0; F.vy = 0; F.speed = 0; setMode("walk"); }
    if (F.flightKind === "escape") setDoing("brain", "Escape flight!", `Giant Fiber fired ${Math.max(F.escapeHz, M.gf).toFixed(0)} Hz at the looming shadow`);
    else if (Math.abs(turnBrain) > 0.4) setDoing("brain", turnBrain > 0 ? "Banking left" : "Banking right", "DNa02 steering neurons, mid-air");
    else setDoing("brain", realm === "heaven" ? "Flying free" : "Flying", landing ? "coming in to land" : `it decided to fly: Giant Fiber ${F.escapeHz.toFixed(0)} Hz from its own urge`);
    return;
  }

  // --- tasting and feeding (MN9 decides)
  if (F.mode === "taste" || F.mode === "feed") {
    const it = F.at; F.speed = 0;
    if (!it || !items.includes(it)) { setMode("walk"); F.at = null; return; }
    if (F.mode === "taste") {
      setDoing("body", "Tasting…", `taste neurons touch the ${it.type === "water" ? "water" : it.type === "bitter" ? "berry" : it.kind === "fruit" ? "fruit" : "sugar"}`);
      if (M.mn9 > 12) setMode("feed");
      else if (F.modeT > 0.9) {
        it.rejectUntil = now + 20; if (it.type === "bitter") F.stats.refused++;
        F.heading += Math.PI * rand(0.6, 1.2); setMode("walk"); F.at = null;
        setDoing("brain", it.type === "bitter" ? "Refuses the bitter berry" : "Not interested", "MN9 stayed silent, so the proboscis never came out");
        F.lastNote = now;
      }
      return;
    }
    const rate = clamp(M.mn9 / 60, 0.2, 1.4) * dt * 0.22;
    if (!it.endless) it.amount -= rate;
    if (it.type === "sugar") { F.energy = clamp(F.energy + rate * 1.4, 0, 1); F.stats.sugar += rate; }
    if (it.type === "water") { F.water = clamp(F.water + rate * 1.6, 0, 1); F.stats.water += rate; }
    if (!it.endless) { const sc = clamp(it.amount, 0.15, 1); it.mesh.scale.set(it.base.x * sc, it.base.y * sc, it.base.z * sc); }
    setDoing("brain", it.type === "water" ? "Drinking" : "Eating sugar", `MN9 at ${M.mn9.toFixed(0)} Hz extends the proboscis`);
    if (M.mn9 < 4 && F.modeT > 0.6) { setMode("walk"); it.rejectUntil = now + 8; F.at = null; }
    if (it.amount <= 0.02) { removeItem(it); setMode("walk"); F.at = null; if (realm === "heaven") setTimeout(() => respawn(it), 15000); }
    return;
  }

  // --- grooming, backing up, probing: straight from the command neurons
  if (M.groom > 7 && F.mode !== "groom") { setMode("groom"); F.stats.grooms++; }
  if (F.mode === "groom") {
    F.speed = 0;
    const cause = now - F.touchUntil < 2 ? "something touched its antenna" : why("groom", "");
    setDoing("brain", "Cleaning its antennae", `aDN1/aBN1 at ${M.groom.toFixed(0)} Hz${cause ? " · " + cause : ""}`);
    if (F.modeT > 1.2 && M.groom < 3) setMode("walk");
    return;
  }
  if (M.mdn > 15) {
    F.speed = -0.7 * weak; move(); F.heading += turnBrain * dt;
    setDoing("brain", "Backing up", `MDN moonwalker neurons at ${M.mdn.toFixed(0)} Hz · ${why("back", "")}`);
    return;
  }
  setMode("walk");
  // arrived at something it wants: stop and taste
  if (F.target && Math.hypot(F.target.x - F.x, F.target.z - F.z) < (F.target.reach || 0.55)) { F.at = F.target; setMode("taste"); return; }
  if (M.mn9 > 12) {
    F.speed *= 0.8;
    setDoing("brain", "Probing with its proboscis", `MN9 at ${M.mn9.toFixed(0)} Hz · ${why("probe", "its feeding circuit keeps itself going for a moment")}`);
    return;
  }

  // --- walking speed from DNp09, steering from DNa02
  F.heading += turnBrain * dt;
  const v = clamp(M.walk / 70, 0, 1.25) * (inHell ? 1.1 : 1.7) * weak;
  F.speed += (v - F.speed) * dt * 3;
  move();
  if (F.energy <= 0.02 && M.walk < 5) setDoing("body", "Exhausted", inHell ? "Nothing to eat in hell. It can barely move." : "Out of energy");
  else if (M.walk < 5 && Math.abs(turnBrain) < 0.4) setDoing("brain", inHell ? "Sitting in the ashes" : "Resting", "its walking neurons (DNp09) are quiet");
  else if (!F.lastNote || now - F.lastNote > 2) {
    const goal = mind.focus === "edge" ? "turning back from the edge"
      : mind.focus ? `smells ${mind.focus === "water" ? "water" : mind.focus === "bitter" ? "ripe fruit" : "sugar"}, so it wants to turn that way`
      : why("walk", "wandering");
    const turning = Math.abs(turnBrain) > 0.5 ? (turnBrain > 0 ? "Turning left" : "Turning right") : inHell ? "Wandering the ashes" : "Walking";
    setDoing("brain", turning, `DNp09 ${M.walk.toFixed(0)} Hz, DNa02 L/R ${M.turn_l.toFixed(0)}/${M.turn_r.toFixed(0)} · ${goal}`);
  }
}
function respawn(it) {
  if (realm !== "heaven") return;
  if (it.type === "sugar") addItem("sugar", it.x, it.z, 1, it.fruit);          // nectar refills, fruit regrows
  else { const a = rand(0, 6.28), r = rand(4, 40); addItem(it.type, Math.cos(a) * r, Math.sin(a) * r, 1); }
}

// ======================================================================= animating the fly
function animateFly(dt, t) {
  const { body, head, ants, prob, wings, legs } = fly.userData;
  fly.position.set(F.x, F.y, F.z);
  fly.rotation.y = F.heading;
  const flying = F.mode === "fly" && F.y > 0.02;
  const standH = 0.3;
  body.position.y = standH + (flying ? 0 : Math.sin(t * 20) * 0.004 * Math.abs(F.speed));
  body.rotation.x = flying ? -0.15 : F.mode === "feed" ? 0.12 : 0;
  // wings
  for (const w of wings) {
    if (flying) {
      w.g.rotation.set(Math.sin(t * 95) * 0.25, w.s * 0.25, w.s * (0.2 + Math.sin(t * 95 + 1) * 0.75));
    } else {
      w.g.rotation.set(0, w.s * 1.27, w.s * -0.08);          // folded back over the abdomen
    }
  }
  // proboscis
  const pt = F.mode === "feed" ? 1 : F.mode === "taste" ? 0.35 : 0;
  prob.scale.y += (0.25 + pt * 0.9 - prob.scale.y) * Math.min(1, dt * 8);
  prob.rotation.x = 0.5 - pt * 0.35;
  // antennae
  ants.forEach((a, i) => { a.rotation.x = 0.7 + (F.mode === "groom" ? Math.sin(t * 22 + i) * 0.35 : Math.sin(t * 2 + i) * 0.05); });
  head.rotation.x = F.mode === "groom" ? 0.35 + Math.sin(t * 11) * 0.08 : F.mode === "feed" ? 0.25 : 0;
  // legs: tripod gait, grooming front legs, tucked in flight
  F.phase += dt * Math.abs(F.speed) * 6.5 * Math.sign(F.speed || 1);
  const groundY = -standH;
  for (const L of legs) {
    const f = L.foot;
    if (flying) {
      f.set(L.rest.x * 0.35, -0.22 - L.k * 0.02, L.rest.z * 0.55 - 0.05);
    } else if (F.mode === "groom" && L.k === 0) {
      f.set(0.05 * L.s + Math.sin(t * 18) * 0.03 * L.s, 0.06 + Math.sin(t * 18 + L.s) * 0.05, 0.34);
    } else {
      const ph = F.phase / Math.PI + L.tripod;
      const cyc = ((ph % 2) + 2) % 2;          // 0..1 stance, 1..2 swing
      const stride = clamp(Math.abs(F.speed) * 0.12, 0, 0.16);
      let dz, lift = 0;
      if (cyc < 1) dz = stride * (0.5 - cyc); else { dz = stride * (cyc - 1.5); lift = Math.sin((cyc - 1) * Math.PI) * 0.07 * (stride > 0.01); }
      f.set(L.rest.x, groundY + lift, L.rest.z + dz);
    }
    const knee = L.hip.clone().lerp(f, 0.45); knee.y = Math.max(L.hip.y, f.y) + 0.14; knee.x += 0.06 * L.s;
    const ankle = knee.clone().lerp(f, 0.72);
    setSeg(L.segs[0], L.hip, knee); setSeg(L.segs[1], knee, ankle); setSeg(L.segs[2], ankle, f);
  }
}

// ======================================================================= particles
function initParticles(p, spawn) {
  const { pos, vel, n } = p.userData;
  for (let i = 0; i < n; i++) spawn(pos, vel, i, true);
  p.userData.spawn = spawn;
}
function updateParticles(p, dt) {
  const { pos, vel, n, spawn } = p.userData;
  for (let i = 0; i < n; i++) {
    pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    const y = pos[i * 3 + 1];
    if (y < 0 || y > 30 || Math.hypot(pos[i * 3] - F.x, pos[i * 3 + 2] - F.z) > 30) spawn(pos, vel, i, false);
  }
  p.geometry.attributes.position.needsUpdate = true;
}
const around = (pos, i, r, y0, y1) => { const a = rand(0, 6.28), d = Math.sqrt(Math.random()) * r; pos[i * 3] = F.x + Math.cos(a) * d; pos[i * 3 + 1] = rand(y0, y1); pos[i * 3 + 2] = F.z + Math.sin(a) * d; };
initParticles(motes, (pos, vel, i) => { around(pos, i, 28, 0.3, 12); vel[i * 3] = rand(-0.2, 0.2); vel[i * 3 + 1] = rand(0.05, 0.3); vel[i * 3 + 2] = rand(-0.2, 0.2); });
initParticles(petals, (pos, vel, i, first) => { around(pos, i, 26, first ? 0 : 10, 14); vel[i * 3] = rand(0.3, 0.9); vel[i * 3 + 1] = -rand(0.3, 0.7); vel[i * 3 + 2] = rand(-0.3, 0.3); });
initParticles(ash, (pos, vel, i, first) => { around(pos, i, 26, first ? 0 : 12, 16); vel[i * 3] = rand(-0.4, 0.4); vel[i * 3 + 1] = -rand(0.5, 1.4); vel[i * 3 + 2] = rand(-0.4, 0.4); });
initParticles(embers, (pos, vel, i, first) => { around(pos, i, 26, 0, first ? 14 : 0.3); vel[i * 3] = rand(-0.3, 0.3); vel[i * 3 + 1] = rand(0.6, 2); vel[i * 3 + 2] = rand(-0.3, 0.3); });

// a single ash flake / petal that lands on the antennae (the touch stimulus)
const flake = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: "#888" }));
flake.visible = false; scene.add(flake);
function dropFlake() {
  flake.material.color.set(realm === "hell" ? "#7a7672" : "#ffc6e2");
  flake.visible = true; flake.userData.t = 0;
  flake.position.set(F.x + rand(-0.4, 0.4), F.y + 4, F.z + rand(-0.4, 0.4));
}
function updateFlake(dt) {
  if (!flake.visible) return;
  const headW = new THREE.Vector3(); fly.userData.head.getWorldPosition(headW);
  flake.userData.t += dt;
  flake.position.lerp(headW.add(new THREE.Vector3(0, 0.12, 0)), Math.min(1, dt * 2.2));
  if (flake.position.distanceTo(headW) < 0.15 || flake.userData.t > 3) {
    flake.visible = false; F.touchUntil = now + 0.35;
  }
}

// ======================================================================= camera
const cam = { yaw: 0, pitch: 0.32, dist: 4.2, mode: "follow", drag: null, pos: new THREE.Vector3(0, 2, -5) };
canvas.addEventListener("pointerdown", (e) => { cam.drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (!cam.drag) return;
  cam.yaw -= (e.clientX - cam.drag[0]) * 0.006; cam.pitch = clamp(cam.pitch + (e.clientY - cam.drag[1]) * 0.005, -0.1, 1.45);
  cam.drag = [e.clientX, e.clientY];
});
canvas.addEventListener("pointerup", () => (cam.drag = null));
canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.dist = clamp(cam.dist * (1 + e.deltaY * 0.001), 1.2, 40); }, { passive: false });
const CAMS = ["follow", "cinematic", "wide"];
$("#cam").onclick = () => {
  cam.mode = CAMS[(CAMS.indexOf(cam.mode) + 1) % CAMS.length];
  $("#cam").textContent = `Camera: ${cam.mode}`;
  if (cam.mode === "wide") cam.dist = 18; else if (cam.dist > 10) cam.dist = 4.2;
};
function updateCamera(dt, t) {
  const target = new THREE.Vector3(F.x, F.y + 0.35, F.z);
  let yaw = F.heading + Math.PI + cam.yaw;
  if (cam.mode === "cinematic") yaw = t * 0.15 + cam.yaw;
  const d = cam.dist;
  const want = new THREE.Vector3(target.x + Math.sin(yaw) * Math.cos(cam.pitch) * d, target.y + Math.sin(cam.pitch) * d, target.z + Math.cos(yaw) * Math.cos(cam.pitch) * d);
  want.y = Math.max(want.y, 0.25);
  cam.pos.lerp(want, 1 - Math.exp(-dt * 3));
  camera.position.copy(cam.pos);
  camera.lookAt(target);
  sun.position.set(F.x - 20, 30, F.z - 12); sun.target.position.set(F.x, 0, F.z);
  sky.position.copy(camera.position);
}

// ======================================================================= mini brain view
const mini = (() => {
  const c = $("#mini");
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  const sc = new THREE.Scene(), cm = new THREE.PerspectiveCamera(35, 2, 1, 5000);
  let glow = null, pts = null, n = 0;
  fetch("/api/brain.bin").then((x) => x.arrayBuffer()).then((buf) => {
    n = buf.byteLength / 13;
    const xyz = new Float32Array(buf, 0, n * 3), pos = new Float32Array(n * 3);
    let cx = 0, cy = 0, cz = 0, k = 0;
    for (let i = 0; i < n; i++) if (xyz[i * 3]) { cx += xyz[i * 3]; cy += xyz[i * 3 + 1]; cz += xyz[i * 3 + 2]; k++; }
    cx /= k; cy /= k; cz /= k;
    for (let i = 0; i < n; i++) {
      const ok = xyz[i * 3] !== 0;
      pos[i * 3] = ok ? xyz[i * 3] - cx : 1e5; pos[i * 3 + 1] = ok ? -(xyz[i * 3 + 1] - cy) : 1e5; pos[i * 3 + 2] = ok ? -(xyz[i * 3 + 2] - cz) : 1e5;
    }
    glow = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("glow", new THREE.BufferAttribute(glow, 1));
    pts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float glow; varying float vg; void main(){ vg = glow; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * mv; gl_PointSize = (1.3 + 7.0 * glow) * (900.0 / -mv.z); }`,
      fragmentShader: `varying float vg; void main(){ vec2 d = gl_PointCoord - 0.5; if (dot(d,d) > 0.25) discard;
        vec3 c = mix(vec3(0.22,0.2,0.55), vec3(1.0,0.85,0.4), vg); gl_FragColor = vec4(c, 0.22 + 0.78 * vg); }`,
    }));
    sc.add(pts);
  });
  return {
    fire(idx) { if (glow) for (const i of idx) glow[i] = 1; },
    draw(dt, t) {
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.floor(w * r.getPixelRatio())) { r.setSize(w, h, false); cm.aspect = w / h; cm.updateProjectionMatrix(); }
      if (glow) { const k = Math.exp(-dt / 0.12); for (let i = 0; i < n; i++) if (glow[i] > 0.01) glow[i] *= k; else glow[i] = 0; pts.geometry.attributes.glow.needsUpdate = true; }
      const yaw = Math.sin(t * 0.2) * 0.5;
      cm.position.set(Math.sin(yaw) * 1150, 80, Math.cos(yaw) * 1150); cm.lookAt(0, 0, 0);
      r.render(sc, cm);
    },
  };
})();

// ======================================================================= brain loop (closed loop with the server)
const METERS = [["walk", "DNp09 · walk", 90], ["mn9", "MN9 · eat", 80], ["groom", "aDN1 · groom", 40], ["gf", "Giant Fiber", 120], ["mdn", "MDN · back", 40], ["turn_l", "DNa02 left", 50], ["turn_r", "DNa02 right", 50]];
$("#meters").innerHTML = METERS.map(([k, l]) => `<div class="meter"><span>${l}</span><span class="m"><i id="m_${k}"></i></span><span class="hz" id="h_${k}">0</span></div>`).join("");
const SENSE_LABELS = { sugar: "sugar", bitter: "bitter", water: "water", touch: "antenna touch", loom_l: "shadow L", loom_r: "shadow R" };
$("#mind").innerHTML = Object.entries(URGES).map(([k, U]) => `<div class="urge"><span>${U.label}</span><span class="m"><i id="u_${k}"></i></span></div>`).join("");
$("#senses").innerHTML = Object.entries(SENSE_LABELS).map(([k, l]) => `<span id="s_${k}">${l}</span>`).join("");

let brainSpeed = 1, connected = false;
async function brainLoop() {
  let brainT = 0, wall0 = performance.now();
  for (;;) {
    if (document.hidden) { await new Promise((r) => setTimeout(r, 250)); wall0 = performance.now() - brainT; continue; }   // pause with the page
    const s = senses();
    lastSenses = s;
    for (const p of predators) { p.lastAng = p.nextAng; p.lastT = now; }
    const t0 = performance.now();
    const stop = [...mind.stop]; mind.stop.clear();
    let res;
    try {
      res = await (await fetch("/api/step", { method: "POST", body: JSON.stringify({ senses: s, urges: urgesHz(), stop, ms: CHUNK }) })).json();
      if (res.error) throw new Error(res.error);
      connected = true;
    } catch (e) {
      connected = false; $("#brainSpeed").textContent = "brain offline"; await new Promise((r) => setTimeout(r, 1000)); continue;
    }
    const k = 1 - Math.exp(-CHUNK / 140);
    for (const key in M) M[key] += ((res.rates[key] || 0) - M[key]) * k;
    const fired = new Int32Array(Uint8Array.from(atob(res.fired), (c) => c.charCodeAt(0)).buffer);
    mini.fire(fired);
    brainSpeed += (CHUNK / Math.max(performance.now() - t0, 1) - brainSpeed) * 0.15;
    brainT += CHUNK;
    const ahead = brainT - (performance.now() - wall0);
    if (ahead > 0) await new Promise((r) => setTimeout(r, ahead));
    else if (ahead < -300) wall0 = performance.now() - brainT;    // brain slower than real time: don't pile up
    hud.spikes = res.spikes;
    if (res.reset) hud.resetAt = now;
  }
}

// ======================================================================= HUD
const hud = { t: 0, spikes: 0 };
function updateHud(dt) {
  hud.t += dt; if (hud.t < 0.12) return; hud.t = 0;
  for (const [k, , full] of METERS) { $(`#m_${k}`).style.width = `${clamp(M[k] / full, 0, 1) * 100}%`; $(`#h_${k}`).textContent = M[k].toFixed(0); }
  for (const k in URGES) $(`#u_${k}`).style.width = `${clamp(mind.level[k] + (mind.extra?.[k] || 0), 0, 1) * 100}%`;
  for (const k in SENSE_LABELS) { const el = $(`#s_${k}`); el.classList.toggle("on", !!lastSenses[k]); el.textContent = lastSenses[k] ? `${SENSE_LABELS[k]} ${lastSenses[k]}` : SENSE_LABELS[k]; }
  if (connected && now - (hud.resetAt || -99) < 4) $("#brainSpeed").textContent = "runaway activity stopped, brain back at rest";
  else if (connected) $("#brainSpeed").textContent = `${brainSpeed >= 1 ? "real time" : `${brainSpeed.toFixed(2)}× real time`} · ${(hud.spikes * 1000 / CHUNK / 1000).toFixed(1)}k spikes/s`;
  const tag = $("#tag"); tag.className = `tag ${doing.tag}`; tag.textContent = doing.tag;
  $("#doing").textContent = doing.text; $("#why").textContent = doing.why;
  $("#energy").style.width = `${F.energy * 100}%`; $("#water").style.width = `${F.water * 100}%`;
  const S = F.stats;
  $("#stats").innerHTML = [["sugar eaten", S.sugar.toFixed(1)], ["water drunk", S.water.toFixed(1)], ["refused", S.refused],
    ["grooms", S.grooms], ["escapes", S.escapes], ["free flights", S.flights]].map(([l, v]) => `<span><b>${v}</b>${l}</span>`).join("");
}

// ======================================================================= controls
$("#toHeaven").onclick = () => switchRealm("heaven");
$("#toHell").onclick = () => switchRealm("hell");
const inFront = (d = 1.6) => [F.x + Math.sin(F.heading) * d, F.z + Math.cos(F.heading) * d];
$("#dropSugar").onclick = () => { const [x, z] = inFront(); addItem("sugar", x, z, 1, "cube"); };
$("#dropWater").onclick = () => { const [x, z] = inFront(); addItem("water", x, z, 1); };
$("#dropBitter").onclick = () => { const [x, z] = inFront(); addItem("bitter", x, z, 1); };
$("#puff").onclick = () => { F.touchUntil = now + 0.4; };
$("#shadow").onclick = () => spawnPredator();

// ======================================================================= main loop
let last = performance.now(), nextFlake = 6, nextPredator = 10;
function frame(t) {
  const dt = Math.min((t - last) / 1000, 0.05); last = t; now = t / 1000;
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

  nextFlake -= dt; if (nextFlake < 0) { dropFlake(); nextFlake = realm === "hell" ? rand(5, 9) : rand(12, 20); }
  if (realm === "hell") { nextPredator -= dt; if (nextPredator < 0) { spawnPredator(); nextPredator = rand(9, 15); } }
  if (realm === "heaven") {
    updateParticles(motes, dt); updateParticles(petals, dt);
    H.update(now, dt);
    for (const it of items) if (it.type === "sugar" && it.mesh.material === MATS.sugar) it.mesh.position.y = 0.04 + Math.sin(now * 2 + it.x) * 0.01;
  } else {
    updateParticles(ash, dt); updateParticles(embers, dt);
    hell.userData.lava.position.set(F.x, 2, F.z); hell.userData.lava.intensity = 50 + Math.sin(now * 3) * 12;
  }
  updatePredators(dt);
  updateFlake(dt);
  updateFly(dt);
  animateFly(dt, now);
  updateCamera(dt, now);
  renderer.render(scene, camera);
  mini.draw(dt, now);
  updateHud(dt);
  requestAnimationFrame(frame);
}
applyRealm("heaven");
requestAnimationFrame(frame);
brainLoop();
