import { NavLink } from "react-router-dom";
import { LayoutDashboard, Clock, Mail, History, Inbox, Settings, Database, Bell, Users, Network } from "lucide-react";
import logo from "../assets/Myntra1.png";
import { useAuth } from "../store/AuthContext";

const links = [
  { to: "/",              icon: LayoutDashboard, label: "Dashboard",        permission: "VIEW_DASHBOARD" },
  { to: "/records",       icon: Database,        label: "Records",          permission: "VIEW_RECORDS" },
  { to: "/schedules",     icon: Clock,           label: "Schedules",        permission: "MANAGE_SCHEDULES" },
  { to: "/recipients",    icon: Mail,            label: "Recipients",       permission: "MANAGE_RECIPIENTS" },
  { to: "/email-history", icon: History,         label: "Email History",    permission: "VIEW_EMAIL_LOGS" },
  { to: "/pending",       icon: Inbox,           label: "Pending Messages", permission: "VIEW_RECORDS" },
  { to: "/tcp-config",    icon: Network,         label: "TCP Config",        permission: "MANAGE_TCP_CONFIG" },
  { to: "/notifications", icon: Bell,            label: "Notifications",    permission: "VIEW_NOTIFICATIONS" },
  { to: "/settings",      icon: Settings,        label: "Settings",         permission: "MANAGE_SETTINGS" },
  { to: "/users",         icon: Users,           label: "Users",            permission: "CREATE_USERS" },
];

export default function Sidebar() {
  const { can } = useAuth();

  const visibleLinks = links.filter((link) => !link.permission || can(link.permission));

  return (
    <aside className="fixed left-0 top-0 h-full w-56 border-r border-slate-200 bg-white flex flex-col shadow-sm">
      {/* Logo */}
      <div className=" flex  items-center gap-3 px-5 py-5 border-b border-slate-100">
        <div className=" w-16 rounded-lg   flex items-center justify-center text-white font-bold text-sm  ">
          <img src={logo} alt="" />
        </div>
        <div className="flex flex-col text-center justify-center">
          <div className="text-md font-bold text-slate-800">ScanPulse</div>
          <div className="text-xs text-slate-400">Email Service</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {visibleLinks.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150
               ${isActive
                 ? "bg-blue-50 text-blue-700 border border-blue-100"
                 : "text-slate-500 hover:bg-slate-50 hover:text-slate-800 border border-transparent"
               }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={16} className={isActive ? "text-blue-600" : "text-slate-400"} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-100">
        <p className="text-xs text-slate-400 text-center">v1.0.0</p>
      </div>
    </aside>
  );
}
