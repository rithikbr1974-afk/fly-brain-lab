"""Whole-brain leaky integrate-and-fire fly, numpy port of Shiu et al. 2024 (Drosophila_brain_model/model.py).

Same equations and constants as the Brian2 model, integrated exactly over dt = 0.1 ms:
    dv/dt = (v_0 - v + g) / t_mbr      dg/dt = -g / tau          (frozen while refractory)
    spike: v > v_th  ->  v = v_rst, g = 0, refractory 2.2 ms (input arriving meanwhile is lost, as in Brian2)
    synapse: g_post += w_syn * (signed synapse count), 1.8 ms after the presynaptic spike
    stimulus: Poisson input adds w_syn * f_poi to v (one event = one spike), no refractory period
Brian2 schedule per step: state update -> threshold -> synapses (delayed spikes, Poisson) -> reset.

Speed: only neurons away from rest are updated, and spikes are propagated by slicing the CSR rows of the
neurons that fired, so a 1 s trial takes seconds instead of the full 138k x 15M work per step.
"""
from pathlib import Path

import numpy as np

DATA = Path(__file__).parent / "data" / "brain.npz"

P = dict(  # mV, ms, Hz — values from model.py default_params
    v_0=-52.0, v_rst=-52.0, v_th=-45.0, t_mbr=20.0, tau=5.0, t_rfc=2.2, t_dly=1.8,
    w_syn=0.275, f_poi=250, dt=0.1,
)
EPS = 1e-4  # mV; a neuron this close to rest with no input is treated as resting (skipped)


class Brain:
    def __init__(self, path=DATA):
        d = np.load(path)
        self.ids = d["ids"]
        self.n = len(self.ids)
        self.indptr, self.post = d["indptr"], d["post"]
        self.w = d["w"].astype(np.float64) * P["w_syn"]
        self.index = {int(f): i for i, f in enumerate(self.ids)}

    def run(self, exc, rates, t_ms=1000.0, silence=(), seed=None, record=False):
        """exc: list of index arrays, rates: matching Poisson rates (Hz). Returns spike counts per neuron,
        and (times_ms, neuron) arrays of every spike when record=True."""
        p, rng = P, np.random.default_rng(seed)
        dt, n = p["dt"], self.n
        steps = int(round(t_ms / dt))
        dly = int(round(p["t_dly"] / dt))
        rfc_steps = int(round(p["t_rfc"] / dt))

        # exact solution of the linear system over one step
        em, eg = np.exp(-dt / p["t_mbr"]), np.exp(-dt / p["tau"])
        a = p["tau"] / (p["tau"] - p["t_mbr"])           # u(t) = (u0 - a g0) e^-t/tm + a g0 e^-t/tau

        v = np.full(n, p["v_0"])
        g = np.zeros(n)
        until = np.full(n, -1, np.int64)                  # refractory until this step (exclusive)
        rfc = np.full(n, rfc_steps, np.int64)
        active = np.zeros(n, bool)

        w = self.w
        if len(silence):
            w = w.copy()
            sl = np.asarray(silence)
            for i in sl:                                   # outgoing synapses -> 0 (as model.silence)
                w[self.indptr[i]:self.indptr[i + 1]] = 0
        # a silenced neuron also never fires itself (the original only cuts its output; this keeps readouts honest)
        never = np.zeros(n, bool)
        never[np.asarray(silence, np.int64)] = True

        stim = [(np.asarray(e, np.int64), r * dt / 1000.0) for e, r in zip(exc, rates) if len(e) and r > 0]
        for e, _ in stim:
            rfc[e] = 0
        kick = p["w_syn"] * p["f_poi"]

        queue = [np.empty(0, np.int64)] * dly             # ring buffer: a spike at step s arrives at s + dly
        counts = np.zeros(n, np.int32)
        rec_t, rec_i = [], []

        for s in range(steps):
            # 1. state update for non-resting, non-refractory neurons
            idx = np.flatnonzero(active)
            if len(idx):
                free = until[idx] <= s
                g[idx[~free]] = 0.0                           # Brian2 drops input that lands while refractory
                idx = idx[free]
                u0, g0 = v[idx] - p["v_0"], g[idx]
                v[idx] = p["v_0"] + (u0 - a * g0) * em + a * g0 * eg
                g[idx] = g0 * eg
                quiet = (np.abs(g[idx]) < EPS) & (np.abs(v[idx] - p["v_0"]) < EPS)
                if quiet.any():
                    q = idx[quiet]
                    v[q], g[q], active[q] = p["v_0"], 0.0, False
                # 2. threshold
                fired = idx[(v[idx] > p["v_th"]) & ~never[idx]]
            else:
                fired = idx
            # 3. synapses: deliver spikes from dly steps ago, then Poisson kicks
            src = queue[s % dly]
            if len(src):
                lo, hi = self.indptr[src], self.indptr[src + 1]
                ln = hi - lo
                tot = ln.sum()
                if tot:
                    seg = np.repeat(lo - np.concatenate(([0], np.cumsum(ln)[:-1])), ln) + np.arange(tot)
                    tgt = self.post[seg]
                    uniq, inv = np.unique(tgt, return_inverse=True)
                    g[uniq] += np.bincount(inv, weights=w[seg])
                    active[uniq] = True
            queue[s % dly] = fired
            for e, pr in stim:
                hit = e[rng.random(len(e)) < pr]
                if len(hit):
                    v[hit] += kick
                    active[hit] = True
            # 4. reset
            if len(fired):
                v[fired], g[fired] = p["v_rst"], 0.0
                until[fired] = s + 1 + rfc[fired]           # Brian2: frozen for t_rfc after the spike step
                counts[fired] += 1
                if record:
                    rec_t.append(np.full(len(fired), s * dt, np.float32))
                    rec_i.append(fired.astype(np.int32))

        if record:
            t = np.concatenate(rec_t) if rec_t else np.empty(0, np.float32)
            i = np.concatenate(rec_i) if rec_i else np.empty(0, np.int32)
            return counts, (t, i)
        return counts
