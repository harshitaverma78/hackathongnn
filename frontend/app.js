const API = "http://localhost:8000";
let selectedWallet = null;

// ---------- INIT ----------
window.onload = async () => {
  drawPlaceholder();

  const res = await fetch(`${API}/wallets/illicit`);
  const data = await res.json();

  const list = document.getElementById("walletList");

  data.forEach(w => {
    const li = document.createElement("li");
    li.textContent = `${w.wallet} (score: ${w.rule_score.toFixed(2)})`;
    li.onclick = () => selectWallet(w.wallet);
    list.appendChild(li);
  });
};

// ---------- UI HELPERS ----------
function clearGraph() {
  document.getElementById("graph").innerHTML = "";
}

function drawPlaceholder() {
  const svg = document.getElementById("graph");
  svg.innerHTML = `
    <text x="400" y="200"
      fill="#64748b"
      font-size="16"
      text-anchor="middle">
      Select an illicit wallet to visualize transactions
    </text>
  `;
}

function drawNode(x, y, label, color) {
  const svg = document.getElementById("graph");
  svg.innerHTML += `
    <circle cx="${x}" cy="${y}" r="18" fill="${color}" />
    <text x="${x}" y="${y+4}" text-anchor="middle"
      fill="black" font-size="9">
      ${label.slice(0,6)}
    </text>
  `;
}

function drawEdge(x1, y1, x2, y2, label="") {
  const svg = document.getElementById("graph");
  svg.innerHTML += `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
      stroke="#38bdf8" stroke-width="2" />
    <text x="${(x1+x2)/2}" y="${(y1+y2)/2 - 5}"
      fill="white" font-size="10">${label}</text>
  `;
}

// ---------- WALLET SELECT ----------
async function selectWallet(wallet) {
  selectedWallet = wallet;

  const res = await fetch(`${API}/wallet/${wallet}/summary`);
  const data = await res.json();

  document.getElementById("walletInfo").innerHTML = `
    <h2>Wallet Summary</h2>
    <p><b>${data.wallet}</b></p>
    <p>Fan-Out: ${data.fan_out_count}</p>
    <p>Fan-In: ${data.fan_in_count}</p>
    <p>Peeling Paths: ${data.peeling_paths}</p>
  `;

  loadFanOut(); // auto-draw something
}

// ---------- FAN OUT ----------
async function loadFanOut() {
  if (!selectedWallet) return;
  clearGraph();

  const res = await fetch(`${API}/wallet/${selectedWallet}/fanout?limit=6`);
  const data = await res.json();

  if (data.edges.length === 0) {
    drawPlaceholder();
    return;
  }

  drawNode(400, 220, selectedWallet, "#f87171");

  data.edges.forEach((e, i) => {
    const x = 150 + i * 100;
    const y = 80;
    drawNode(x, y, e.to, "#4ade80");
    drawEdge(400, 220, x, y, e.amount);
  });
}

// ---------- FAN IN ----------
async function loadFanIn() {
  if (!selectedWallet) return;
  clearGraph();

  const res = await fetch(`${API}/wallet/${selectedWallet}/fanin?limit=6`);
  const data = await res.json();

  if (data.edges.length === 0) {
    drawPlaceholder();
    return;
  }

  drawNode(400, 200, selectedWallet, "#f87171");

  data.edges.forEach((e, i) => {
    const x = 150 + i * 100;
    const y = 320;
    drawNode(x, y, e.from, "#facc15");
    drawEdge(x, y, 400, 200, e.amount);
  });
}

// ---------- PEELING ----------
async function loadPeeling() {
  if (!selectedWallet) return;
  clearGraph();

  const res = await fetch(`${API}/wallet/${selectedWallet}/peeling`);
  const data = await res.json();

  if (data.paths.length === 0) {
    drawPlaceholder();
    return;
  }

  const path = data.paths[0];
  path.forEach((w, i) => {
    const x = 120 + i * 120;
    const y = 200;
    drawNode(x, y, w, "#fb7185");
    if (i > 0) drawEdge(x - 120, y, x, y);
  });
}

// ---------- GNN ----------
async function loadGNN() {
  if (!selectedWallet) return;
  clearGraph();

  const res = await fetch(`${API}/wallet/${selectedWallet}/gnn-neighbors?k=6`);
  const data = await res.json();

  drawNode(400, 200, selectedWallet, "#f87171");

  data.neighbors.forEach((n, i) => {
    const angle = (2 * Math.PI / data.neighbors.length) * i;
    const x = 400 + Math.cos(angle) * 220;
    const y = 200 + Math.sin(angle) * 140;

    drawNode(x, y, n.wallet, "#38bdf8");
    drawEdge(400, 200, x, y, n.similarity.toFixed(2));
  });
}
