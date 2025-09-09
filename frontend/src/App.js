import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { Check, CircleAlert, QrCode, Upload, Download, Trash2, History, Server, WifiOff, Settings, Undo2, Search } from "lucide-react";

// --- Utilidades ---
const nowCL = () => new Date();
const fmt = (d) => new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "medium" }).format(d);

const STATUS = {
  REGISTRADO: "registrado",
  RETIRADO: "retirado",
};

// Beep simple
const playBeep = (ok = true) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = ok ? "triangle" : "sawtooth";
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, ok ? 120 : 250);
  } catch (_) {}
};

// LocalStorage
const LS_KEY = "barcode-registro-v1";
const loadState = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { records: [], activity: [], queue: [] };
    const j = JSON.parse(raw);
    return { records: j.records || [], activity: j.activity || [], queue: j.queue || [] };
  } catch { return { records: [], activity: [], queue: [] }; }
};
const saveState = (state) => localStorage.setItem(LS_KEY, JSON.stringify(state));

// --- App ---
function App() {
  const [mode, setMode] = useState(STATUS.REGISTRADO);
  const [state, setState] = useState(loadState());
  const [lastScan, setLastScan] = useState("");
  const [minLen, setMinLen] = useState(4);
  const [apiEnabled, setApiEnabled] = useState(true); // Cambiado a 'true' para probar
  const [apiBase, setApiBase] = useState("http://localhost:5000"); // Asegúrate de que coincida con tu backend
  const [filter, setFilter] = useState("");
  const [toast, setToast] = useState({ msg: "", ok: true, ts: 0 });
  const inputRef = useRef(null);
  const lastScanAtRef = useRef(0);

  useEffect(() => saveState(state), [state]);

  // Auto-focus
  useEffect(() => {
    const id = setInterval(() => {
      if (inputRef.current && document.activeElement !== inputRef.current) inputRef.current.focus();
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Hotkeys F2/F3
  useEffect(() => {
    const onKey = (e) => { if(e.key==="F2") setMode(STATUS.REGISTRADO); if(e.key==="F3") setMode(STATUS.RETIRADO); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Helpers ---
  const up = (fn) => setState((s) => fn(structuredClone(s)));
  const findRec = (codigo, recs = state.records) => recs.find((r) => r.codigo === codigo);
  const pushQueue = (item) => up((s) => { s.queue.push(item); return s; });

  const sendAPI = async (path, payload) => {
    if (!apiEnabled) return { ok: true, skipped: true };
    try {
      const res = await fetch(`${apiBase}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true };
    } catch (err) {
      pushQueue({ path, payload, ts: Date.now(), err: String(err) });
      return { ok: false, err };
    }
  };

  const flushQueue = async () => {
    if (!apiEnabled || state.queue.length === 0) return;
    const survivors = [];
    for (const item of [...state.queue]) {
      try {
        const res = await fetch(`${apiBase}${item.path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.payload) });
        if(!res.ok) throw new Error("HTTP " + res.status);
      } catch { survivors.push(item); }
    }
    setState((s) => ({ ...s, queue: survivors }));
  };

  const notify = (msg, ok=true) => setToast({ msg, ok, ts: Date.now() });

  // --- OCR Handling ---
  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('tarjetaTNE', file);

    notify("Procesando imagen...", true);

    try {
        const response = await axios.post(`${apiBase}/api/ocr`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        const rut = response.data.rut; // 'rut' en lugar de 'rutEncontrado'
        if (rut) {
            onScan(rut); // Llama a la función de escaneo con el RUT extraído
        } else {
            notify("No se pudo encontrar el RUT en la imagen.", false);
        }
    } catch (error) {
        console.error('Error al subir la imagen:', error);
        notify("Error al procesar la imagen.", false);
    }
  };

  // --- Escaneo (ahora se llama desde onScan o manual) ---
  const onScan = async (raw) => {
    const codigo = raw.trim();
    if (!codigo || codigo.length < minLen) { playBeep(false); return notify("Código inválido", false); }
    const now = Date.now();
    if (now - lastScanAtRef.current < 250 && codigo === lastScan) return;
    lastScanAtRef.current = now;
    setLastScan(codigo);

    if(mode === STATUS.REGISTRADO){
      const exists = findRec(codigo);
      if(exists){ notify(`Código ${codigo} ya registrado`, false); playBeep(false); return; }
      const rec = { codigo, estado: STATUS.REGISTRADO, fecha_registro: fmt(nowCL()), fecha_retiro: "" };
      up((s)=>{ s.records.unshift(rec); s.activity.unshift({ ts: Date.now(), codigo, action: STATUS.REGISTRADO, note: "Registro creado" }); return s; });
      await sendAPI("/cards/register", { codigo, fecha: new Date().toISOString() });
      notify(`Registrado ${codigo}`); playBeep(true);
    } else {
      const exists = findRec(codigo);
      if(!exists){ notify(`Código ${codigo} no encontrado`, false); playBeep(false); return; }
      if(exists.estado === STATUS.RETIRADO && exists.fecha_retiro){ notify(`Código ${codigo} ya entregado`, false); playBeep(false); return; }
      up((s)=>{
        const r = s.records.find(x => x.codigo === codigo);
        r.estado = STATUS.RETIRADO;
        r.fecha_retiro = fmt(nowCL());
        s.activity.unshift({ ts: Date.now(), codigo, action: STATUS.RETIRADO, note: "Entrega confirmada" });
        return s;
      });
      await sendAPI("/cards/pickup", { codigo, fecha: new Date().toISOString() });
      notify(`Entregado ${codigo}`); playBeep(true);
    }
  };

  const toCSV = (rows) => {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["codigo", "estado", "fecha_registro", "fecha_retiro"].join(",");
    const body = rows.map(r => [r.codigo, r.estado, r.fecha_registro, r.fecha_retiro].map(esc).join(",")).join("\n");
    return header + "\n" + body;
  };
  const exportCSV = () => { const blob = new Blob([toCSV(state.records)], { type: "text/csv;charset=utf-8;" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `tarjetas_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url); };
  const clearAll = ()=>{ 
    // eslint-disable-next-line no-restricted-globals
    if(!confirm("Borrar todos los datos locales?")) return; 
    setState({records:[],activity:[],queue:[]}); 
    notify("Datos borrados"); 
};

  const filtered = useMemo(() => { const q = filter.trim().toLowerCase(); if (!q) return state.records; return state.records.filter(r => r.codigo.toLowerCase().includes(q)); }, [filter, state.records]);

  // --- JSX ---
  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <h1>📋 Registro y Retiro TNE</h1>
      <div style={{ marginBottom: 10 }}>
        <button onClick={() => setMode(STATUS.REGISTRADO)} style={{ marginRight: 5, background: mode === STATUS.REGISTRADO ? "#4caf50" : "#ccc", color: "#fff", padding: "5px 10px", border: "none", borderRadius: 4 }}>Registrar (F2)</button>
        <button onClick={() => setMode(STATUS.RETIRADO)} style={{ background: mode === STATUS.RETIRADO ? "#f44336" : "#ccc", color: "#fff", padding: "5px 10px", border: "none", borderRadius: 4 }}>Retirar (F3)</button>
        <button onClick={exportCSV} style={{ marginLeft: 10 }}>💾 Exportar CSV</button>
        <button onClick={clearAll} style={{ marginLeft: 5 }}>🗑️ Limpiar</button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <input ref={inputRef} placeholder="Ingresar o escanear código" value={lastScan} onChange={e => setLastScan(e.target.value)} onKeyDown={e => { if (e.key === "Enter") onScan(lastScan); }} style={{ padding: 5, width: "300px", marginRight: 5 }} />
        <input placeholder="Filtrar registros" value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: 5, width: "200px" }} />
      </div>

      <div style={{ display: "flex", marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <h3>📸 Escanear con Cámara</h3>
          <input
            type="file"
            accept="image/*"
            capture="environment" // Esto activa la cámara trasera.
            onChange={handleImageUpload}
            style={{ display: "block", marginBottom: 10 }}
          />
          <p>Toma una foto de la tarjeta TNE para escanear.</p>
        </div>
        <div style={{ flex: 2, marginLeft: 20 }}>
          <h3>📄 Registros ({filtered.length})</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ border: "1px solid #ccc", padding: 5 }}>Código</th>
                <th style={{ border: "1px solid #ccc", padding: 5 }}>Estado</th>
                <th style={{ border: "1px solid #ccc", padding: 5 }}>Registro</th>
                <th style={{ border: "1px solid #ccc", padding: 5 }}>Retiro</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} style={{ background: r.estado === STATUS.REGISTRADO ? "#e8f5e9" : "#ffebee" }}>
                  <td style={{ border: "1px solid #ccc", padding: 5 }}>{r.codigo}</td>
                  <td style={{ border: "1px solid #ccc", padding: 5 }}>{r.estado}</td>
                  <td style={{ border: "1px solid #ccc", padding: 5 }}>{r.fecha_registro}</td>
                  <td style={{ border: "1px solid #ccc", padding: 5 }}>{r.fecha_retiro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {toast.msg && (
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: toast.ok ? "#4caf50" : "#f44336", color: "#fff", padding: "10px 20px", borderRadius: 4 }}>
          {toast.msg}
        </motion.div>
      )}
    </div>
  );
}

// **AGREGA ESTA LÍNEA AL FINAL DEL ARCHIVO**
export default App;