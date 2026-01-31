import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

const API = "http://localhost:8000";

export default function AMLExplorer() {
  const [wallets, setWallets] = useState([]);
  const [selected, setSelected] = useState("");
  const [activeNode, setActiveNode] = useState(null);
  const [mode, setMode] = useState("fanout");
  const [graphData, setGraphData] = useState([]);
  const [timeSeries, setTimeSeries] = useState([]); 
  const [timeStep, setTimeStep] = useState(100);
  const [nodeDetails, setNodeDetails] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null); 

  const svgRef = useRef();
  const scatterRef = useRef(); 
  const timers = useRef([]);

  useEffect(() => {
    fetch(`${API}/wallets/illicit`).then(r => r.json()).then(setWallets);
  }, []);

  useEffect(() => {
    if (!selected) return;
    loadData();
    loadTimeSeries(); 
    return () => stopAnimations();
  }, [selected, mode]);

  useEffect(() => {
    if (!activeNode) return;
    fetch(`${API}/wallet/${activeNode}/gnn-scores`).then(r => r.json()).then(setNodeDetails);
  }, [activeNode]);

  const stopAnimations = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (svgRef.current) d3.select(svgRef.current).selectAll("*").interrupt().remove();
  };

  const loadData = async () => {
    stopAnimations();
    let endpoint = `${API}/wallet/${selected}/${mode}`;
    if (mode === "gnn") endpoint = `${API}/wallet/${selected}/gnn-neighbors?k=20`;
    const res = await fetch(endpoint).then(r => r.json());
    setGraphData(res.edges || res.neighbors || (res.paths ? res.paths : []));
  };

  const loadTimeSeries = async () => {
    const res = await fetch(`${API}/wallet/${selected}/timeseries`).then(r => r.json());
    setTimeSeries(res);
  };

  /* ---------- SUMMARY CALCULATIONS ---------- */
  const visibleTS = timeSeries.slice(0, Math.floor((timeStep / 100) * timeSeries.length));
  const totalVolume = visibleTS.reduce((acc, curr) => acc + (curr.eth_volume / 1e18), 0);
  const activeStart = visibleTS.length > 0 ? visibleTS[0].date : "N/A";
  const activeEnd = visibleTS.length > 0 ? visibleTS[visibleTS.length - 1].date : "N/A";

  /* ---------- DRAW INTERACTIVE TIMELINE ---------- */
  useEffect(() => {
    if (!timeSeries.length || !scatterRef.current) return;
    const svg = d3.select(scatterRef.current);
    svg.selectAll("*").remove();

    const containerWidth = scatterRef.current.clientWidth;
    const margin = { top: 20, right: 30, bottom: 30, left: 55 };
    const width = containerWidth - margin.left - margin.right;
    const height = 140 - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime()
      .domain(d3.extent(timeSeries, d => new Date(d.date)))
      .range([0, width]);

    const y = d3.scaleLog()
      .domain([1e14, d3.max(timeSeries, d => d.eth_volume) || 1e18]) 
      .range([height, 0]);

    g.append("g").attr("class", "grid").style("stroke-dasharray", "3,3").style("opacity", 0.1)
      .call(d3.axisLeft(y).ticks(3).tickSize(-width).tickFormat(""));

    g.append("g").attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat("%b %d")))
      .attr("font-size", "9px").attr("color", "#64748b");

    g.append("g").call(d3.axisLeft(y).ticks(3, ".0e")).attr("font-size", "9px").attr("color", "#64748b");

    g.selectAll("circle")
      .data(timeSeries)
      .enter().append("circle")
      .attr("cx", d => x(new Date(d.date)))
      .attr("cy", d => y(d.eth_volume))
      .attr("r", d => Math.sqrt(d.tx_count) + 4)
      .attr("fill", (d, i) => i < (timeStep / 100) * timeSeries.length ? "#38bdf8" : "#1e293b")
      .attr("fill-opacity", 0.6)
      .attr("stroke", d => selectedLog?.date === d.date ? "#fff" : "none")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("click", (e, d) => setSelectedLog(d))
      .on("mouseover", function(event, d) {
        d3.select(this).attr("r", Math.sqrt(d.tx_count) + 8).attr("fill-opacity", 1);
        setTooltip({ x: event.pageX, y: event.pageY, text: `${d.date} | Vol: ${(d.eth_volume / 1e18).toFixed(4)} ETH` });
      })
      .on("mouseout", function() {
        d3.select(this).attr("r", d => Math.sqrt(d.tx_count) + 4).attr("fill-opacity", 0.6);
        setTooltip(null);
      });

  }, [timeSeries, timeStep, selectedLog]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!selected || !graphData.length) return;
    mode === "peeling" ? drawWaterfall(svg) : drawRadial(svg);
  }, [graphData, timeStep, selected]);

  function renderNode(svg, x, y, id, isRoot, score = 0) {
    const g = svg.append("g").attr("transform", `translate(${x},${y})`).style("cursor", "crosshair")
      .on("click", () => setActiveNode(id))
      .on("dblclick", () => { setSelected(id); setActiveNode(null); });

    g.append("circle").attr("r", isRoot ? 20 : 14)
      .attr("fill", isRoot || score > 0.7 ? "#ef4444" : "#38bdf8")
      .style("filter", (isRoot || score > 0.7) ? "drop-shadow(0 0 12px #ef4444)" : "none");

    g.append("text").text(id.slice(0, 6)).attr("y", 28).attr("text-anchor", "middle").attr("fill", "#94a3b8").style("font-size", "11px");
  }

  function renderLink(svg, x1, y1, x2, y2, score = 0, amount = 0) {
    const thickness = amount ? Math.max(1, Math.min(8, Math.log10(amount / 1e18 + 1) * 3)) : 1.5;
    svg.append("line").attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2)
      .attr("stroke", score > 0.7 ? "#ef4444" : "#334155")
      .attr("stroke-width", thickness).attr("stroke-dasharray", "4,2").attr("opacity", 0.6);
  }

  function drawRadial(svg) {
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const cx = width / 2, cy = height / 2;
    renderNode(svg, cx, cy, selected, true);
    const visible = graphData.slice(0, Math.floor((timeStep / 100) * graphData.length));
    visible.forEach((d, i) => {
      const angle = (i / visible.length) * 2 * Math.PI;
      const x = cx + 220 * Math.cos(angle), y = cy + 220 * Math.sin(angle);
      renderLink(svg, cx, cy, x, y, d.final_suspicion_score, d.amount);
      renderNode(svg, x, y, d.to || d.wallet || d.from, false, d.final_suspicion_score);
    });
  }

  function drawWaterfall(svg) {
    const startX = 100, startY = 80, xGap = 160, yGap = 90;
    graphData.slice(0, 8).forEach((path, pIdx) => {
      path.forEach((w, nIdx) => {
        const t = setTimeout(() => {
          const x = startX + (nIdx * xGap), y = startY + (pIdx * yGap);
          renderNode(svg, x, y, w, nIdx === 0);
          if (nIdx > 0) renderLink(svg, x - xGap + 12, y, x - 12, y, 0, 1e18); 
        }, (pIdx * 250) + (nIdx * 150));
        timers.current.push(t);
      });
    });
  }

  return (
    <div className="flex h-screen bg-[#020617] text-slate-200 overflow-hidden font-sans">
      <aside className="w-72 border-r border-slate-800 p-5 space-y-8 flex-shrink-0 bg-[#030712] z-10 shadow-2xl">
        <h1 className="text-2xl font-black tracking-tighter text-sky-400 border-b border-slate-800 pb-4 text-center">AML.EYE</h1>
        
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">ILLICIT SEEDS</label>
          <select className="w-full bg-slate-900 border border-slate-700 p-2 rounded text-xs" value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Select Target Wallet</option>
            {wallets.map(w => <option key={w.wallet} value={w.wallet}>{w.wallet.slice(0, 18)}...</option>)}
          </select>
        </div>

        <div className="space-y-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Analysis Mode</label>
          <div className="grid grid-cols-2 gap-2">
            {["fanout", "fanin", "peeling", "gnn"].map(m => (
              <button key={m} onClick={() => setMode(m)} className={`py-2 rounded text-[10px] font-bold uppercase border transition-all ${mode === m ? 'bg-sky-500 border-sky-400 text-slate-900 shadow-lg shadow-sky-500/20' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}>{m}</button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 block text-center">Chronological Scrub</label>
          <input type="range" className="w-full accent-sky-500 mt-2" value={timeStep} onChange={e => setTimeStep(e.target.value)} />
        </div>
      </aside>

      <main className="flex-1 flex flex-col bg-slate-950 relative">
        <div className="flex-1 min-h-0 relative">
          <svg ref={svgRef} className="w-full h-full" />
          
          {selected && (
            <div className="absolute top-4 right-4 bg-slate-900/80 border border-slate-800 p-4 rounded-xl backdrop-blur-md shadow-2xl pointer-events-none space-y-2 min-w-[200px]">
              <div className="text-[9px] font-black text-sky-500 uppercase tracking-[0.2em] mb-2 border-b border-slate-800 pb-1">Trial Summary</div>
              <SummaryItem label="Total Trail Vol" value={`${totalVolume.toFixed(2)} ETH`} />
              <SummaryItem label="Active Period" value={`${activeStart} ➔ ${activeEnd}`} />
              <SummaryItem label="Path Intensity" value={mode.toUpperCase()} />
            </div>
          )}
        </div>

        <div className="h-44 border-t border-slate-800 bg-[#030712]/95 backdrop-blur-md p-4 px-6 z-10 flex flex-col relative">
          <div className="flex justify-between items-center mb-1">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Volume Timeline (Log ETH)</h3>
            <span className="text-[10px] font-mono text-sky-500">Click bubble to view logs</span>
          </div>
          <div className="w-full h-24 mt-2 bg-slate-900/30 rounded border border-slate-800/50 relative">
             <svg ref={scatterRef} className="w-full h-full" />
          </div>

          <div className={`absolute left-0 right-0 bottom-0 bg-slate-900 border-t border-sky-500/30 transition-all duration-500 overflow-hidden ${selectedLog ? 'h-40' : 'h-0'}`}>
            <div className="p-4 flex flex-col h-full">
               <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-bold text-sky-400 uppercase">Transactions on {selectedLog?.date}</span>
                  <button onClick={() => setSelectedLog(null)} className="text-slate-500 text-xs">CLOSE</button>
               </div>
               <div className="flex-1 overflow-y-auto font-mono text-[10px]">
                  <table className="w-full text-left">
                    <thead className="text-slate-500 border-b border-slate-800">
                      <tr><th className="py-1">ID</th><th>VOLUME</th><th>IMPACT</th></tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-800/50">
                        <td className="py-2 text-slate-400">TX_BATCH_{selectedLog?.date?.replace(/-/g,'')}</td>
                        <td className="text-emerald-400">{(selectedLog?.eth_volume/1e18).toFixed(4)} ETH</td>
                        <td>{selectedLog?.tx_count} Events</td>
                      </tr>
                    </tbody>
                  </table>
               </div>
            </div>
          </div>
        </div>
        
        {tooltip && (
          <div className="absolute pointer-events-none bg-slate-900 border border-slate-700 p-2 rounded text-[10px] z-50 shadow-2xl"
               style={{ left: tooltip.x - 300, top: tooltip.y - 40 }}>
            {tooltip.text}
          </div>
        )}
      </main>

      <aside className={`w-80 border-l border-slate-800 bg-[#030712] p-6 transition-all duration-500 z-20 ${activeNode ? 'translate-x-0' : 'translate-x-full absolute right-0'}`}>
        {nodeDetails ? (
          <div className="space-y-8">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Intelligence Report</h2>
              <button onClick={() => setActiveNode(null)} className="text-slate-500 hover:text-white">✕</button>
            </div>
            <div className="break-all font-mono text-[10px] bg-slate-900 p-3 rounded border border-slate-800 text-sky-300 shadow-inner">{nodeDetails.wallet}</div>
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 p-6 rounded-2xl border border-slate-800 text-center">
              <div className="text-[10px] text-slate-500 uppercase font-black mb-1">Risk Confidence</div>
              <div className={`text-5xl font-black ${(nodeDetails.final_suspicion_score > 0.7) ? 'text-red-500' : 'text-emerald-400'}`}>
                {(nodeDetails.final_suspicion_score * 100).toFixed(1)}%
              </div>
            </div>
            <div className="space-y-5">
              <DetailRow label="GNN Anomaly" value={nodeDetails.gnn_anomaly_score} />
              <DetailRow label="Seed Proximity" value={nodeDetails.proximity_to_illicit} />
            </div>
            <button onClick={() => { setSelected(activeNode); setActiveNode(null); }} className="w-full py-4 bg-white text-black text-xs font-black rounded-xl hover:bg-sky-400 uppercase tracking-widest active:scale-95 shadow-lg">Pivot Investigation</button>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-4 px-8 text-center opacity-40 italic">Select a node or illicit seed to generate forensic intelligence report.</div>
        )}
      </aside>
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div className="flex justify-between text-[9px]">
      <span className="text-slate-500 uppercase tracking-tight">{label}</span>
      <span className="text-slate-200 font-mono font-bold">{value}</span>
    </div>
  );
}

function DetailRow({ label, value }) {
  const percent = (value * 100).toFixed(0);
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] font-bold">
        <span className="text-slate-500 uppercase">{label}</span>
        <span className="text-sky-400">{percent}%</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden shadow-inner border border-slate-700/50">
        <div className="h-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-1000 shadow-[0_0_8px_rgba(56,189,248,0.4)]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}