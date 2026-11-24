"""Closed-loop brain for the 3D world: the same model as sim.py (Shiu et al. 2024 equations, Brian2 timing),
compiled with numba and kept running between calls, so senses can change every few milliseconds.

    b = LiveBrain(); b.set_input(index_array, rates_hz); counts, spikes = b.advance(50)   # 50 ms

Speed trick (exact): between inputs a neuron follows u(t) = u0 e^-t/tm + a g0 (e^-t/tau - e^-t/tm), whose peak is
at most max(u0, 0) + max(g0, 0) * PEAK. A neuron that cannot reach threshold that way is left asleep and is
fast-forwarded analytically (same formula, k steps at once) only when new input reaches it. Only neurons that
might fire, or are refractory, are stepped every 0.1 ms.
"""
from pathlib import Path

import numpy as np
from numba import njit

from sim import P

DATA = Path(__file__).parent / "data" / "brain.npz"


@njit(cache=True)
def _wake(i, s, v, g, tl, v0, em_l, eg_l, a):
    """bring a sleeping neuron's state forward to step s (k exact single-step updates at once)"""
    k = s - tl[i]
    if k > 0:
        u0 = v[i] - v0
        g0 = g[i]
        em = np.exp(em_l * k)
        eg = np.exp(eg_l * k)
        v[i] = v0 + (u0 - a * g0) * em + a * g0 * eg
        g[i] = g0 * eg
        tl[i] = s


@njit(cache=True)
def _advance(steps, s0, v, g, tl, until, rfc, never, active, alist, nact,
             indptr, post, w, ring, ringn, dly, stim_i, stim_p, kick,
             v0, vth, vrst, em_l, eg_l, a, peak, counts, rec_i, rec_s, nrec, fired, noise_lam, noise_amp, noise_idx):
    rec_cap = rec_i.shape[0]
    em, eg = np.exp(em_l), np.exp(eg_l)
    room = vth - v0
    for k in range(steps):
        s = s0 + k
        slot = s % dly
        # 1. state update for awake neurons; refractory ones keep g = 0 (Brian2 drops their input)
        fired_n = 0
        j = 0
        n = nact[0]
        for q in range(n):
            i = alist[q]
            tl[i] = s
            if until[i] > s:
                g[i] = 0.0
                alist[j] = i; j += 1
                continue
            u0 = v[i] - v0
            g0 = g[i]
            v[i] = v0 + (u0 - a * g0) * em + a * g0 * eg
            g[i] = g0 * eg
            # 2. threshold
            if v[i] > vth and not never[i]:
                fired[fired_n] = i; fired_n += 1
                alist[j] = i; j += 1
                continue
            if max(v[i] - v0, 0.0) + max(g[i], 0.0) * peak < room:
                active[i] = False                      # cannot fire without new input: sleep
                continue
            alist[j] = i; j += 1
        nact[0] = j
        # 3. synapses: spikes from dly steps ago arrive now
        for q in range(ringn[slot]):
            src = ring[slot, q]
            for e in range(indptr[src], indptr[src + 1]):
                t = post[e]
                if not active[t]:
                    _wake(t, s, v, g, tl, v0, em_l, eg_l, a)
                g[t] += w[e]
                if not active[t] and max(v[t] - v0, 0.0) + max(g[t], 0.0) * peak >= room:
                    active[t] = True
                    alist[nact[0]] = t; nact[0] += 1
        for q in range(fired_n):
            ring[slot, q] = fired[q]
        ringn[slot] = fired_n
        #    spontaneous background: random small synaptic events anywhere in the brain
        if noise_lam > 0.0:
            nn = noise_idx.shape[0]
            for _ in range(np.random.poisson(noise_lam)):
                t = noise_idx[np.random.randint(0, nn)]
                if not active[t]:
                    _wake(t, s, v, g, tl, v0, em_l, eg_l, a)
                g[t] += noise_amp
                if not active[t] and max(v[t] - v0, 0.0) + max(g[t], 0.0) * peak >= room:
                    active[t] = True
                    alist[nact[0]] = t; nact[0] += 1
        #    Poisson input (each event pushes v far above threshold)
        for q in range(stim_i.shape[0]):
            if stim_p[q] > 0.0 and np.random.random() < stim_p[q]:
                i = stim_i[q]
                if not active[i]:
                    _wake(i, s, v, g, tl, v0, em_l, eg_l, a)
                    active[i] = True
                    alist[nact[0]] = i; nact[0] += 1
                v[i] += kick
        # 4. reset (fired neurons stay awake through their refractory period)
        for q in range(fired_n):
            i = fired[q]
            v[i] = vrst; g[i] = 0.0
            until[i] = s + 1 + rfc[i]
            counts[i] += 1
            if nrec[0] < rec_cap:
                rec_i[nrec[0]] = i; rec_s[nrec[0]] = k; nrec[0] += 1


