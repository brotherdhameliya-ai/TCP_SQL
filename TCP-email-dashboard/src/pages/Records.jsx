import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getRecords, sendSelectedRecords, sendFilteredRecords } from "../api";
import Card from "../components/ui/Card";
import { Badge, Spinner, EmptyState, ErrorState } from "../components/ui/Misc";
import Button from "../components/ui/Button";
import { useToastStore } from "../store/toast.store";
import { Search, Database, Send, Filter, X, AlertTriangle } from "lucide-react";
const EMAIL_STATUS_OPTIONS = [
  { value: "all",     label: "All Status" },
  { value: "sent",    label: "Sent" },
  { value: "pending", label: "Pending" },
];
const TIME_RANGE_OPTIONS = [
  { value: "1h",  label: "Last 1 Hour" },
  { value: "6h",  label: "Last 6 Hours" },
  { value: "24h", label: "Last 24 Hours" },
  { value: "7d",  label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "all", label: "All Time" },
];

const selectClass = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-50 cursor-pointer transition-all shadow-sm";

function TcpImage({ image, folderPath }) {
  if (!image || !folderPath) {
    if (image && !folderPath) console.warn(`[TcpImage] image="${image}" but folderPath is empty`);
    return <span className="text-slate-400 text-xs">—</span>;
  }
  const src = `/api/tcp-image?file=${encodeURIComponent(image)}&folder=${encodeURIComponent(folderPath)}`;
  console.log(`[TcpImage] loading: ${src}`);
  return (
    <img src={src} alt={image}
      className="w-16 h-16 object-cover rounded cursor-pointer hover:scale-105 transition"
      onClick={(e) => { e.stopPropagation(); window._setTcpImage?.(src); }}
      onLoad={() => console.log(`[TcpImage] ✅ loaded: ${image}`)}
      onError={(e) => {
        console.error(`[TcpImage] ❌ failed to load: ${src}`);
        e.target.style.display = "none";
      }}
    />
  );
}

