// Heaven: a golden meadow at fly scale. Swaying grass, giant flowers, blossom trees, a pond, fruit,
// butterflies, floating islands with waterfalls, a rainbow and light rays.
import * as THREE from "three";

export function buildHeaven({ canvasTex, rand }) {
  const g = new THREE.Group();
  const time = { value: 0 };
  const flowers = [], butterflies = [], islands = [], clouds = [], rays = [], swayers = [];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const polar = (r0, r1) => { const r = rand(r0, r1), a = rand(0, Math.PI * 2); return [Math.cos(a) * r, Math.sin(a) * r]; };
  const pond = { x: 22, z: -16, r: 6.5 };
  const nearPond = (x, z, pad = 2) => Math.hypot(x - pond.x, z - pond.z) < pond.r + pad;
  const spot = (r0, r1, pad) => { for (;;) { const [x, z] = polar(r0, r1); if (!nearPond(x, z, pad)) return [x, z]; } };
  const sway = (mat, amount = 0.12) => {          // wind in the vertex shader (instanced meshes)
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.time = time;
      sh.vertexShader = "uniform float time;\nvarying float vH;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        vH = position.y;
        vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float w = sin(time * 1.7 + wp.x * 0.35 + wp.z * 0.25) * 0.6 + sin(time * 0.8 + wp.x * 0.11) * 0.4;
        transformed.x += w * ${amount.toFixed(3)} * position.y * position.y;
        transformed.z += cos(time * 1.3 + wp.z * 0.3) * ${(amount * 0.4).toFixed(3)} * position.y * position.y;`);
      sh.fragmentShader = "varying float vH;\n" + sh.fragmentShader.replace("#include <color_fragment>",
        "#include <color_fragment>\n diffuseColor.rgb *= mix(0.5, 1.2, clamp(vH / 0.8, 0.0, 1.0));");
    };
    return mat;
  };

  // ---------------------------------------------------------------- ground
  const groundTex = canvasTex(1024, 1024, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#8ccf6a"); gr.addColorStop(1, "#7cc35e");
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {            // soft light and shade patches
      const x = rand(0, w), y = rand(0, h), r = rand(60, 200);
      const rg = c.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, Math.random() < 0.5 ? "rgba(255,240,170,.18)" : "rgba(40,90,30,.16)"); rg.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = rg; c.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < 26000; i++) {
      c.fillStyle = `hsl(${rand(78, 118)},${rand(40, 62)}%,${rand(34, 60)}%)`;
      c.fillRect(rand(0, w), rand(0, h), rand(1, 2.5), rand(2, 6));
    }
    for (let i = 0; i < 900; i++) {           // specks of tiny flowers
      c.fillStyle = pick(["#ffffff", "#fff4a0", "#ffc8e6", "#c9d8ff"]);
      c.beginPath(); c.arc(rand(0, w), rand(0, h), rand(1, 2.2), 0, 7); c.fill();
    }
  }, 9);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(170, 72), new THREE.MeshLambertMaterial({ map: groundTex }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  g.add(ground);

  // ---------------------------------------------------------------- grass (two layers, swaying)
  function grassLayer(n, h, rMax, hue) {
    const blade = new THREE.PlaneGeometry(0.075, h, 1, 4);
    const p = blade.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + h / 2;
      p.setY(i, y); p.setX(i, p.getX(i) * (1 - y / (h * 1.05))); p.setZ(i, y * y * 0.18);
    }
    const mesh = new THREE.InstancedMesh(blade, sway(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      let x, z; do { const r = Math.sqrt(Math.random()) * rMax, a = rand(0, Math.PI * 2); x = Math.cos(a) * r; z = Math.sin(a) * r; } while (nearPond(x, z, 0.3));
      q.setFromEuler(new THREE.Euler(rand(-0.18, 0.18), rand(0, Math.PI * 2), 0));
      const s = rand(0.6, 1.5);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * rand(0.8, 1.3), s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHSL(rand(hue[0], hue[1]), rand(0.45, 0.7), rand(0.38, 0.55)));
    }
    return mesh;
  }
  g.add(grassLayer(17000, 0.75, 62, [0.22, 0.31]), grassLayer(9000, 1.3, 55, [0.17, 0.27]));

  // carpet of tiny wildflowers
  {
    const petal = new THREE.PlaneGeometry(0.22, 0.22); petal.rotateX(-Math.PI / 2);
    const tex = canvasTex(64, 64, (c) => {
      c.fillStyle = "#ffffff";
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; c.beginPath(); c.ellipse(32 + Math.cos(a) * 14, 32 + Math.sin(a) * 14, 12, 8, a, 0, 7); c.fill(); }
      c.fillStyle = "#ffd23a"; c.beginPath(); c.arc(32, 32, 7, 0, 7); c.fill();
    });
    const n = 3500, mesh = new THREE.InstancedMesh(petal, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    const cols = ["#ffffff", "#fff3a0", "#ffc4e1", "#c7d6ff", "#ffd7a8", "#e8c8ff"];
    for (let i = 0; i < n; i++) {
      const [x, z] = spot(0, 60, 0.5);
      q.setFromEuler(new THREE.Euler(rand(-0.3, 0.3), rand(0, 6.3), rand(-0.3, 0.3)));
      m.compose(new THREE.Vector3(x, rand(0.12, 0.4), z), q, new THREE.Vector3(1, 1, 1).multiplyScalar(rand(0.6, 1.2)));
      mesh.setMatrixAt(i, m); mesh.setColorAt(i, c.set(pick(cols)));
    }
    g.add(mesh);
  }

  // ---------------------------------------------------------------- giant flowers
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
  const stemMat = std("#4f9a3e"), leafMat = std("#5fae48");
  function stem(f, h, bend = 0) {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(bend, h * 0.5, 0), new THREE.Vector3(bend * 0.6, h, 0));
    const s = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.08, 6), stemMat); s.castShadow = true; f.add(s);
    for (let k = 0; k < 2; k++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6), leafMat);
      leaf.scale.set(0.8, 0.04, 0.25); leaf.position.set(k ? 0.55 : -0.55, h * rand(0.2, 0.45), 0); leaf.rotation.z = k ? -0.5 : 0.5;
      leaf.castShadow = true; f.add(leaf);
    }
    return new THREE.Vector3(bend * 0.6, h, 0);
  }
  function daisy(f) {
    const top = stem(f, rand(2.5, 5.5), rand(-0.4, 0.4)), head = new THREE.Group(); head.position.copy(top); head.rotation.x = rand(-0.4, 0.4); f.add(head);
    const n = Math.floor(rand(12, 18)), col = pick(["#ffffff", "#fff8e6", "#ffd1e8", "#d9c8ff"]);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6), std(col)); const a = (k / n) * Math.PI * 2;
      p.scale.set(0.85, 0.05, 0.2); p.position.set(Math.cos(a) * 0.95, Math.sin(k) * 0.03, Math.sin(a) * 0.95); p.rotation.y = -a; p.castShadow = true; head.add(p);
    }
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10), std("#ffbe2e", { emissive: "#a35a00", emissiveIntensity: 0.35 })); c.scale.y = 0.5; head.add(c);
    return head;
  }
  function tulip(f) {
    const top = stem(f, rand(2.2, 4), rand(-0.2, 0.2)), head = new THREE.Group(); head.position.copy(top); f.add(head);
    const col = pick(["#ff4f6a", "#ff8fb1", "#ffd23f", "#ff7a3c", "#c56bff"]);
    for (let k = 0; k < 6; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI), std(col, { side: THREE.DoubleSide, roughness: 0.45 }));
      p.scale.set(0.55, 1.25, 0.35); const a = (k / 6) * Math.PI * 2;
      p.position.set(Math.cos(a) * 0.18, 0.45, Math.sin(a) * 0.18); p.rotation.y = -a + Math.PI / 2; p.rotation.z = Math.cos(a) * 0.2; p.rotation.x = Math.sin(a) * 0.2;
      p.castShadow = true; head.add(p);
    }
    return head;
  }
  function sunflower(f) {
    const top = stem(f, rand(5.5, 8), rand(-0.6, 0.6)), head = new THREE.Group(); head.position.copy(top); head.rotation.x = -0.9; head.rotation.z = rand(-0.3, 0.3); f.add(head);
    const seeds = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = "#4a2a10"; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 700; i++) { const a = i * 2.39996, r = Math.sqrt(i) * 4.6; c.fillStyle = i % 3 ? "#6b3d16" : "#2c1607"; c.beginPath(); c.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 3, 0, 7); c.fill(); }
    });
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 28), [std("#3a210c"), std("#fff", { map: seeds }), std("#3a210c")]);
    head.add(disk);
    for (let ring = 0; ring < 2; ring++) for (let k = 0; k < 22; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), std(ring ? "#ffd21f" : "#ffbf00"));
      const a = (k / 22) * Math.PI * 2 + ring * 0.14;
      p.scale.set(0.75, 0.05, 0.2); p.position.set(Math.cos(a) * (1.5 - ring * 0.1), 0.02 + ring * 0.03, Math.sin(a) * (1.5 - ring * 0.1)); p.rotation.y = -a; p.castShadow = true; head.add(p);
    }
    return head;
  }
  function bluebell(f) {
    const h = rand(2.5, 4), top = stem(f, h, 0.9), head = new THREE.Group(); f.add(head);
    const col = pick(["#7a8cff", "#9d7bff", "#b6c4ff"]);
    for (let k = 0; k < 6; k++) {
      const b = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 12, 1, true), std(col, { side: THREE.DoubleSide }));
      b.position.set(top.x * (0.3 + k * 0.12) + 0.15, h * (0.55 + k * 0.07) - 0.3, rand(-0.1, 0.1)); b.rotation.z = Math.PI + rand(-0.3, 0.3);
      b.castShadow = true; head.add(b);
    }
    return head;
  }
  const kinds = [daisy, daisy, daisy, tulip, tulip, sunflower, bluebell];
  for (let i = 0; i < 46; i++) {
    const f = new THREE.Group(), kind = kinds[i % kinds.length];
    const head = kind(f);
    const [x, z] = spot(6, 48, 1.5);
    f.position.set(x, 0, z); f.rotation.y = rand(0, 6.3);
    f.userData = { sway: rand(0, 10), head, kind: kind.name };
    g.add(f); flowers.push(f); swayers.push(f);
  }

  // ---------------------------------------------------------------- mushrooms and pebbles
  const dots = canvasTex(256, 128, (c, w, h) => {
    c.fillStyle = "#e0323a"; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 22; i++) { c.fillStyle = "#fff7ec"; c.beginPath(); c.arc(rand(0, w), rand(0, h * 0.8), rand(5, 11), 0, 7); c.fill(); }
  });
  for (let i = 0; i < 9; i++) {
    const cl = new THREE.Group(); const [x, z] = spot(8, 45, 1);
    for (let k = 0; k < Math.floor(rand(2, 5)); k++) {
      const s = rand(0.6, 1.4), m = new THREE.Group();
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.17 * s, 0.7 * s, 10), std("#fff6e6")); st.position.y = 0.35 * s; m.add(st);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.45 * s, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), std("#fff", { map: dots, roughness: 0.4 }));
      cap.position.y = 0.66 * s; cap.scale.y = 0.7; m.add(cap);
      m.position.set(rand(-0.8, 0.8), 0, rand(-0.8, 0.8)); m.rotation.z = rand(-0.15, 0.15);
      m.traverse((o) => { if (o.isMesh) o.castShadow = true; }); cl.add(m);
    }
    cl.position.set(x, 0, z); g.add(cl);
  }
  const pebbleMat = std("#c9c1b2", { roughness: 0.9, flatShading: true });
  for (let i = 0; i < 40; i++) {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.15, 0.5), 0), pebbleMat);
    const [x, z] = spot(3, 50, 0.8); p.position.set(x, 0.05, z); p.scale.y = 0.5; p.rotation.y = rand(0, 6); p.receiveShadow = true; g.add(p);
  }

  // ---------------------------------------------------------------- pond with lily pads, lotus and reeds
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, uniforms: { time },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float time;
      void main(){ vec2 p = vUv - 0.5; float d = length(p) * 2.0;
        float rip = sin(d * 38.0 - time * 2.2) * 0.5 + 0.5;
        float wave = sin(p.x * 30.0 + time * 1.3) * sin(p.y * 26.0 - time * 1.1);
        vec3 deep = vec3(0.12, 0.45, 0.62), shallow = vec3(0.55, 0.86, 0.92);
        vec3 c = mix(deep, shallow, smoothstep(0.25, 1.0, d) * 0.8 + rip * 0.08);
        c += vec3(1.0) * pow(max(wave, 0.0), 12.0) * 0.9;
        float a = smoothstep(1.0, 0.94, d) * 0.88;
        gl_FragColor = vec4(c, a); }`,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(pond.r, 64), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.set(pond.x, 0.04, pond.z); g.add(water);
  const shore = new THREE.Mesh(new THREE.RingGeometry(pond.r - 0.2, pond.r + 0.7, 64), new THREE.MeshLambertMaterial({ color: "#b9a477" }));
  shore.rotation.x = -Math.PI / 2; shore.position.set(pond.x, 0.03, pond.z); g.add(shore);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand(-0.08, 0.08), r = pond.r + rand(0.2, 0.7);
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.25, 0.55), 0), pebbleMat);
    s.position.set(pond.x + Math.cos(a) * r, 0.1, pond.z + Math.sin(a) * r); s.scale.y = 0.55; s.castShadow = true; g.add(s);
  }
  const padMat = std("#3f9a4a", { side: THREE.DoubleSide, roughness: 0.4 });
  for (let i = 0; i < 9; i++) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(rand(0.5, 0.9), 24, 0.25, Math.PI * 2 - 0.5), padMat);
    pad.rotation.x = -Math.PI / 2; pad.rotation.z = rand(0, 6);
    const a = rand(0, 6.3), r = rand(0.5, pond.r - 1.2);
    pad.position.set(pond.x + Math.cos(a) * r, 0.07, pond.z + Math.sin(a) * r); g.add(pad);
    if (i % 3 === 0) {
      const lotus = new THREE.Group();
      for (let k = 0; k < 8; k++) {
        const pe = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), std(k % 2 ? "#ffb6d5" : "#ff8fc0", { emissive: "#401020", emissiveIntensity: 0.2 }));
        const b = (k / 8) * Math.PI * 2; pe.scale.set(0.5, 1.1, 0.35); pe.position.set(Math.cos(b) * 0.12, 0.2, Math.sin(b) * 0.12); pe.rotation.set(Math.sin(b) * 0.5, 0, -Math.cos(b) * 0.5);
        lotus.add(pe);
      }
      lotus.position.copy(pad.position); lotus.position.y = 0.1; g.add(lotus);
    }
  }
  const reedMat = std("#5c8f3c"), cattail = std("#6b4423");
  for (let i = 0; i < 30; i++) {
    const a = rand(0, 6.3), r = pond.r + rand(-0.4, 0.6), h = rand(2, 4);
    const reed = new THREE.Group();
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, h, 5), reedMat); s.position.y = h / 2; reed.add(s);
    if (i % 3 === 0) { const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.45, 4, 8), cattail); c.position.y = h * 0.85; reed.add(c); }
    reed.position.set(pond.x + Math.cos(a) * r, 0, pond.z + Math.sin(a) * r); reed.rotation.z = rand(-0.12, 0.12); reed.userData = { sway: rand(0, 9), head: null };
    reed.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.add(reed); swayers.push(reed);
  }

  // ---------------------------------------------------------------- blossom trees
  const bark = std("#7a5636", { roughness: 0.9 });
  for (let i = 0; i < 14; i++) {
    const t = new THREE.Group(); const h = rand(9, 15);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1, h, 9), bark); trunk.position.y = h / 2; t.add(trunk);
    const pink = i % 2 === 0;
    for (let k = 0; k < 7; k++) {
      const col = pink ? pick(["#ffc9de", "#ffb3cf", "#ffd9e8"]) : pick(["#7cc45a", "#8fd16a", "#6bb34d"]);
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(2.6, 4), 1), new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, flatShading: true }));
      b.position.set(rand(-3, 3), h + rand(-1.5, 2), rand(-3, 3)); t.add(b);
    }
    t.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const [x, z] = spot(55, 78, 3); t.position.set(x, 0, z); g.add(t);
  }

  // ---------------------------------------------------------------- distant hills
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand(-0.1, 0.1), r = rand(120, 150);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(rand(25, 45), 24, 12), new THREE.MeshLambertMaterial({ color: pick(["#9fd57d", "#b3df8c", "#8cc86e", "#c5e59a"]) }));
    hill.scale.y = rand(0.25, 0.45); hill.position.set(Math.cos(a) * r, -2, Math.sin(a) * r); g.add(hill);
  }

  // ---------------------------------------------------------------- floating islands with waterfalls
  const fallTex = canvasTex(64, 256, (c, w, h) => {
    c.fillStyle = "rgba(255,255,255,0)"; c.clearRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) { c.fillStyle = `rgba(${rand(200, 255)},${rand(230, 255)},255,${rand(0.3, 0.9)})`; c.fillRect(rand(0, w), rand(0, h), rand(2, 6), rand(20, 70)); }
  });
  fallTex.wrapT = THREE.RepeatWrapping;
  for (let i = 0; i < 4; i++) {
    const isl = new THREE.Group(); const R = rand(6, 10);
    const rock = new THREE.Mesh(new THREE.ConeGeometry(R, R * 1.6, 9, 3), std("#8a7563", { flatShading: true, roughness: 0.95 }));
    rock.rotation.x = Math.PI; rock.position.y = -R * 0.8; isl.add(rock);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R, 0.8, 18), std("#7cc85a")); isl.add(top);
    for (let k = 0; k < 3; k++) {
      const tr = new THREE.Group(); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 3, 7), bark); trunk.position.y = 1.5; tr.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(1.4, 2.2), 1), std(pick(["#ffc9de", "#8fd16a", "#ffe08a"]), { flatShading: true }));
      crown.position.y = 3.6; tr.add(crown); tr.position.set(rand(-R * 0.5, R * 0.5), 0.4, rand(-R * 0.5, R * 0.5)); isl.add(tr);
    }
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 26), new THREE.MeshBasicMaterial({ map: fallTex.clone(), transparent: true, depthWrite: false, fog: false }));
    fall.material.map.wrapT = THREE.RepeatWrapping; fall.material.map.repeat.set(1, 3);
    fall.position.set(R * 0.95, -13, 0); fall.rotation.y = Math.PI / 2; isl.add(fall);
    const a = rand(0, 6.3), r = rand(80, 115);
    isl.position.set(Math.cos(a) * r, rand(30, 52), Math.sin(a) * r); isl.lookAt(0, isl.position.y, 0);
    isl.userData = { y: isl.position.y, ph: rand(0, 6), fall };
    g.add(isl); islands.push(isl);
  }

  // ---------------------------------------------------------------- sky: sun glow, light rays, rainbow, clouds
  const glowTex = canvasTex(256, 256, (c) => {
    const rg = c.createRadialGradient(128, 128, 0, 128, 128, 128);
    rg.addColorStop(0, "rgba(255,250,225,1)"); rg.addColorStop(0.18, "rgba(255,236,170,.85)"); rg.addColorStop(0.45, "rgba(255,210,140,.25)"); rg.addColorStop(1, "rgba(255,200,120,0)");
    c.fillStyle = rg; c.fillRect(0, 0, 256, 256);
  });
  const sunPos = new THREE.Vector3(-120, 95, -170);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sunGlow.scale.set(150, 150, 1); sunGlow.position.copy(sunPos); g.add(sunGlow);
  const rayTex = canvasTex(64, 256, (c, w, h) => {
    const lg = c.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, "rgba(255,240,200,.7)"); lg.addColorStop(1, "rgba(255,240,200,0)");
    c.fillStyle = lg; c.fillRect(0, 0, w, h);
    const sg = c.createLinearGradient(0, 0, w, 0); sg.addColorStop(0, "rgba(0,0,0,1)"); sg.addColorStop(0.5, "rgba(0,0,0,0)"); sg.addColorStop(1, "rgba(0,0,0,1)");
    c.globalCompositeOperation = "destination-out"; c.fillStyle = sg; c.fillRect(0, 0, w, h);
  });
  for (let i = 0; i < 7; i++) {
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(rand(6, 14), 130), new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    ray.position.set(sunPos.x * 0.45 + rand(-30, 30), 40, sunPos.z * 0.45 + rand(-30, 30));
    ray.lookAt(0, 40, 0); ray.rotateZ(rand(0.45, 0.65)); ray.userData = { ph: rand(0, 6), base: rand(0.07, 0.14) };
    g.add(ray); rays.push(ray);
  }
  const rainbow = new THREE.Mesh(new THREE.RingGeometry(95, 108, 96, 1, 0, Math.PI), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vP; vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0); }
      void main(){ float t = (length(vP) - 95.0) / 13.0; float a = smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.85, t) * 0.32;
        a *= smoothstep(0.0, 25.0, vP.y); gl_FragColor = vec4(hue(0.82 - t * 0.82), a); }`,
  }));
  rainbow.position.set(60, -8, -175); rainbow.rotation.y = -0.35; g.add(rainbow);

  const cloudMat = new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#fff2e2", emissiveIntensity: 0.25 });
  for (let i = 0; i < 24; i++) {
    const cl = new THREE.Group();
    const n = Math.floor(rand(6, 11));
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(2, 4.5), 2), cloudMat);
      s.position.set(rand(-6, 6), rand(0, 2.2) * (1 - Math.abs(k / n - 0.5)), rand(-3, 3)); s.scale.y = 0.75; cl.add(s);
    }
    const [x, z] = polar(40, 140); cl.position.set(x, rand(24, 46), z); cl.userData.v = rand(0.4, 1);
    g.add(cl); clouds.push(cl);
  }

  // ---------------------------------------------------------------- butterflies
  const wingStyles = [
    (c, w, h) => { c.fillStyle = "#ff8a1e"; c.beginPath(); c.ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4, 0, 0, 7); c.fill(); c.strokeStyle = "#1a0d05"; c.lineWidth = 9; c.stroke(); for (let i = 0; i < 9; i++) { c.fillStyle = "#fff"; c.beginPath(); c.arc(rand(10, w - 10), rand(8, h - 8), 4, 0, 7); c.fill(); } },
    (c, w, h) => { const rg = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); rg.addColorStop(0, "#9fe8ff"); rg.addColorStop(0.7, "#2f6dff"); rg.addColorStop(1, "#071a4a"); c.fillStyle = rg; c.beginPath(); c.ellipse(w / 2, h / 2, w / 2 - 3, h / 2 - 3, 0, 0, 7); c.fill(); },
    (c, w, h) => { c.fillStyle = "#fff36b"; c.beginPath(); c.ellipse(w / 2, h / 2, w / 2 - 3, h / 2 - 3, 0, 0, 7); c.fill(); c.fillStyle = "#ff9d2e"; c.beginPath(); c.arc(w * 0.7, h * 0.4, 10, 0, 7); c.fill(); },
    (c, w, h) => { c.fillStyle = "#ffd6f0"; c.beginPath(); c.ellipse(w / 2, h / 2, w / 2 - 3, h / 2 - 3, 0, 0, 7); c.fill(); c.fillStyle = "#c86bff"; c.beginPath(); c.arc(w * 0.62, h * 0.5, 13, 0, 7); c.fill(); },
  ];
  const wingGeo = new THREE.PlaneGeometry(0.55, 0.45); wingGeo.translate(0.28, 0, 0);
  for (let i = 0; i < 16; i++) {
    const tex = canvasTex(128, 104, wingStyles[i % wingStyles.length]);
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1, roughness: 0.6 });
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.3, 4, 8), std("#222")); body.rotation.x = Math.PI / 2; b.add(body);
    const wl = new THREE.Mesh(wingGeo, mat), wr = new THREE.Mesh(wingGeo, mat); wr.scale.x = -1;
    wl.rotation.x = wr.rotation.x = -Math.PI / 2;
    const pl = new THREE.Group(), pr = new THREE.Group(); pl.add(wl); pr.add(wr); b.add(pl, pr);
    const [x, z] = spot(3, 40, 0);
    b.position.set(x, rand(1, 4), z); b.scale.setScalar(rand(1.1, 1.8));
    b.userData = { pl, pr, ph: rand(0, 6), heading: rand(0, 6.3), speed: rand(1, 2.2), home: new THREE.Vector3(x, 0, z) };
    g.add(b); butterflies.push(b);
  }

  // ---------------------------------------------------------------- food spots (the world gives these to the item system)
  const fruitSpots = [];
  for (let i = 0; i < 10; i++) fruitSpots.push([...spot(5, 42, 1.5), i % 2 ? "cherry" : "strawberry"]);

  function update(t, dt) {
    time.value = t;
    for (const f of swayers) f.rotation.z = Math.sin(t * 0.9 + f.userData.sway) * 0.035;
    for (const c of clouds) { c.position.x += c.userData.v * dt; if (c.position.x > 150) c.position.x = -150; }
    for (const isl of islands) { isl.position.y = isl.userData.y + Math.sin(t * 0.3 + isl.userData.ph) * 1.2; isl.userData.fall.material.map.offset.y = -t * 0.9; }
    for (const r of rays) r.material.opacity = r.userData.base * (0.75 + 0.25 * Math.sin(t * 0.4 + r.userData.ph));
    for (const b of butterflies) {
      const u = b.userData;
      u.heading += (Math.sin(t * 0.7 + u.ph) * 1.4 + (b.position.distanceTo(u.home) > 9 ? Math.sign(Math.sin(Math.atan2(u.home.x - b.position.x, u.home.z - b.position.z) - u.heading)) * 2 : 0)) * dt;
      b.position.x += Math.sin(u.heading) * u.speed * dt; b.position.z += Math.cos(u.heading) * u.speed * dt;
      b.position.y = 1.2 + 1.6 * (Math.sin(t * 0.6 + u.ph) * 0.5 + 0.5) + Math.sin(t * 9 + u.ph) * 0.08;
      b.rotation.y = u.heading;
      const flap = Math.sin(t * 14 + u.ph) * 1.1; u.pl.rotation.z = flap; u.pr.rotation.z = -flap;
    }
  }
  return { group: g, flowers, pond, fruitSpots, update };
}
