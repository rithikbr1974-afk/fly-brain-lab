"""One-time data prep: FlyWire v783 connectome (Shiu et al. repo) + FlyWire annotations -> data/brain.npz.

Run once:  .venv/Scripts/python prep.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent
REPO = ROOT / "Drosophila_brain_model"
OUT = ROOT / "data" / "brain.npz"


def main():
    comp = pd.read_csv(REPO / "Completeness_783.csv", index_col=0)
    ids = comp.index.to_numpy(np.int64)
    n = len(ids)

    con = pd.read_parquet(REPO / "Connectivity_783.parquet",
                          columns=["Presynaptic_Index", "Postsynaptic_Index", "Excitatory x Connectivity"])
    pre = con["Presynaptic_Index"].to_numpy(np.int64)
    post = con["Postsynaptic_Index"].to_numpy(np.int32)
    w = con["Excitatory x Connectivity"].to_numpy(np.float32)  # signed synapse count
    order = np.argsort(pre, kind="stable")
    pre, post, w = pre[order], post[order], w[order]
    indptr = np.zeros(n + 1, np.int64)
    np.add.at(indptr, pre + 1, 1)
    indptr = np.cumsum(indptr)

    ann = pd.read_csv(ROOT / "data" / "neuron_annotations.tsv", sep="\t", low_memory=False).set_index("root_id")
    ann = ann.reindex(ids)
    # soma if known, else a point on the neuron; voxel units are 4 x 4 x 40 nm -> microns
    xyz = np.stack([ann.soma_x.fillna(ann.pos_x), ann.soma_y.fillna(ann.pos_y), ann.soma_z.fillna(ann.pos_z)], 1)
    xyz = (xyz * np.array([4, 4, 40]) / 1000).astype(np.float32)

    text = lambda c: ann[c].fillna("").astype(str).to_numpy().astype(str)  # fixed-width, loads without pickle
    np.savez_compressed(
        OUT, ids=ids, indptr=indptr, post=post, w=w, xyz=xyz,
        cell_type=text("cell_type"), super_class=text("super_class"), cell_class=text("cell_class"),
        cell_sub_class=text("cell_sub_class"), side=text("side"), nt=text("top_nt"),
    )
    print(f"{n} neurons, {len(post)} connections, {np.isnan(xyz[:, 0]).sum()} without position -> {OUT}")


if __name__ == "__main__":
    main()