function ConfirmModal({ open, title, message, onConfirm, onCancel, loading }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-50 border border-amber-100">
            <AlertTriangle size={20} className="text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
            <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant="success" onClick={onConfirm} disabled={loading}>
            {loading ? "Sending…" : "Yes, Send Email"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Records() {
  const qc    = useQueryClient();
  const toast = useToastStore((s) => s.addToast);
  const [selectedImage, setSelectedImage] = useState(null);

  useEffect(() => {
    window._setTcpImage = setSelectedImage;
    return () => { delete window._setTcpImage; };
  }, []);
  const [page,        setPage]        = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search,      setSearch]      = useState("");
  const [emailStatus, setEmailStatus] = useState("all");
  const [timeRange,   setTimeRange]   = useState("all");
  const [selected,    setSelected]    = useState(new Set());
  const [modal,       setModal]       = useState(null);

  const hasFilters = search || emailStatus !== "all" || timeRange !== "all";

  useEffect(() => { setPage(1); setSelected(new Set()); }, [search, emailStatus, timeRange]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["records", page, search, emailStatus, timeRange],
    queryFn:  () => getRecords({ page, limit: 20, emailStatus, timeRange, search }),
    placeholderData: (previousData) => previousData,
    refetchInterval: 10000, // 10s auto-refresh
  });

  const currentIds   = data?.records?.map((r) => r.id) ?? [];
  const allOnPageSel = currentIds.length > 0 && currentIds.every((id) => selected.has(id));
  const someOnPage   = currentIds.some((id) => selected.has(id));

  const toggleRow = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const togglePageAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allOnPageSel) currentIds.forEach((id) => next.delete(id));
    else              currentIds.forEach((id) => next.add(id));
    return next;
  });

  const clearSelection = () => setSelected(new Set());

  const sendSelected = useMutation({
    mutationFn: () => sendSelectedRecords([...selected]),
    onSuccess: (res) => {
      setModal(null); clearSelection();
      qc.invalidateQueries(["records"]); qc.invalidateQueries(["stats"]);
      const r = res.data.result;
      if (r.skipped) toast(r.reason, "error");
      else if (r.success === false) toast(r.error || "Failed to send email", "error");
      else toast(`✅ Email sent — ${r.count} records`);
    },
    onError: (e) => { setModal(null); toast(e.response?.data?.message || "Send failed", "error"); },
  });

  const sendFiltered = useMutation({
    mutationFn: () => sendFilteredRecords({ emailStatus, timeRange, search }),
    onSuccess: (res) => {
      setModal(null); clearSelection();
      qc.invalidateQueries(["records"]); qc.invalidateQueries(["stats"]);
      const r = res.data.result;
      if (r.skipped) toast(r.reason, "error");
      else if (r.success === false) toast(r.error || "Failed to send email", "error");
      else toast(`✅ Email sent — ${r.count} records`);
    },
    onError: (e) => { setModal(null); toast(e.response?.data?.message || "Send failed", "error"); },
  });

  const isSending    = sendSelected.isPending || sendFiltered.isPending;
  const openModal    = (type) => setModal({ type, count: type === "selected" ? selected.size : data?.total ?? 0 });
  const confirmSend  = () => modal?.type === "selected" ? sendSelected.mutate() : sendFiltered.mutate();
  const resetFilters = () => { setSearchInput(""); setSearch(""); setEmailStatus("all"); setTimeRange("all"); };

  return (
    <div className="space-y-4">
      {/* ── Action bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {data && (
            <span className="rounded-full bg-blue-50 border border-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
              {Number(data.total).toLocaleString()} total
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-3 py-1.5">
              Selected: <span className="font-bold">{selected.size.toLocaleString()}</span> records
            </span>
          )}
          <Button size="sm" variant="primary" disabled={selected.size === 0 || isSending} onClick={() => openModal("selected")}>
            <Send size={14} />
            Send Selected{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
          <Button size="sm" variant="success" disabled={!data?.total || isSending} onClick={() => openModal("filtered")}>
            <Filter size={14} />
            Send Filtered{data?.total ? ` (${Number(data.total).toLocaleString()})` : ""}
          </Button>
          {selected.size > 0 && (
            <Button size="sm" variant="ghost" onClick={clearSelection}><X size={13} /> Clear</Button>
          )}
        </div>
      </div>

      {/* ── Sticky Filters ─────────────────────────────────────────────────── */}
      <div className="sticky top-16 z-10 rounded-xl border border-slate-200 bg-white/95 backdrop-blur shadow-sm p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by ID or message..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-50 transition-all shadow-sm"
            />
          </div>
          <select value={emailStatus} onChange={(e) => setEmailStatus(e.target.value)} className={selectClass}>
            {EMAIL_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className={selectClass}>
            {TIME_RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={resetFilters}>Reset</Button>
          )}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="p-6"><Spinner /></div>
        ) : isError ? (
          <div className="p-6"><ErrorState message="Failed to load records" /></div>
        ) : !data?.records?.length ? (
          <div className="p-6"><EmptyState message="No records match your filters" /></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allOnPageSel}
                        ref={(el) => { if (el) el.indeterminate = someOnPage && !allOnPageSel; }}
                        onChange={togglePageAll}
                        className="h-4 w-4 rounded border-slate-300 accent-blue-600 cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 font-semibold w-20">ID</th>
                    <th className="px-4 py-3 font-semibold w-44">Received At</th>
                    <th className="px-4 py-3 font-semibold">Message</th>
                    <th className="px-4 py-3 font-semibold">Barcode</th>
                    <th className="px-4 py-3 font-semibold w-20">Port</th>
                    <th className="px-4 py-3 font-semibold">Image</th>
                    <th className="px-4 py-3 font-semibold w-24">Status</th>
                    <th className="px-4 py-3 font-semibold w-44">Sent At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.records.map((r) => {
                    const isSelected = selected.has(r.id);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => toggleRow(r.id)}
                        className={`cursor-pointer transition-colors group ${isSelected ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(r.id)}
                            className="h-4 w-4 rounded border-slate-300 accent-blue-600 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{r.id}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{new Date(r.received_at).toLocaleString()}</td>
                        <td className="px-4 py-3 text-slate-700 max-w-sm">
                          <span className="block truncate group-hover:whitespace-normal group-hover:break-words transition-all">
                            {r.message}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {r.barcode
                            ? r.barcode.split("|").map((b, i) => (
                                <span key={i} className="inline-flex items-center mr-1 mb-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-100">
                                  {b.trim()}
                                </span>
                              ))
                            : <span className="text-slate-400 text-xs">—</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          {r.port ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">{r.port}</span> : <span className="text-slate-400 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <TcpImage image={r.image} folderPath={r.folder_path} />
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={r.email_sent ? "green" : "yellow"}>
                            {r.email_sent ? "Sent" : "Pending"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {r.email_sent_at ? new Date(r.email_sent_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ───────────────────────────────────────────────── */}
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-4 py-3 text-xs text-slate-500">
              <span>
                Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, data.total)} of <span className="font-semibold text-slate-700">{Number(data.total).toLocaleString()}</span>
              </span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage(1)}>«</Button>
                <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹ Prev</Button>
                <span className="px-3 py-1 rounded-md bg-white border border-slate-200 text-slate-700 font-semibold shadow-sm">{page} / {data.pages}</span>
                <Button size="sm" variant="ghost" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Next ›</Button>
                <Button size="sm" variant="ghost" disabled={page >= data.pages} onClick={() => setPage(data.pages)}>»</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <ConfirmModal
        open={!!modal}
        loading={isSending}
        title={modal?.type === "selected" ? "Send Selected Records" : "Send Filtered Results"}
        message={
          modal?.type === "selected"
            ? `Are you sure you want to send ${modal?.count?.toLocaleString()} selected records via email? An Excel attachment will be included.`
            : `Are you sure you want to send all ${modal?.count?.toLocaleString()} filtered records via email? An Excel attachment will be included.`
        }
        onConfirm={confirmSend}
        onCancel={() => setModal(null)}
      />
      {selectedImage && (
  <div
    className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
    onClick={() => setSelectedImage(null)}
  >
    <div
      className="relative max-w-4xl max-h-[90vh] p-2"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="absolute -top-10 right-0 text-white text-3xl"
        onClick={() => setSelectedImage(null)}
      >
        ×
      </button>

      <img
        src={selectedImage}
        alt="Full Size"
        className="max-w-full max-h-[85vh] rounded-lg"
      />
    </div>
  </div>
)}
    </div>
  );
}
