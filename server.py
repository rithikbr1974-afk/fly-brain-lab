"""Fly Brain Lab: a local web app around the whole-brain fly model (sim.py).

    .venv/Scripts/python server.py        -> http://127.0.0.1:8795

Pick senses (sugar, bitter, water, antenna touch, a looming shadow), switch on any cell type
(optogenetics) or silence one, run the 138k-neuron brain, and watch which behaviour comes out.
"""
import base64
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent
PORT = int(os.environ.get("FLY_PORT", 8795))
WORKERS = int(os.environ.get("FLY_WORKERS", 4))

# Labellar water neurons used in Shiu et al. (figures.ipynb, Fig. 4); all 18 exist in v783. The annotation's
# "water" sub-class picks a different set that barely reaches MN9.
WATER_PAPER = [
    720575940612950568, 720575940631898285, 720575940606002609, 720575940612579053, 720575940622902535,
    720575940616177458, 720575940660292225, 720575940622486922, 720575940613786774, 720575940629852866,
    720575940625861168, 720575940613996959, 720575940617857694, 720575940644965399, 720575940625203504,
    720575940630553415, 720575940635172191, 720575940634796536,
]

# Senses: which sensory neurons a stimulus drives (FlyWire v783 annotations).
SENSES = {
    "sugar":  dict(label="Sugar", hint="sweet taste neurons on the labellum", hz=150,
                   pick=lambda a: a["cell_sub_class"] == "sugar"),
    "bitter": dict(label="Bitter", hint="bitter taste neurons", hz=150,
                   pick=lambda a: a["cell_sub_class"] == "bitter"),
    "water":  dict(label="Water", hint="water taste neurons, right side (the paper's set)", hz=250,
                   pick=lambda a: np.isin(a["ids"], WATER_PAPER)),
    "touch":  dict(label="Antenna touch", hint="Johnston's organ C/E neurons (antenna bending)", hz=150,
                   pick=lambda a: np.char.startswith(a["cell_type"], "JO-C") | np.char.startswith(a["cell_type"], "JO-E")),
    "loom_r": dict(label="Shadow, right", hint="looming detectors LPLC2 + LC4, right eye", hz=150,
                   pick=lambda a: np.isin(a["cell_type"], ["LPLC2", "LC4"]) & (a["side"] == "right")),
    "loom_l": dict(label="Shadow, left", hint="looming detectors LPLC2 + LC4, left eye", hz=150,
                   pick=lambda a: np.isin(a["cell_type"], ["LPLC2", "LC4"]) & (a["side"] == "left")),
}

# Behaviours: read out from known command / motor neurons.
BEHAVIOURS = [
    dict(key="feed",   label="Extend proboscis (eat)", types=["CB0701"], note="MN9 motor neuron", full=80),
    dict(key="groom",  label="Groom antennae", types=["DNg62", "SAD093"], note="aDN1 + aBN1", full=60),
    dict(key="escape", label="Escape takeoff", types=["DNp01"], note="Giant Fiber", full=100),
    dict(key="back",   label="Walk backwards", types=["MDN"], note="moonwalker neurons", full=40),
    dict(key="turn_l", label="Turn left", types=["DNa02"], side="left", note="DNa02 left", full=50),
    dict(key="turn_r", label="Turn right", types=["DNa02"], side="right", note="DNa02 right", full=50),
]

SUPER = ["", "optic", "central", "sensory", "visual_projection", "ascending", "descending",
         "sensory_ascending", "visual_centrifugal", "motor", "endocrine"]

A = None       # annotations (main process)
BRAIN = None   # sim.Brain (worker processes)


def load_annotations():
    d = np.load(ROOT / "data" / "brain.npz")
    return {k: d[k] for k in ["ids", "xyz", "cell_type", "super_class", "cell_class", "cell_sub_class", "side", "nt"]}


def _init_worker():
    global BRAIN
    from sim import Brain
    BRAIN = Brain()


def _trial(exc, rates, silence, t_ms, seed, record):
    out = BRAIN.run(exc, rates, t_ms=t_ms, silence=silence, seed=seed, record=record)
    return out if record else (out, None)


def by_types(types, side=None):
    m = np.isin(A["cell_type"], types)
    if side:
        m &= A["side"] == side
    return np.flatnonzero(m)