@njit(cache=True)
def _seed(x):
    np.random.seed(x)


class LiveBrain:
    def __init__(self, path=DATA, seed=0):
        d = np.load(path)
        self.ids = d["ids"]
        self.n = n = len(self.ids)
        self.indptr = d["indptr"].astype(np.int64)
        self.post = d["post"]                                   # int32
        self.w0 = d["w"].astype(np.float64) * P["w_syn"]
        self.w = self.w0.copy()
        dt = P["dt"]
        self.dly = int(round(P["t_dly"] / dt))
        self.rfc_steps = int(round(P["t_rfc"] / dt))
        self.em_l, self.eg_l = -dt / P["t_mbr"], -dt / P["tau"]
        self.a = P["tau"] / (P["tau"] - P["t_mbr"])
        t = np.arange(0, 200, dt)                               # peak of a (e^-t/tau - e^-t/tm) for g0 = 1
        self.peak = float((self.a * (np.exp(-t / P["tau"]) - np.exp(-t / P["t_mbr"]))).max()) * 1.0001
        self.v = np.full(n, P["v_0"]); self.g = np.zeros(n)
        self.tl = np.zeros(n, np.int64)
        self.until = np.full(n, -1, np.int64)
        self.never = np.zeros(n, np.bool_)
        self.active = np.zeros(n, np.bool_)
        self.alist = np.zeros(n, np.int64); self.nact = np.zeros(1, np.int64)
        self.ring = np.zeros((self.dly, n), np.int32); self.ringn = np.zeros(self.dly, np.int64)
        self.s = 0
        self.noise_lam, self.noise_amp = 0.0, 0.0
        self.noise_idx = np.arange(n, dtype=np.int64)
        self.stim_i = np.zeros(0, np.int64); self.stim_p = np.zeros(0)
        self.rfc = np.full(n, self.rfc_steps, np.int64)
        self.fired = np.zeros(n, np.int64)
        self.rec_i = np.zeros(200_000, np.int64); self.rec_s = np.zeros(200_000, np.int64)
        _seed(seed)

    def set_input(self, idx, hz):
        """Poisson drive: idx neurons at hz (array or scalar). Driven neurons have no refractory period."""
        idx = np.asarray(idx, np.int64)
        self.rfc[self.stim_i] = self.rfc_steps
        self.rfc[idx] = 0
        self.stim_i = idx
        self.stim_p = np.broadcast_to(np.asarray(hz, np.float64) * P["dt"] / 1000.0, idx.shape).copy()

    def quench(self, idx, ms=30.0):
        """a strong inhibitory pulse: these neurons go to rest and cannot fire for `ms`"""
        idx = np.asarray(idx, np.int64)
        self.v[idx] = P["v_0"]; self.g[idx] = 0.0
        self.until[idx] = np.maximum(self.until[idx], self.s + int(round(ms / P["dt"])))
        new = idx[~self.active[idx]]
        self.active[new] = True                          # keep them stepped while held
        self.alist[self.nact[0]:self.nact[0] + len(new)] = new; self.nact[0] += len(new)

    def reset(self):
        """quiet every neuron back to rest (used to stop runaway activity)"""
        self.v[:] = P["v_0"]; self.g[:] = 0.0
        self.active[:] = False; self.nact[0] = 0
        self.ringn[:] = 0
        self.until[:] = -1

    def set_noise(self, hz, synapses, idx=None):
        """Spontaneous activity: neurons in idx (default all) get random excitatory events at `hz`, each as
        strong as `synapses` synapses (the real brain is never silent; the published model is, without input)."""
        self.noise_idx = np.arange(self.n, dtype=np.int64) if idx is None else np.asarray(idx, np.int64)
        self.noise_lam = len(self.noise_idx) * hz * P["dt"] / 1000.0
        self.noise_amp = synapses * P["w_syn"]

    def silence(self, idx):
        self.w[:] = self.w0
        self.never[:] = False
        for i in np.asarray(idx, np.int64):
            self.w[self.indptr[i]:self.indptr[i + 1]] = 0.0
            self.never[i] = True

    def advance(self, ms):
        steps = int(round(ms / P["dt"]))
        counts = np.zeros(self.n, np.int32)
        nrec = np.zeros(1, np.int64)
        _advance(steps, self.s, self.v, self.g, self.tl, self.until, self.rfc, self.never, self.active, self.alist,
                 self.nact, self.indptr, self.post, self.w, self.ring, self.ringn, self.dly, self.stim_i,
                 self.stim_p, P["w_syn"] * P["f_poi"], P["v_0"], P["v_th"], P["v_rst"], self.em_l, self.eg_l,
                 self.a, self.peak, counts, self.rec_i, self.rec_s, nrec, self.fired,
                 self.noise_lam, self.noise_amp, self.noise_idx)
        self.s += steps
        k = nrec[0]
        return counts, (self.rec_i[:k].copy(), self.rec_s[:k] * P["dt"])
