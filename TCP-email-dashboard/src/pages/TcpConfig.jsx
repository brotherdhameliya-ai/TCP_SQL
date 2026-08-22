import { useEffect, useReducer, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Wifi, WifiOff, Loader2, X, Save, RefreshCw } from "lucide-react";
import {
  getTcpCameras, createTcpCamera, updateTcpCamera, deleteTcpCamera,
  getTcpClientConfig, updateTcpClientConfig,
} from "../api";
import { socket } from "../api";

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const EMPTY_CAM = { camera_name: "", ip_address: "", port: "", is_active: 1 };

function statusBadge(status) {
  if (status === "connected")   return "text-green-700 bg-green-50 border-green-200";
  if (status === "error")       return "text-red-700 bg-red-50 border-red-200";
  if (status === "connecting")  return "text-yellow-700 bg-yellow-50 border-yellow-200";
  return "text-slate-500 bg-slate-100 border-slate-200";
}

/* ── TCP Client Config Card ── */
function TcpClientConfig() {
  const [entries, setEntries]     = useState([]);   // { id, host, port, is_active }
  const [clientStatus, setClientStatus] = useState({}); // "userId:host:port" -> "connected"|"error"|...
  const [host, setHost]           = useState("");
  const [ports, setPorts]         = useState([]);
  const [portInput, setPortInput] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [saving, setSaving]       = useState(false);
  const [loading, setLoading]     = useState(true);
  const [msg, setMsg]             = useState(null);
  const [ipError, setIpError]     = useState("");
  const [portError, setPortError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getTcpClientConfig();
      setEntries(d.entries || []);
      if (d.entries?.length) {
        setHost(d.entries[0].host);
        setPorts(d.entries.map(e => String(e.port)));
        setFolderPath(d.folder_path || "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    socket.on("tcp_client_status", ({ key, status }) => {
      setClientStatus(prev => ({ ...prev, [key]: status }));
    });
    return () => socket.off("tcp_client_status");
  }, [load]);

  function addPort() {
    const p = portInput.trim();
    if (!p) return;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > 65535) { setPortError("Port must be 1–65535."); return; }
    if (ports.includes(p)) { setPortInput(""); return; }
    setPorts(prev => [...prev, p]);
    setPortInput("");
    setPortError("");
  }

  async function save() {
    setIpError(""); setPortError("");
    if (!host.trim())                { setIpError("IP address is required."); return; }
    if (!IP_REGEX.test(host.trim())) { setIpError("Invalid IP address format."); return; }
    if (ports.length === 0)          { setPortError("Add at least one port."); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await updateTcpClientConfig({ host: host.trim(), ports, folder_path: folderPath.trim() || null });
      setEntries(res.entries || []);
      setMsg({ type: "success", text: "Saved! TCP connections restarted." });
    } catch (e) {
      const err = e.response?.data;
      if (err?.port) {
        setPortError(err.error);
      } else {
        setMsg({ type: "error", text: err?.error || e.message });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Camera TCP Connection</h2>
          <p className="text-xs text-slate-500 mt-0.5">Your camera system IP and port(s) to connect to.</p>
        </div>
        <button onClick={load} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Current entries status */}
      {!loading && entries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entries.map(e => {
            const st = clientStatus[`connected`] || "listening";
            return (
              <span key={e.id} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${statusBadge(st)}`}>
                <Wifi size={11} />
                {e.host}:{e.port}
              </span>
            );
          })}
        </div>
      )}

      {/* IP field */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Camera IP Address</label>
        <input
          value={host}
          onChange={e => { setHost(e.target.value); setIpError(""); }}
          placeholder="e.g. 192.168.29.92"
          className={`w-full max-w-xs border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${ipError ? "border-red-400" : "border-slate-200"}`}
        />
        {ipError && <p className="text-xs text-red-600 mt-1 font-medium">{ipError}</p>}
      </div>

      {/* Folder Path */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Image Folder Path <span className="font-normal text-slate-400">(optional)</span></label>
        <input
          value={folderPath}
          onChange={e => setFolderPath(e.target.value)}
          placeholder="e.g. C:\Images or /home/user/images"
          className="w-full max-w-sm border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-slate-400 mt-1">Folder scanned for image files matching TCP message values.</p>
      </div>

      {/* Ports */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Camera Port(s)</label>
        {ports.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {ports.map(p => (
              <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-100">
                {p}
                <button onClick={() => setPorts(prev => prev.filter(x => x !== p))} className="hover:text-red-500 ml-0.5"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={portInput}
            onChange={e => { setPortInput(e.target.value); setPortError(""); }}
            onKeyDown={e => e.key === "Enter" && addPort()}
            placeholder="e.g. 8080"
            type="number" min="1" max="65535"
            className={`border rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 ${portError ? "border-red-400" : "border-slate-200"}`}
          />
          <button onClick={addPort} className="flex items-center gap-1 px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700">
            <Plus size={13} /> Add Port
          </button>
        </div>
        {portError
          ? <p className="text-xs text-red-600 mt-1 font-medium">{portError}</p>
          : <p className="text-xs text-slate-400 mt-1">Only registered ports will connect. Others are ignored.</p>
        }
      </div>

      {msg && <p className={`text-xs font-medium ${msg.type === "success" ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>}

      <button onClick={save} disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        Save & Reconnect
      </button>
    </div>
  );
}

/* ── Main Page ── */
export default function TcpConfig() {
  const [cameras, setCameras]   = useState([]);
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null);
  const [form, setForm]         = useReducer((s, p) => ({ ...s, ...p }), EMPTY_CAM);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  async function load() {
    setLoading(true);
    try { const rows = await getTcpCameras(); setCameras(rows); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    socket.on("init_statuses", list => {
      setStatuses(Object.fromEntries(list.map(s => [s.key, s])));
    });
    socket.on("server_status",  s => setStatuses(prev => ({ ...prev, [s.key]: s })));
    socket.on("server_stopped", ({ ip_address, port }) =>
      setStatuses(prev => { const n = { ...prev }; delete n[`${ip_address}:${port}`]; return n; })
    );
    return () => {
      socket.off("init_statuses");
      socket.off("server_status");
      socket.off("server_stopped");
    };
  }, []);

  function openAdd()   { setForm(EMPTY_CAM); setError(""); setModal({ mode: "add" }); }
  function openEdit(c) { setForm({ camera_name: c.camera_name, ip_address: c.ip_address, port: c.port, is_active: c.is_active }); setError(""); setModal({ mode: "edit", id: c.id }); }

  async function handleSave() {
    if (!form.camera_name || !form.ip_address || !form.port) { setError("All fields are required."); return; }
    setSaving(true); setError("");
    try {
      modal.mode === "add" ? await createTcpCamera(form) : await updateTcpCamera(modal.id, form);
      setModal(null); load();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  }

  async function handleDelete(cam) {
    if (!window.confirm(`Delete "${cam.camera_name}"?`)) return;
    await deleteTcpCamera(cam.id); load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">TCP Config</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage camera connections and TCP server listeners</p>
      </div>

      <TcpClientConfig />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">TCP Server Listeners</h2>
          <p className="text-xs text-slate-500">Ports this system listens on for incoming connections</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          <Plus size={15} /> Add Listener
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-slate-400" size={28} /></div>
      ) : cameras.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">No listeners configured yet.</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Name", "IP Address", "Port", "Status", "Last Message", "Active", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cameras.map(cam => {
                const k  = `${cam.ip_address}:${cam.port}`;
                const st = statuses[k];
                return (
                  <tr key={cam.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{cam.camera_name}</td>
                    <td className="px-4 py-3 text-slate-600 font-mono">{cam.ip_address}</td>
                    <td className="px-4 py-3 text-slate-600 font-mono">{cam.port}</td>
                    <td className="px-4 py-3">
                      {st ? (
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${statusBadge(st.status)}`}>
                          {st.status === "connected" ? <Wifi size={11} /> : <WifiOff size={11} />}
                          {st.status}{st.clients > 0 && ` (${st.clients})`}
                        </span>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{st?.lastMessage || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${cam.is_active ? "text-green-600" : "text-slate-400"}`}>
                        {cam.is_active ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => openEdit(cam)} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(cam)} className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-800">
              {modal.mode === "add" ? "Add TCP Listener" : "Edit TCP Listener"}
            </h2>
            {[
              { label: "Name",       key: "camera_name", placeholder: "Camera A" },
              { label: "IP Address", key: "ip_address",  placeholder: "0.0.0.0" },
              { label: "Port",       key: "port",        placeholder: "9000", type: "number" },
            ].map(({ label, key, placeholder, type }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                <input type={type || "text"} value={form[key]}
                  onChange={e => setForm({ [key]: e.target.value })} placeholder={placeholder}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input id="is_active" type="checkbox" checked={!!form.is_active}
                onChange={e => setForm({ is_active: e.target.checked ? 1 : 0 })} className="rounded border-slate-300" />
              <label htmlFor="is_active" className="text-sm text-slate-700">Active</label>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2">
                {saving && <Loader2 size={13} className="animate-spin" />}
                {modal.mode === "add" ? "Add" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
