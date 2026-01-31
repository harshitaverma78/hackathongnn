from collections import defaultdict
import networkx as nx

import pandas as pd
import networkx as nx

df = pd.read_csv("data/ethereum_transactions.csv")
df["value"] = pd.to_numeric(df["value"], errors="coerce")
df = df.dropna(subset=["value"])

G = nx.DiGraph()

for _, r in df.iterrows():
    G.add_edge(
        r["from_address"],
        r["to_address"],
        amount=float(r["value"]),
        time=r.get("block_timestamp", None)
    )

print("Wallets:", G.number_of_nodes())
print("Transactions:", G.number_of_edges())

def get_fan_out_nodes(G, threshold=4):
    """
    Wallets with high outgoing degree
    """
    return {n for n in G.nodes() if G.out_degree(n) >= threshold}


def get_fan_in_nodes(G, threshold=4):
    """
    Wallets with high incoming degree
    """
    return {n for n in G.nodes() if G.in_degree(n) >= threshold}


# =====================================================
# GATHER–SCATTER
# =====================================================

def get_gather_scatter_nodes(G, gather_th=3, scatter_th=3):
    """
    Wallets that both gather (fan-in) and scatter (fan-out)
    """
    return {
        n for n in G.nodes()
        if G.in_degree(n) >= gather_th and G.out_degree(n) >= scatter_th
    }



# PEELING DETECTION (PATH-BASED)


def is_peeling_path(path, G, decay_low=0.8, decay_high=0.99):
    """
    Check whether a given path exhibits monotonic value decay
    """
    try:
        amounts = [
            G[path[i]][path[i+1]]["amount"]
            for i in range(len(path) - 1)
        ]
    except KeyError:
        return False

    for i in range(len(amounts) - 1):
        if amounts[i+1] >= amounts[i]:
            return False
        ratio = amounts[i+1] / amounts[i]
        if not (decay_low < ratio < decay_high):
            return False

    return True


def find_peeling_paths_fanout_to_fanin(
    G,
    fan_out_nodes,
    fan_in_nodes,
    max_depth=6,
    max_paths=5000
):
    """
    Find fan-out → fan-in paths and filter those that are peeling-like
    """
    fan_in_set = set(fan_in_nodes)
    all_paths = []

    for src in fan_out_nodes:
        paths = nx.single_source_shortest_path(G, src, cutoff=max_depth)
        for path in paths.values():
            if len(path) < 3:
                continue
            if path[-1] in fan_in_set:
                all_paths.append(path)
                if len(all_paths) >= max_paths:
                    return all_paths

    return all_paths


def extract_peeling_paths(paths, G):
    """
    Filter only peeling-like paths
    """
    return [
        p for p in paths
        if len(p) >= 3 and is_peeling_path(p, G)
    ]


# =====================================================
# RULE-BASED SCORING
# =====================================================

def compute_rule_scores(
    fan_out_nodes,
    fan_in_nodes,
    gather_scatter_nodes,
    peeling_paths
):
    """
    Aggregate rule-based risk scores
    """
    rule_score = defaultdict(int)

    for w in fan_out_nodes:
        rule_score[w] += 25

    for w in fan_in_nodes:
        rule_score[w] += 25

    for w in gather_scatter_nodes:
        rule_score[w] += 30

    for path in peeling_paths:
        for w in path:
            rule_score[w] += 40

    # Cap scores
    for w in rule_score:
        rule_score[w] = min(rule_score[w], 100)

    return rule_score


# =====================================================
# ILLICIT SEED SELECTION
# =====================================================

def extract_illicit_seeds(rule_score, threshold=70):
    """
    Select high-confidence illicit wallets
    """
    return {w for w, s in rule_score.items() if s >= threshold}


# =====================================================
# WALLET EXPLANATION (ANALYST VIEW)
# =====================================================

def explain_illicit_wallet(
    wallet,
    G,
    fan_out_nodes,
    fan_in_nodes,
    peeling_paths,
    min_eth=0.0
):
    """
    Print a detailed explanation for a single illicit wallet
    """
    print("=" * 80)
    print(f"ILLICIT WALLET PROFILE")
    print(f"Wallet: {wallet}")
    print("=" * 80)

    # FAN-OUT
    print("\n🔻 FAN-OUT")
    if wallet in fan_out_nodes:
        for v in G.successors(wallet):
            amt = G[wallet][v].get("amount", 0) / 1e18
            if amt >= min_eth:
                print(f"  {wallet} → {v} | {amt:.4f} ETH")
    else:
        print("  Not a fan-out wallet")

    # FAN-IN
    print("\n🔺 FAN-IN")
    if wallet in fan_in_nodes:
        for u in G.predecessors(wallet):
            amt = G[u][wallet].get("amount", 0) / 1e18
            if amt >= min_eth:
                print(f"  {u} → {wallet} | {amt:.4f} ETH")
    else:
        print("  Not a fan-in wallet")

    # PEELING
    print("\n🔁 PEELING PATHS")
    involved = [p for p in peeling_paths if wallet in p]

    if not involved:
        print("  No peeling paths involving this wallet")
    else:
        for i, path in enumerate(involved, 1):
            print(f"\n  Path {i} (length {len(path)}):")
            for j in range(len(path) - 1):
                u, v = path[j], path[j + 1]
                amt = G[u][v]["amount"] / 1e18
                marker = " <== TARGET" if wallet in (u, v) else ""
                print(f"    {u} → {v} | {amt:.4f} ETH{marker}")

    print("\n" + "=" * 80)
