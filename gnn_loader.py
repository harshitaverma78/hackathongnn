import torch
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from prepare_data import load_data
from model import GraphSAGE

def load_gnn_artifacts():
    # Load graph data
    data = load_data()

    # Load model
    model = GraphSAGE(data.num_node_features)
    model.load_state_dict(torch.load("gnn_model.pth", map_location="cpu"))
    model.eval()

    # Generate embeddings
    with torch.no_grad():
        embeddings = model(data.x, data.edge_index).numpy()

    # Normalize embeddings
    embeddings = embeddings / (
        np.linalg.norm(embeddings, axis=1, keepdims=True) + 1e-8
    )

    # Load illicit seeds
    seeds_df = pd.read_csv("illicitseeds/illicit_seed_wallets.csv")
    wallet_col = next(
        c for c in seeds_df.columns
        if "wallet" in c.lower() or "address" in c.lower()
    )
    illicit_wallets = set(seeds_df[wallet_col].astype(str))

    wallet_to_idx = {w: i for i, w in enumerate(data.wallets)}
    seed_indices = [
        wallet_to_idx[w] for w in illicit_wallets if w in wallet_to_idx
    ]

    # Anomaly score
    center = embeddings.mean(axis=0)
    anomaly_dist = np.linalg.norm(embeddings - center, axis=1)

    # Proximity score
    if seed_indices:
        seed_emb = embeddings[seed_indices]
        proximity_dist = np.min(
            np.linalg.norm(
                embeddings[:, None, :] - seed_emb[None, :, :],
                axis=2
            ),
            axis=1
        )
    else:
        proximity_dist = np.zeros(len(embeddings))

    scaler = MinMaxScaler()
    anomaly_score = scaler.fit_transform(
        anomaly_dist.reshape(-1, 1)
    ).flatten()

    proximity_score = 1 - scaler.fit_transform(
        proximity_dist.reshape(-1, 1)
    ).flatten()

    final_score = (
        0.6 * anomaly_score +
        0.4 * proximity_score
    )

    return {
        "wallets": data.wallets,
        "wallet_to_idx": wallet_to_idx,
        "embeddings": embeddings,
        "anomaly_score": anomaly_score,
        "proximity_score": proximity_score,
        "final_score": final_score,
    }
