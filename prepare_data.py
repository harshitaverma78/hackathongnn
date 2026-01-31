import pandas as pd
import torch
import numpy as np
from torch_geometric.data import Data

def load_data():
    df = pd.read_csv("data/etherium_dataset.csv")

    # Ensure numeric
    df["value"] = pd.to_numeric(df["value"], errors="coerce").fillna(0)

    wallets = pd.concat([df["from_address"], df["to_address"]]).unique()
    wallet_to_id = {w: i for i, w in enumerate(wallets)}

    src = df["from_address"].map(wallet_to_id).to_numpy()
    dst = df["to_address"].map(wallet_to_id).to_numpy()

    edge_index = torch.tensor(
        np.vstack((src, dst)),
        dtype=torch.long
    )

    # Node features: out-degree, in-degree, total ETH sent
    num_nodes = len(wallets)
    features = np.zeros((num_nodes, 3), dtype=np.float32)

    for _, row in df.iterrows():
        s = wallet_to_id[row["from_address"]]
        d = wallet_to_id[row["to_address"]]
        features[s][0] += 1
        features[d][1] += 1
        features[s][2] += row["value"]

    # Normalize features (important)
    features = features / (features.max(axis=0) + 1e-6)

    x = torch.tensor(features, dtype=torch.float)
    data = Data(x=x, edge_index=edge_index)
    data.wallets = wallets

    return data
