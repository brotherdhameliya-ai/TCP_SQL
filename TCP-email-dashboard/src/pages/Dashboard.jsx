import { useQuery } from "@tanstack/react-query";
import {
  getEnhancedStats, getRecentRecords, getActiveSchedules,
  getChartMsgTrend, getChartEmailStatus, getChartDailyRecs,
  getChartEmailHist, getChartBusyHours,
} from "../api";
import Card from "../components/ui/Card";
import { Badge, Spinner, ErrorState, EmptyState } from "../components/ui/Misc";
import MessagesTrendChart from "../components/charts/MessagesTrendChart";
import EmailStatusChart   from "../components/charts/EmailStatusChart";
import DailyRecordsChart  from "../components/charts/DailyRecordsChart";
import EmailHistoryChart  from "../components/charts/EmailHistoryChart";
import BusyHoursChart     from "../components/charts/BusyHoursChart";
import {
  MessageSquare, Send, Clock, Calendar,
  CheckCircle, Activity,
} from "lucide-react";

const STAT_CARDS = [
  { key: "total",           label: "Total Records",     icon: MessageSquare, bg: "bg-blue-50",    ic: "text-blue-600",    vc: "text-blue-700" },
  { key: "emailSuccess",    label: "Total Emails Sent", icon: Send,          bg: "bg-emerald-50", ic: "text-emerald-600", vc: "text-emerald-700" },
  { key: "pending",         label: "Pending Records",   icon: Clock,         bg: "bg-amber-50",   ic: "text-amber-600",   vc: "text-amber-700" },
  { key: "today",           label: "Records Today",     icon: Calendar,      bg: "bg-violet-50",  ic: "text-violet-600",  vc: "text-violet-700" },
  { key: "emailsToday",     label: "Emails Today",      icon: CheckCircle,   bg: "bg-cyan-50",    ic: "text-cyan-600",    vc: "text-cyan-700" },
  { key: "activeSchedules", label: "Active Schedules",  icon: Activity,      bg: "bg-orange-50",  ic: "text-orange-600",  vc: "text-orange-700" },
];

const REFETCH = 30000;

export default function Dashboard() {
  const stats      = useQuery({ queryKey: ["enhanced-stats"],   queryFn: getEnhancedStats,    refetchInterval: REFETCH });
  const recent     = useQuery({ queryKey: ["recent-records"],   queryFn: getRecentRecords,    refetchInterval: REFETCH });
  const schedules  = useQuery({ queryKey: ["active-schedules"], queryFn: getActiveSchedules,  refetchInterval: REFETCH });
  const msgTrend   = useQuery({ queryKey: ["chart-msg-trend"],  queryFn: getChartMsgTrend,    refetchInterval: REFETCH });
  const emailStat  = useQuery({ queryKey: ["chart-email-stat"], queryFn: getChartEmailStatus, refetchInterval: REFETCH });
  const dailyRecs  = useQuery({ queryKey: ["chart-daily-recs"], queryFn: getChartDailyRecs,   refetchInterval: REFETCH });
  const emailHist  = useQuery({ queryKey: ["chart-email-hist"], queryFn: getChartEmailHist,   refetchInterval: REFETCH });
  const busyHours  = useQuery({ queryKey: ["chart-busy-hours"], queryFn: getChartBusyHours,   refetchInterval: REFETCH });

  const isAnyFetching = [stats, msgTrend, emailStat, dailyRecs, emailHist, busyHours]
    .some(q => q.isFetching && !q.isLoading);

  return (
    <div className="space-y-6">
      {/* ── Stat Cards ───────────────────────────────────────────────────── */}
      {stats.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
          {STAT_CARDS.map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 animate-pulse">
              <div className="h-9 w-9 rounded-lg bg-slate-100 mb-3" />
              <div className="h-7 w-16 rounded bg-slate-100 mb-2" />
              <div className="h-3 w-24 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : stats.isError ? (
        <ErrorState message="Failed to load stats" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
          {STAT_CARDS.map(({ key, label, icon: Icon, bg, ic, vc }) => (
            <Card key={key} className="hover:shadow-md transition-shadow duration-200">
              <div className={`inline-flex items-center justify-center h-9 w-9 rounded-lg ${bg} mb-3`}>
                <Icon size={18} className={ic} />
              </div>
              <div className={`text-2xl font-bold ${vc}`}>
                {(stats.data?.[key] ?? 0).toLocaleString()}
              </div>
              <div className="text-xs text-slate-500 mt-1 font-medium">{label}</div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Row 1: Messages Trend + Email Status ─────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <MessagesTrendChart
            data={msgTrend.data}
            isLoading={msgTrend.isLoading}
            isError={msgTrend.isError}
          />
        </div>
        <EmailStatusChart
          data={emailStat.data}
          isLoading={emailStat.isLoading}
          isError={emailStat.isError}
        />
      </div>

      {/* ── Row 2: Daily Records + Email History ─────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DailyRecordsChart
          data={dailyRecs.data}
          isLoading={dailyRecs.isLoading}
          isError={dailyRecs.isError}
        />
        <EmailHistoryChart
          data={emailHist.data}
          isLoading={emailHist.isLoading}
          isError={emailHist.isError}
        />
      </div>

      {/* ── Row 3: Busy Hours + Recent Messages + Schedules ──────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <BusyHoursChart
          data={busyHours.data}
          isLoading={busyHours.isLoading}
          isError={busyHours.isError}
        />

        {/* Recent TCP Messages */}
        <Card className="xl:col-span-2 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Recent TCP Messages</h2>
            <span className="text-xs text-slate-400">Latest 10</span>
          </div>
          {recent.isLoading ? (
            <div className="p-5"><Spinner /></div>
          ) : recent.isError ? (
            <div className="p-5"><ErrorState /></div>
          ) : !recent.data?.length ? (
            <div className="p-5"><EmptyState message="No records yet" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-5 py-3 font-semibold w-16">ID</th>
                    <th className="px-5 py-3 font-semibold w-40">Received At</th>
                    <th className="px-5 py-3 font-semibold">Message</th>
                    <th className="px-5 py-3 font-semibold w-20">Port</th>
                    <th className="px-5 py-3 font-semibold w-20">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recent.data.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-2.5 text-slate-400 font-mono text-xs">{r.id}</td>
                      <td className="px-5 py-2.5 text-slate-500 text-xs">{new Date(r.received_at).toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-slate-700 text-xs max-w-xs truncate">{r.message}</td>
                      <td className="px-5 py-2.5">
                        {r.port ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">{r.port}</span> : <span className="text-slate-400 text-xs">—</span>}
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge color={r.email_sent ? "green" : "yellow"}>
                          {r.email_sent ? "Sent" : "Pending"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* ── Row 4: Active Schedules ───────────────────────────────────────── */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700">Email Schedules</h2>
          <Badge color="blue">Active</Badge>
        </div>
        {schedules.isLoading ? (
          <Spinner />
        ) : schedules.isError ? (
          <ErrorState />
        ) : !schedules.data?.length ? (
          <EmptyState message="No active schedules" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {schedules.data.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 hover:bg-blue-50 hover:border-blue-100 transition-colors">
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-blue-500" />
                  <span className="font-mono text-sm font-semibold text-slate-700">{s.time}</span>
                </div>
                <Badge color="green">On</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
