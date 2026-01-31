import torch
from prepare_data import load_data
from model import GraphSAGE

data = load_data()

model = GraphSAGE(data.num_node_features)
optimizer = torch.optim.Adam(model.parameters(), lr=0.01)

for epoch in range(30):
    model.train()
    optimizer.zero_grad()

    embeddings = model(data.x, data.edge_index)
    loss = embeddings.norm(p=2)

    loss.backward()
    optimizer.step()

    print(f"Epoch {epoch+1}, Loss: {loss.item()}")

torch.save(model.state_dict(), "gnn_model.pth")
print("✅ GNN model trained and saved")
