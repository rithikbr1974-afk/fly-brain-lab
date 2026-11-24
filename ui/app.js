import * as THREE from "three";

const $ = (s) => document.querySelector(s);
const SENSE_COLORS = { sugar: "#ffd166", bitter: "#ff6b8b", water: "#5ec8ff", touch: "#b49bff", loom_r: "#7cf2c4", loom_l: "#7cf2c4" };
const CLASS_COLORS = {
  optic: "#2b3d66", central: "#4a3a78", sensory: "#2d5e5a", visual_projection: "#33507a", ascending: "#3e5c3a",
  descending: "#7a4a2e", sensory_ascending: "#2d5e5a", visual_centrifugal: "#33507a", motor: "#8a3a3a", endocrine: "#5b5b2e", "": "#333a4a",
};
// same order as server.SUPER
const SUPER = ["", "optic", "central", "sensory", "visual_projection", "ascending", "descending",
  "sensory_ascending", "visual_centrifugal", "motor", "endocrine"];
const PRESETS = [
  { name: "Taste sugar", senses: { sugar: 150 } },
  { name: "Sugar + bitter", senses: { sugar: 150, bitter: 200 } },
  { name: "Tickle antenna", senses: { touch: 150 } },
  { name: "Shadow from the right", senses: { loom_r: 150 } },
  { name: "Moonwalker (MDN on)", activate: [["MDN", 120]] },
  { name: "Shadow, Giant Fiber silenced", senses: { loom_r: 150 }, silence: ["DNp01"] },
];
const VERDICTS = {
  feed: ["It sticks out its proboscis to eat!", "Taste neurons reach MN9, the motor neuron that extends the proboscis."],
  groom: ["It starts cleaning its antennae.", "Touch on the antenna drives aDN1, the grooming command neuron."],
  escape: ["Takeoff! It escapes the shadow.", "Looming detectors fire the Giant Fiber, the fastest escape circuit."],
  back: ["It walks backwards.", "MDN, the 'moonwalker' neurons, reverse walking."],
  turn_l: ["It turns left.", "DNa02 on the left side steers."],
  turn_r: ["It turns right.", "DNa02 on the right side steers."],
};

let meta, busy = false, state = { senses: {}, activate: [], silence: [] };

// ---------- controls ----------
async function init() {
  meta = await (await fetch("/api/meta")).json();
  $("#sub").textContent = `${meta.n.toLocaleString()} real neurons of the fruit fly brain, every synapse, running on this PC`;
  const list = $("#typeList");
  list.innerHTML = meta.types.map(([t, n]) => `<option value="${t}">${n} neuron${n > 1 ? "s" : ""}</option>`).join("");

  for (const s of meta.senses) {
    const el = document.createElement("div");
    el.className = "sense";
    el.style.setProperty("--c", SENSE_COLORS[s.key]);
    el.innerHTML = `<input type="checkbox" class="switch" autocomplete="off"><span class="name">${s.label}</span><span class="hz">${s.hz} Hz</span>
      <input type="range" min="10" max="300" step="10" value="${s.hz}" autocomplete="off"><span class="info">${s.hint} &middot; ${s.n} neurons</span>`;
    const [box, range] = el.querySelectorAll("input");
    const sync = () => {
      el.classList.toggle("on", box.checked);
      el.querySelector(".hz").textContent = `${range.value} Hz`;
      if (box.checked) state.senses[s.key] = +range.value; else delete state.senses[s.key];
    };
    box.onchange = sync; range.oninput = () => { box.checked = true; sync(); };
    el._set = (hz) => { box.checked = hz > 0; if (hz) range.value = hz; sync(); };
    el.dataset.key = s.key;
    $("#senses").append(el);
  }
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.textContent = p.name;
    b.onclick = () => { if (!busy) { applyPreset(p); runBrain(); } };
    $("#presets").append(b);
  }
  $("#actAdd").onclick = () => addAct($("#actType").value.trim(), +$("#actHz").value);
  $("#silAdd").onclick = () => addSil($("#silType").value.trim());
  $("#actType").onkeydown = (e) => e.key === "Enter" && $("#actAdd").click();
  $("#silType").onkeydown = (e) => e.key === "Enter" && $("#silAdd").click();
  $("#run").onclick = runBrain;
  renderBehaviours(meta.behaviours.map((b) => ({ ...b, hz: 0, level: 0 })));
  setFly(null);
}