def run(req, pool):
    t_ms = float(min(max(req.get("ms", 500), 100), 2000))
    trials = int(min(max(req.get("trials", 4), 1), 8))
    exc, rates, labels = [], [], []
    for s in req.get("senses", []):
        sense = SENSES.get(s.get("key"))
        if sense and s.get("hz", 0) > 0:
            exc.append(np.flatnonzero(sense["pick"](A)).tolist()); rates.append(float(s["hz"])); labels.append(sense["label"])
    for o in req.get("activate", []):
        idx = by_types([o.get("type", "")])
        if len(idx) and o.get("hz", 0) > 0:
            exc.append(idx.tolist()); rates.append(float(o["hz"])); labels.append(o["type"])
    silence = by_types(req.get("silence", [])).tolist()

    t0 = time.time()
    jobs = [pool.submit(_trial, exc, rates, silence, t_ms, int(time.time() * 1000) % 2**31 + k, k == 0)
            for k in range(trials)]
    res = [j.result() for j in jobs]
    counts = np.stack([r[0] for r in res]).astype(np.float64)
    rate = counts.mean(0) * 1000.0 / t_ms           # Hz
    std = counts.std(0) * 1000.0 / t_ms
    st, si = res[0][1]

    behaviours = []
    for b in BEHAVIOURS:
        idx = by_types(b["types"], b.get("side"))
        r = float(rate[idx].mean()) if len(idx) else 0.0
        behaviours.append(dict(key=b["key"], label=b["label"], note=b["note"], hz=round(r, 1),
                               level=round(min(r / b["full"], 1.0), 3),
                               neurons=[dict(type=str(A["cell_type"][i]), side=str(A["side"][i]),
                                             hz=round(float(rate[i]), 1)) for i in idx]))

    stim = set(i for e in exc for i in e)
    order = np.argsort(-rate)
    top = [dict(i=int(i), id=str(A["ids"][i]), type=str(A["cell_type"][i]) or "?", cls=str(A["super_class"][i]),
                side=str(A["side"][i]), nt=str(A["nt"][i]), hz=round(float(rate[i]), 1), sd=round(float(std[i]), 1),
                stim=int(i) in stim)
           for i in order[:400] if rate[i] > 0 and int(i) not in stim][:40]

    return dict(
        ms=t_ms, trials=trials, seconds=round(time.time() - t0, 1), inputs=labels,
        active=int((rate > 0).sum()), spikes=int(counts.sum() / trials), behaviours=behaviours, top=top,
        stim=sorted(stim),
        raster_t=base64.b64encode(st.astype(np.float32).tobytes()).decode(),
        raster_i=base64.b64encode(si.astype(np.int32).tobytes()).decode(),
    )


def meta():
    types, counts = np.unique(A["cell_type"][A["cell_type"] != ""], return_counts=True)
    return dict(
        n=len(A["ids"]), super=SUPER,
        senses=[dict(key=k, label=v["label"], hint=v["hint"], hz=v["hz"], n=int(v["pick"](A).sum()))
                for k, v in SENSES.items()],
        behaviours=[dict(key=b["key"], label=b["label"], note=b["note"]) for b in BEHAVIOURS],
        types=[[str(t), int(c)] for t, c in zip(types, counts)],
    )


def brain_bin():
    """positions (float32 x,y,z) + super class code (uint8), for the 3D view"""
    xyz = np.nan_to_num(A["xyz"], nan=0.0).astype(np.float32)
    code = {s: i for i, s in enumerate(SUPER)}
    sc = np.array([code.get(s, 0) for s in A["super_class"]], np.uint8)
    return xyz.tobytes() + sc.tobytes()


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # keep-alive: the page calls the brain ~25 times a second
    pool = None
    cache = {}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT / "ui"), **k)

    def log_message(self, fmt, *args):
        pass

    def _send(self, body, ctype="application/json"):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/meta":
            return self._send(self.cache.setdefault("meta", json.dumps(meta()).encode()))
        if self.path == "/api/brain.bin":
            return self._send(self.cache.setdefault("bin", brain_bin()), "application/octet-stream")
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/run":
            return self.send_error(404)
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        try:
            out = run(req, self.pool)
        except Exception as e:  # report to the page instead of a dropped connection
            out = dict(error=f"{type(e).__name__}: {e}")
        print(f"run {out.get('inputs')} -> {out.get('seconds')} s, {out.get('active')} active", flush=True)
        self._send(json.dumps(out).encode())


def main():
    global A
    A = load_annotations()
    Handler.pool = ProcessPoolExecutor(WORKERS, initializer=_init_worker)
    list(Handler.pool.map(partial(time.sleep), [0.1] * WORKERS))  # warm the workers (each loads the brain)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Fly Brain Lab on http://127.0.0.1:{PORT}  ({len(A['ids'])} neurons, {WORKERS} workers)", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
