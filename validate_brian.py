"""Cross-check sim.py against the original Brian2 model (numpy target) on sugar 100 Hz."""
import sys, time
import numpy as np
sys.path.insert(0, "Drosophila_brain_model")
from brian2 import prefs, Hz, ms
prefs.codegen.target = "numpy"
from model import run_trial, default_params
from sim import Brain

sugar = [720575940624963786,720575940630233916,720575940637568838,720575940638202345,720575940617000768,720575940630797113,720575940632889389,720575940621754367,720575940621502051,720575940640649691,720575940639332736,720575940616885538,720575940639198653,720575940620900446,720575940617937543,720575940632425919,720575940633143833,720575940612670570,720575940628853239,720575940629176663,720575940611875570]
b = Brain()
e = [b.index[i] for i in sugar if i in b.index]
p = dict(default_params, r_poi=100 * Hz, t_run=1000 * ms)
n = 2
br = np.zeros(b.n); mine = np.zeros(b.n)
for k in range(n):
    t = time.time()
    import gc; gc.collect()
    spk = run_trial(e, [], [], "Drosophila_brain_model/Completeness_783.csv", "Drosophila_brain_model/Connectivity_783.parquet", p)
    for i, s in spk.items():
        br[i] += len(s)
    print("brian trial", k, round(time.time() - t), "s", flush=True)
    mine += b.run([e], [100], seed=k)
br /= n; mine /= n
mn9 = b.index[720575940660219265]
act = (br > 0) | (mine > 0)
print("MN9 brian", br[mn9], "mine", mine[mn9])
print("active brian", (br > 0).sum(), "mine", (mine > 0).sum(), "corr", np.corrcoef(br[act], mine[act])[0, 1])
top = np.argsort(-br)[:15]
for i in top: print(b.ids[i], br[i], mine[i])