const knownType = (t) => meta.types.some(([x]) => x === t);
function addAct(t, hz) {
  if (!knownType(t)) return status(`No cell type called "${t}".`);
  state.activate = state.activate.filter(([x]) => x !== t).concat([[t, hz || 150]]);
  $("#actType").value = ""; renderChips();
}
function addSil(t) {
  if (!knownType(t)) return status(`No cell type called "${t}".`);
  if (!state.silence.includes(t)) state.silence.push(t);
  $("#silType").value = ""; renderChips();
}
function renderChips() {
  $("#actChips").innerHTML = state.activate.map(([t, hz], i) => `<span class="chip">${t} &middot; ${hz} Hz<button data-i="${i}">&times;</button></span>`).join("");
  $("#silChips").innerHTML = state.silence.map((t, i) => `<span class="chip kill">${t} silenced<button data-i="${i}">&times;</button></span>`).join("");
  $("#actChips").querySelectorAll("button").forEach((b) => (b.onclick = () => { state.activate.splice(+b.dataset.i, 1); renderChips(); }));
  $("#silChips").querySelectorAll("button").forEach((b) => (b.onclick = () => { state.silence.splice(+b.dataset.i, 1); renderChips(); }));
}
function applyPreset(p) {
  document.querySelectorAll(".sense").forEach((el) => el._set(p.senses?.[el.dataset.key] || 0));
  state.activate = (p.activate || []).map((x) => [...x]);
  state.silence = [...(p.silence || [])];
  renderChips();
}
const status = (t) => ($("#status").textContent = t);

async function runBrain() {
  const senses = Object.entries(state.senses).map(([key, hz]) => ({ key, hz }));
  const activate = state.activate.map(([type, hz]) => ({ type, hz }));
  if (busy) return;
  if (!senses.length && !activate.length) return status("Switch on at least one sense or cell type.");
  busy = true;
  const btn = $("#run");
  btn.disabled = true; btn.classList.add("busy"); btn.textContent = "Brain is thinking…";
  const t0 = performance.now();
  const tick = setInterval(() => status(`Simulating ${meta.n.toLocaleString()} neurons… ${((performance.now() - t0) / 1000).toFixed(0)} s`), 500);
  try {
    const res = await (await fetch("/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senses, activate, silence: state.silence, ms: +$("#ms").value, trials: +$("#trials").value }),
    })).json();
    if (res.error) throw new Error(res.error);
    showResult(res);
    status(`${res.trials} trials of ${res.ms} ms in ${res.seconds} s · ${res.active.toLocaleString()} neurons fired, ${res.spikes.toLocaleString()} spikes per trial`);
  } catch (e) {
    status(`Error: ${e.message}`);
  } finally {
    clearInterval(tick);
    busy = false; btn.disabled = false; btn.classList.remove("busy"); btn.textContent = "Run the brain";
  }
}

// ---------- results ----------
function showResult(res) {
  renderBehaviours(res.behaviours);
  const win = res.behaviours.filter((b) => b.level >= 0.15).sort((a, b) => b.level - a.level)[0];
  setFly(win?.key);
  if (!win && res.inputs.includes("Sugar") && res.inputs.includes("Bitter"))
    $("#verdict").innerHTML = `It refuses the food.<small>Bitter neurons inhibit the sugar pathway, so MN9 stays silent.</small>`;
  $("#activeCount").textContent = `${res.active.toLocaleString()} fired`;
  const tb = $("#top tbody");
  tb.innerHTML = res.top.map((n) => `<tr data-i="${n.i}"><td>${n.type}</td><td>${n.cls.replace("_", " ")}</td><td>${n.side[0] || ""}</td><td>${n.hz}</td>
    <td>${n.type !== "?" ? `<button title="silence this cell type">silence</button>` : ""}</td></tr>`).join("");
  tb.querySelectorAll("tr").forEach((tr) => {
    tr.onmouseenter = () => brain.highlight(+tr.dataset.i);
    tr.onmouseleave = () => brain.highlight(-1);
    const b = tr.querySelector("button");
    if (b) b.onclick = () => addSil(tr.children[0].textContent);
  });
  const dec = (s, T) => new T(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer);
  brain.load(dec(res.raster_t, Float32Array), dec(res.raster_i, Int32Array), res.ms, new Set(res.stim), res.behaviours);
}

function renderBehaviours(list) {
  const best = Math.max(...list.map((b) => b.level));
  $("#behaviours").innerHTML = list.map((b) => `<div class="beh ${b.level >= 0.15 && b.level === best ? "win" : ""}">
    <span class="lab">${b.label}<small>${b.note}</small></span><span class="val">${b.hz} Hz</span>
    <span class="bar"><i style="width:${(b.level * 100).toFixed(0)}%"></i></span></div>`).join("");
}

function setFly(key) {
  const fly = $("#fly");
  fly.setAttribute("class", key ? `fly-${key}` : "fly-idle");
  const v = key ? VERDICTS[key] : null;
  $("#verdict").innerHTML = v ? `${v[0]}<small>${v[1]}</small>` : `The fly sits still.<small>No behaviour neuron crossed its threshold.</small>`;
}

