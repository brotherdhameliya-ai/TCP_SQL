import { useState } from "react";
import { Plus, X, Loader2, Wifi } from "lucide-react";
import { updateTcpClientConfig } from "../api";
import { useAuth } from "../store/AuthContext";

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

export default function TcpSetupModal() {
  const { setTcpConfigured } = useAuth();
  const [host, setHost]           = useState("");
  const [ports, setPorts]         = useState([]);
  const [portInput, setPortInput] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [saving, setSaving]       = useState(false);
  const [ipError, setIpError]     = useState("");
  const [portError, setPortError] = useState("");  // shown under port input

  function addPort() {
    const p = portInput.trim();
    if (!p) return;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setPortError("Port must be a number between 1 and 65535.");
      return;
    }
    if (ports.includes(p)) { setPortInput(""); return; }
    setPorts(prev => [...prev, p]);
    setPortInput("");
    setPortError("");
  }

  async function handleSave() {
    setIpError(""); setPortError("");
    if (!host.trim())                  { setIpError("Please enter the camera IP address."); return; }
    if (!IP_REGEX.test(host.trim()))   { setIpError("Please enter a valid IP address (e.g. 192.168.1.10)."); return; }
    if (ports.length === 0)            { setPortError("Please add at least one port."); return; }

    setSaving(true);
    try {
      await updateTcpClientConfig({ host: host.trim(), ports, folder_path: folderPath.trim() || null });
      setTcpConfigured(true);
    } catch (e) {
      const err = e.response?.data;
      if (err?.port) {
        setPortError(err.error); // duplicate port — show under port input
      } else {
        setIpError(err?.error || e.message);
      }
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-7 space-y-5">

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
            <Wifi size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800">Connect to Camera System</h2>
            <p className="text-xs text-slate-500 mt-0.5">Enter the IP address and port(s) your camera is listening on.</p>
          </div>
        </div>

        {/* IP */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Camera IP Address</label>
          <input
            value={host}
            onChange={e => { setHost(e.target.value); setIpError(""); }}
            placeholder="e.g. 192.168.29.92"
            className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${ipError ? "border-red-400" : "border-slate-200"}`}
          />
          {ipError && <p className="text-xs text-red-600 mt-1 font-medium">{ipError}</p>}
        </div>

        {/* Ports */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Camera Port(s)</label>
          {ports.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {ports.map(p => (
                <span key={p} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-100">
                  {p}
                  <button onClick={() => { setPorts(prev => prev.filter(x => x !== p)); setPortError(""); }} className="hover:text-red-500"><X size={11} /></button>
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
            : <p className="text-xs text-slate-400 mt-1.5">Press Enter or click Add Port. Add multiple ports if needed.</p>
          }
        </div>

        {/* Folder Path */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Image Folder Path <span className="font-normal text-slate-400">(optional)</span></label>
          <input
            value={folderPath}
            onChange={e => setFolderPath(e.target.value)}
            placeholder="e.g. C:\Images or /home/user/images"
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-slate-400 mt-1">Folder scanned for image files matching TCP message values.</p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Wifi size={15} />}
          {saving ? "Connecting..." : "Save & Go to Dashboard"}
        </button>
      </div>
    </div>
  );
}
