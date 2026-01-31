from fastapi import FastAPI, Query, HTTPException
import numpy as np
from gnn_loader import load_gnn_artifacts
import pandas as pd
gnn = load_gnn_artifacts()

app = FastAPI(title="AML Illicit Wallet API")
from fastapi.middleware.cors import CORSMiddleware

df = pd.read_csv("data/ethereum_transactions.csv")
df["value"] = pd.to_numeric(df["value"], errors="coerce")
df = df.dropna(subset=["value"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # allow frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
import networkx as nx
import pandas as pd

from illicit import (
    get_fan_out_nodes,
    get_fan_in_nodes,
    get_gather_scatter_nodes,
    find_peeling_paths_fanout_to_fanin,
    extract_peeling_paths,
    compute_rule_scores,
    extract_illicit_seeds
)

wallets = gnn["wallets"]
wallet_to_idx = gnn["wallet_to_idx"]
embeddings = gnn["embeddings"]
anomaly_score = gnn["anomaly_score"]
proximity_score = gnn["proximity_score"]
final_score = gnn["final_score"]



def load_graph_and_features():
   
    df = pd.read_csv("data/ethereum_transactions.csv")

    G = nx.DiGraph()
    for _, r in df.iterrows():
        G.add_edge(
            r["from_address"],
            r["to_address"],
            amount=float(r["value"])
        )

    # ---- Compute features ----
    fan_out = get_fan_out_nodes(G, threshold=3)
    fan_in = get_fan_in_nodes(G, threshold=3)
    gs_nodes = get_gather_scatter_nodes(G)

    fanout_fanin_paths = find_peeling_paths_fanout_to_fanin(
        G, fan_out, fan_in
    )
    peeling_paths = extract_peeling_paths(fanout_fanin_paths, G)

    rule_score = compute_rule_scores(
        fan_out, fan_in, gs_nodes, peeling_paths
    )

    illicit_seeds = extract_illicit_seeds(rule_score)
    
    return {
        "G": G,
        "fan_out": fan_out,
        "fan_in": fan_in,
        "gs_nodes": gs_nodes,
        "peeling_paths": peeling_paths,
        "rule_score": rule_score,
        "illicit_seeds": illicit_seeds
    }

ctx = load_graph_and_features()

G = ctx["G"]
fan_out = ctx["fan_out"]
fan_in = ctx["fan_in"]
peeling_paths = ctx["peeling_paths"]
rule_score = ctx["rule_score"]
illicit_seeds = ctx["illicit_seeds"]




@app.get("/wallets/illicit")
def list_illicit_wallets():
    return [
        {
            "wallet": w,
            "rule_score": rule_score[w]
        }
        for w in illicit_seeds
    ]


@app.get("/wallet/{wallet}/summary")
def wallet_summary(wallet: str):
    if wallet not in G:
        raise HTTPException(404, "Wallet not found")

    return {
        "wallet": wallet,
        "fan_out": wallet in fan_out,
        "fan_in": wallet in fan_in,
        "fan_out_count": G.out_degree(wallet),
        "fan_in_count": G.in_degree(wallet),
        "peeling_paths": sum(wallet in p for p in peeling_paths)
    }


@app.get("/wallet/{wallet}/fanout")
def wallet_fanout(
    wallet: str,
    limit: int = Query(10, ge=1, le=100)
):
    if wallet not in G:
        raise HTTPException(404, "Wallet not found")

    edges = []
    for v in list(G.successors(wallet))[:limit]:
        edges.append({
            "from": wallet,
            "to": v,
            "amount": G[wallet][v]["amount"]
        })

    return {"edges": edges}

@app.get("/wallet/{wallet}/fanin")
def wallet_fanin(
    wallet: str,
    limit: int = Query(10, ge=1, le=100)
):
    if wallet not in G:
        raise HTTPException(404, "Wallet not found")

    edges = []
    for u in list(G.predecessors(wallet))[:limit]:
        edges.append({
            "from": u,
            "to": wallet,
            "amount": G[u][wallet]["amount"]
        })

    return {"edges": edges}

@app.get("/wallet/{wallet}/peeling")

def wallet_peeling(wallet: str):
    if wallet not in G:
        raise HTTPException(404, "Wallet not found")

    return {
        "paths": [
            path for path in peeling_paths if wallet in path
        ]
    }


@app.get("/wallet/{wallet}/gnn-scores")
def get_gnn_scores(wallet: str):
    if wallet not in wallet_to_idx:
        raise HTTPException(status_code=404, detail="Wallet not found")

    idx = wallet_to_idx[wallet]

    return {
        "wallet": wallet,
        "gnn_anomaly_score": float(anomaly_score[idx]),
        "proximity_to_illicit": float(proximity_score[idx]),
        "final_suspicion_score": float(final_score[idx])
    }

@app.get("/wallet/{wallet}/gnn-neighbors")
def get_gnn_neighbors(
    wallet: str,
    k: int = Query(10, ge=1, le=50)
):
    if wallet not in wallet_to_idx:
        raise HTTPException(status_code=404, detail="Wallet not found")

    idx = wallet_to_idx[wallet]
    query_emb = embeddings[idx]

    # Cosine similarity (embeddings are already normalized)
    similarities = embeddings @ query_emb

    # Top K+1 (exclude self)
    top_indices = np.argsort(-similarities)[1:k+1]

    neighbors = []
    for i in top_indices:
        neighbors.append({
            "wallet": wallets[i],
            "similarity": float(similarities[i]),
            "gnn_anomaly_score": float(anomaly_score[i]),
            "proximity_to_illicit": float(proximity_score[i]),
            "final_suspicion_score": float(final_score[i])
        })

    return {
        "wallet": wallet,
        "neighbors": neighbors
    }

from datetime import datetime

@app.get("/wallet/{wallet}/timeseries")
def get_wallet_timeseries(wallet: str):
    if wallet not in G:
        raise HTTPException(404, "Wallet not found")
    
   
    mask = (df['from_address'] == wallet) | (df['to_address'] == wallet)
    relevant_txs = df[mask].copy()
    
   
    relevant_txs['block_timestamp'] = pd.to_datetime(relevant_txs['block_timestamp'])
    relevant_txs['date'] = relevant_txs['block_timestamp'].dt.date
    
   
    ts_data = relevant_txs.groupby('date').agg({
        'value': ['sum', 'count']
    })
    
   
    ts_data.columns = ['eth_volume', 'tx_count']
    ts_data = ts_data.reset_index()
    
   
    ts_data['date'] = ts_data['date'].astype(str)
    
    return ts_data.sort_values('date').to_dict(orient="records")