// ---------- 3D brain ----------
const brain = (() => {
  const canvas = $("#brain3d");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  const group = new THREE.Group();
  scene.add(group);
  let pts, glow, base, n = 0, spikesT, spikesI, dur = 0, ptr = 0, t = 0, playing = false, stimSet = new Set();
  let yaw = 0, pitch = 0.15, dist = 950, auto = true, marker;

  fetch("/api/brain.bin").then((r) => r.arrayBuffer()).then((buf) => {
    n = buf.byteLength / 13;
    const xyz = new Float32Array(buf, 0, n * 3), cls = new Uint8Array(buf, n * 12, n);
    const pos = new Float32Array(n * 3);
    let cx = 0, cy = 0, cz = 0, k = 0;
    for (let i = 0; i < n; i++) if (xyz[i * 3]) { cx += xyz[i * 3]; cy += xyz[i * 3 + 1]; cz += xyz[i * 3 + 2]; k++; }
    cx /= k; cy /= k; cz /= k;
    base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const ok = xyz[i * 3] !== 0;
      pos[i * 3] = ok ? xyz[i * 3] - cx : 1e5;
      pos[i * 3 + 1] = ok ? -(xyz[i * 3 + 1] - cy) : 1e5;   // FlyWire y points down
      pos[i * 3 + 2] = ok ? -(xyz[i * 3 + 2] - cz) : 1e5;
      const c = new THREE.Color(CLASS_COLORS[SUPER[cls[i]]] || "#333a4a");
      base.set([c.r, c.g, c.b], i * 3);
    }
    glow = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("base", new THREE.BufferAttribute(base, 3));
    geo.setAttribute("glow", new THREE.BufferAttribute(glow, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { hot: { value: new THREE.Color("#ffe08a") }, scale: { value: renderer.getPixelRatio() } },
      vertexShader: `attribute vec3 base; attribute float glow; varying vec3 vC; varying float vA; uniform vec3 hot; uniform float scale;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          float g = clamp(glow, 0.0, 1.0); vC = mix(base, hot, g); vA = 0.28 + 0.72 * g;
          gl_PointSize = scale * (2.2 + 9.0 * g) * (900.0 / -mv.z); }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard;
          gl_FragColor = vec4(vC, vA * (1.0 - r * 3.2)); }`,
    });
    pts = new THREE.Points(geo, mat);
    group.add(pts);
    const mg = new THREE.SphereGeometry(9, 16, 12);
    marker = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: "#ffffff", wireframe: true }));
    marker.visible = false;
    group.add(marker);
    $("#legend").innerHTML = [["central brain", CLASS_COLORS.central], ["optic lobes", CLASS_COLORS.optic], ["sensory", CLASS_COLORS.sensory],
      ["descending (to the body)", CLASS_COLORS.descending], ["spike", "#ffe08a"]].map(([l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join("");
  });

  // pointer: drag to turn, wheel to zoom
  let drag = null;
  canvas.onpointerdown = (e) => { drag = [e.clientX, e.clientY]; auto = false; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    yaw += (e.clientX - drag[0]) * 0.006; pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag[1]) * 0.006));
    drag = [e.clientX, e.clientY];
  };
  canvas.onpointerup = () => (drag = null);
  canvas.onwheel = (e) => { e.preventDefault(); dist = Math.max(300, Math.min(2500, dist * (1 + e.deltaY * 0.001))); };

  const scrub = $("#scrub"), play = $("#play");
  play.onclick = () => { if (t >= dur) seek(0); playing = !playing; play.textContent = playing ? "Pause" : "Replay"; };
  scrub.oninput = () => { seek((scrub.value / 1000) * dur); };
  function seek(nt) {
    t = nt; ptr = 0;
    while (ptr < spikesT.length && spikesT[ptr] < t) ptr++;
    glow.fill(0);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(now - last, 50); last = now;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    if (auto) yaw += dt * 0.00012;
    camera.position.set(dist * Math.sin(yaw) * Math.cos(pitch), dist * Math.sin(pitch), dist * Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(0, 0, 0);
    if (glow) {
      const decay = Math.exp(-dt / 140);
      for (let i = 0; i < n; i++) if (glow[i] > 0.003) glow[i] *= decay; else glow[i] = 0;
      if (playing && spikesT) {
        t = Math.min(dur, t + dt * +$("#speed").value);
        while (ptr < spikesT.length && spikesT[ptr] <= t) { const i = spikesI[ptr++]; glow[i] = stimSet.has(i) ? 0.55 : 1; }
        scrub.value = (t / dur) * 1000;
        $("#clock").textContent = t.toFixed(1);
        if (t >= dur) { playing = false; play.textContent = "Replay"; }
      }
      pts.geometry.attributes.glow.needsUpdate = true;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    load(T, I, ms, stim, behaviours) {
      spikesT = T; spikesI = I; dur = ms; stimSet = stim;
      play.disabled = scrub.disabled = false;
      seek(0); playing = true; play.textContent = "Pause";
    },
    highlight(i) {
      if (!marker) return;
      marker.visible = i >= 0;
      if (i >= 0) { const p = pts.geometry.attributes.position; marker.position.set(p.getX(i), p.getY(i), p.getZ(i)); }
    },
  };
})();

init();
