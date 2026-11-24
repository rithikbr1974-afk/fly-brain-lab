"""Fly World: the whole-brain fly (live.py) in a 3D world, closed loop.

    .venv/Scripts/python world_server.py      -> http://127.0.0.1:8796

The page runs the world and the body. Every ~40 ms of brain time it sends what the fly senses
(taste, antenna touch, looming shadows) and gets back its descending/motor neuron rates.
"""
import base64
import json
import os
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

from live import LiveBrain
from server import SENSES, SUPER, brain_bin, load_annotations
import server

ROOT = Path(__file__).parent
PORT = int(os.environ.get("WORLD_PORT", 8796))

READOUTS = {  # name: (cell types, side or None)
    "mn9": (["CB0701"], None),          # proboscis extension: eat / drink
    "groom": (["DNg62", "SAD093"], None),  # aDN1 + aBN1: antenna grooming
    "gf": (["DNp01"], None),            # Giant Fiber: escape takeoff
    "mdn": (["MDN"], None),             # moonwalker: walk backwards
    "turn_l": (["DNa02"], "left"),      # ipsilateral turn
    "turn_r": (["DNa02"], "right"),
    "walk": (["DNp09"], None),          # forward walking command
}

# Urges: the fly's own random impulses (made in world.js) enter the central brain at the neurons that most
# strongly excite each command neuron, so they still have to travel through the real wiring.
URGES = {  # urge: (target cell types, side)
    "u_walk": (["DNp09"], None),
    "u_turn_l": (["DNa02"], "left"),
    "u_turn_r": (["DNa02"], "right"),
    "u_back": (["MDN"], None),
    "u_groom": (["DNg62"], None),
    "u_probe": (["CB0701"], None),
    "u_takeoff": (["DNp01"], None),
}


class World:
    def __init__(self):
        self.A = load_annotations()
        server.A = self.A
        self.sense_idx = {k: np.flatnonzero(v["pick"](self.A)) for k, v in SENSES.items()}
        self.read_idx = {}
        for k, (types, side) in READOUTS.items():
            m = np.isin(self.A["cell_type"], types)
            if side:
                m &= self.A["side"] == side
            self.read_idx[k] = np.flatnonzero(m)
        self.urge_idx = self._upstream_sets()
        self.brain = LiveBrain(seed=int(time.time()) % 2**31)
        self.brain.advance(1)                  # compile
        self.lock = threading.Lock()
        self.hot = 0

    def _upstream_sets(self, k=12):
        """for each urge: the k central/ascending/visual-projection neurons with the most excitatory synapses
        onto its target command neurons"""
        d = np.load(ROOT / "data" / "brain.npz")
        indptr, post, w = d["indptr"], d["post"], d["w"]
        pre = np.repeat(np.arange(len(indptr) - 1, dtype=np.int32), np.diff(indptr))
        ok = np.isin(self.A["super_class"], ["central", "ascending", "visual_projection"])
        out = {}
        for name, (types, side) in URGES.items():
            tm = np.isin(self.A["cell_type"], types)
            if side:
                tm &= self.A["side"] == side
            m = tm[post] & (w > 0)
            tot = np.bincount(pre[m], weights=w[m], minlength=len(ok))
            tot[~ok] = 0
            top = np.argsort(-tot)[:k]
            out[name] = top[tot[top] > 0]
        return out

    def step(self, senses, ms, urges=None, stop=()):
        idx, hz = [], []
        for k, r in senses.items():
            if k in self.sense_idx and r > 0:
                idx.append(self.sense_idx[k]); hz.append(np.full(len(self.sense_idx[k]), float(r)))
        for k, r in (urges or {}).items():
            if k in self.urge_idx and r > 0:
                idx.append(self.urge_idx[k]); hz.append(np.full(len(self.urge_idx[k]), float(min(r, 150))))
        with self.lock:
            t0 = time.perf_counter()
            for k in stop:                       # an urge ended: brief inhibition releases its circuit (MN9 latches)
                if k in self.urge_idx:
                    self.brain.quench(self.urge_idx[k])
            if idx:
                self.brain.set_input(np.concatenate(idx), np.concatenate(hz))
            else:
                self.brain.set_input(np.zeros(0, np.int64), 0.0)
            counts, (si, st) = self.brain.advance(ms)
            took = time.perf_counter() - t0
            # runaway guard: this model is bistable; once most of the brain fires together it never stops.
            # A few chunks above ~150k spikes/s (normal behaviour stays under ~40k) -> back to rest.
            self.hot = self.hot + 1 if counts.sum() * 1000.0 / ms > 150_000 else 0
            reset = self.hot >= 3
            if reset:
                self.brain.reset(); self.hot = 0
                print("runaway activity: brain reset to rest", flush=True)
        rates = {k: round(float(counts[i].mean()) * 1000.0 / ms, 1) for k, i in self.read_idx.items()}
        uniq = np.unique(si)
        if len(uniq) > 4000:
            uniq = np.random.choice(uniq, 4000, replace=False)
        return dict(rates=rates, spikes=int(counts.sum()), active=int((counts > 0).sum()), reset=reset,
                    compute_ms=round(took * 1000, 1),
                    fired=base64.b64encode(uniq.astype(np.int32).tobytes()).decode())


WORLD = None


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # keep-alive: the page calls the brain ~25 times a second
    cache = {}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT / "world"), **k)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send(self, body, ctype="application/json"):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/brain.bin":
            return self._send(self.cache.setdefault("bin", brain_bin()), "application/octet-stream")
        return super().do_GET()

    def translate_path(self, path):
        if path.startswith("/vendor/"):           # share three.js with the Lab
            return str(ROOT / "ui" / "vendor" / Path(path.split("?")[0]).name)
        return super().translate_path(path)

    def do_POST(self):
        if self.path != "/api/step":
            return self.send_error(404)
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        ms = float(min(max(req.get("ms", 40), 10), 200))
        try:
            out = WORLD.step(req.get("senses", {}), ms, req.get("urges", {}), req.get("stop", []))
        except Exception as e:
            out = dict(error=f"{type(e).__name__}: {e}")
        self._send(json.dumps(out).encode())


def main():
    global WORLD
    WORLD = World()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Fly World on http://127.0.0.1:{PORT}  ({WORLD.brain.n} neurons live)", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
