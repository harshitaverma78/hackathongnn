import torch
import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler
from prepare_data import load_data
from model import GraphSAGE

# -------------------------------
# Load graph + model
# -------------------------------
data = load_data()

model = GraphSAGE(data.num_node_features)
model.load_state_dict(torch.load("gnn_model.pth"))
model.eval()

with torch.no_grad():
    embeddings = model(data.x, data.edge_index).numpy()

# -------------------------------
# Normalize embeddings
# -------------------------------
embeddings = embeddings / (np.linalg.norm(embeddings, axis=1, keepdims=True) + 1e-8)

# -------------------------------
# Load illicit seed wallets (FLEXIBLE)
# -------------------------------
seeds_df = pd.read_csv("illicitseeds/illicit_seed_wallets.csv")

# Try to infer wallet column
wallet_col = None
for col in seeds_df.columns:
    if "wallet" in col.lower() or "address" in col.lower():
        wallet_col = col
        break

if wallet_col is None:
    raise ValueError("❌ No wallet/address column found in illicit_seed_wallets.csv")

illicit_wallets = set(seeds_df[wallet_col].astype(str))

# -------------------------------
# Map wallet → index
# -------------------------------
wallet_to_idx = {w: i for i, w in enumerate(data.wallets)}

seed_indices = [
    wallet_to_idx[w]
    for w in illicit_wallets
    if w in wallet_to_idx
]

print(f"✅ Loaded {len(seed_indices)} illicit seed wallets")

# -------------------------------
# 1️⃣ GNN anomaly score
# -------------------------------
center = embeddings.mean(axis=0)
anomaly_dist = np.linalg.norm(embeddings - center, axis=1)

# -------------------------------
# 2️⃣ Proximity to illicit wallets
# -------------------------------
if len(seed_indices) > 0:
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

# -------------------------------
# Normalize scores
# -------------------------------
scaler = MinMaxScaler()

anomaly_score = scaler.fit_transform(
    anomaly_dist.reshape(-1, 1)
).flatten()

proximity_score = 1 - scaler.fit_transform(
    proximity_dist.reshape(-1, 1)
).flatten()

# -------------------------------
# FINAL SUSPICION SCORE
# -------------------------------
final_score = (
    0.6 * anomaly_score +
    0.4 * proximity_score
)

# -------------------------------
# Output
# -------------------------------
output = pd.DataFrame({
    "wallet_address": data.wallets,
    "gnn_anomaly_score": anomaly_score,
    "proximity_to_illicit": proximity_score,
    "final_suspicion_score": final_score
})

output.to_csv("gnn_predictions.csv", index=False)
print("✅ Final suspicion scores generated successfully")
