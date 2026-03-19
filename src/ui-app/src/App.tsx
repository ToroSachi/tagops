import { useEffect, useState } from "react";
import { Activity, ShieldCheck, AlertTriangle, RefreshCcw } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Profile {
  name: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  ga4MeasurementId?: string;
  metaPixelId?: string;
}

interface HealthComponent {
  name: string;
  score: number;
  weight: number;
  details: string;
}

interface HealthReport {
  timestamp: string;
  overallScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  components: HealthComponent[];
  totalTags: number;
  totalTriggers: number;
  totalVariables: number;
  summary: string;
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<string>("default");
  const [healthData, setHealthData] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profiles")
      .then((res) => res.json())
      .then((data) => {
        setProfiles(data);
        if (data.length > 0) setActiveProfile(data[0].name);
      })
      .catch((err) => setError(err.message));
  }, []);

  const fetchHealth = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/health/${activeProfile}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to fetch health");
        return res.json();
      })
      .then((data) => setHealthData(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (activeProfile) {
      fetchHealth();
    }
  }, [activeProfile]);

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case "A":
        return "text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]";
      case "B":
        return "text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]";
      case "C":
        return "text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]";
      case "D":
        return "text-orange-400 drop-shadow-[0_0_10px_rgba(251,146,60,0.5)]";
      default:
        return "text-red-400 drop-shadow-[0_0_10px_rgba(248,113,113,0.5)]";
    }
  };

  return (
    <div className="min-h-screen app-bg text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Dynamic Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[50%] rounded-full bg-fuchsia-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20 backdrop-blur-md">
              <Activity className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-2">
                tagops{" "}
                <span className="text-indigo-400/80 text-sm font-normal py-0.5 px-2 bg-indigo-500/10 rounded-full border border-indigo-500/20">
                  Command Center
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <select
              value={activeProfile}
              onChange={(e) => setActiveProfile(e.target.value)}
              className="bg-slate-900/50 border border-slate-700/50 text-slate-200 text-sm rounded-lg focus:ring-indigo-500/50 focus:border-indigo-500/50 block w-full p-2.5 backdrop-blur-md transition-all outline-none"
            >
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.accountId} / {p.containerId})
                </option>
              ))}
            </select>
            <button
              onClick={fetchHealth}
              disabled={loading}
              className="p-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:shadow-[0_0_20px_rgba(99,102,241,0.5)]"
            >
              <RefreshCcw className={cn("w-5 h-5", loading && "animate-spin")} />
            </button>
          </div>
        </header>

        {error ? (
          <div className="p-6 rounded-2xl bg-red-950/30 border border-red-500/20 backdrop-blur-xl flex items-start gap-4 animate-in fade-in slide-in-from-bottom-4">
            <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-lg font-medium text-red-200 mb-1">Failed to analyze container</h3>
              <p className="text-red-300/80 text-sm leading-relaxed">{error}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="h-[60vh] flex flex-col items-center justify-center gap-6 animate-pulse">
            <div className="relative">
              <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
              <Activity className="w-12 h-12 text-indigo-400 relative z-10" />
            </div>
            <p className="text-slate-400 font-medium tracking-wide">Analyzing GTM Container...</p>
          </div>
        ) : healthData ? (
          <div className="grid grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            {/* Overview / Grade Card */}
            <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
              <div className="glass-panel p-8 rounded-3xl flex flex-col items-center justify-center text-center relative overflow-hidden group hover:border-indigo-500/30 transition-colors duration-500">
                <div className="absolute top-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                <h2 className="text-slate-400 text-sm font-semibold tracking-widest uppercase mb-6">
                  Container Health
                </h2>

                <div className="relative mb-6">
                  {/* Glowing ring behind grade */}
                  <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full scale-150" />
                  <span
                    className={cn(
                      "relative z-10 text-[120px] font-black leading-none drop-shadow-2xl font-mono",
                      getGradeColor(healthData.grade),
                    )}
                  >
                    {healthData.grade}
                  </span>
                </div>

                <div className="flex items-center gap-3 px-6 py-2 bg-slate-900/50 rounded-full border border-slate-800/80 shadow-inner">
                  <span className="text-3xl font-bold tracking-tight text-white">
                    {healthData.overallScore}
                  </span>
                  <span className="text-slate-500 font-medium tracking-wide border-l border-slate-700/50 pl-3">
                    / 100
                  </span>
                </div>
              </div>

              {/* Resource Summary Counters */}
              <div className="glass-panel p-6 rounded-3xl grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-slate-900/40 rounded-2xl border border-slate-800/50">
                  <div className="text-2xl font-bold text-white mb-1">{healthData.totalTags}</div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                    Tags
                  </div>
                </div>
                <div className="text-center p-4 bg-slate-900/40 rounded-2xl border border-slate-800/50">
                  <div className="text-2xl font-bold text-white mb-1">
                    {healthData.totalTriggers}
                  </div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                    Triggers
                  </div>
                </div>
                <div className="text-center p-4 bg-slate-900/40 rounded-2xl border border-slate-800/50">
                  <div className="text-2xl font-bold text-white mb-1">
                    {healthData.totalVariables}
                  </div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                    Variables
                  </div>
                </div>
              </div>
            </div>

            {/* Components Breakdown */}
            <div className="col-span-12 lg:col-span-8">
              <div className="glass-panel p-8 rounded-3xl h-full flex flex-col">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-semibold text-white flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-indigo-400" />
                    Audit Components
                  </h3>
                  <span className="text-slate-500 text-sm">Target: 100%</span>
                </div>

                <div className="space-y-6 flex-1">
                  {healthData.components.map((comp, i) => (
                    <div
                      key={comp.name}
                      className="group flex flex-col gap-2 p-4 rounded-2xl hover:bg-white/[0.02] transition-colors"
                      style={{ animationDelay: `${i * 100}ms` }}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-slate-200 font-medium block">{comp.name}</span>
                          <span className="text-slate-500 text-sm mt-0.5 block">
                            {comp.details}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-slate-600 font-mono hidden sm:inline-block">
                            Weight: {(comp.weight * 100).toFixed(0)}%
                          </span>
                          <span
                            className={cn(
                              "font-bold text-lg w-12 text-right",
                              comp.score >= 80
                                ? "text-emerald-400"
                                : comp.score >= 50
                                  ? "text-yellow-400"
                                  : "text-red-400",
                            )}
                          >
                            {comp.score}
                          </span>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="h-2 w-full bg-slate-800/50 rounded-full overflow-hidden border border-slate-800/80 shadow-inner relative">
                        {/* Shimmer effect inside progress bar container */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent w-1/2 -skew-x-12 -translate-x-full animate-[shimmer_2s_infinite] pointer-events-none" />
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(0,0,0,0.5)]",
                            comp.score >= 80
                              ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                              : comp.score >= 50
                                ? "bg-gradient-to-r from-yellow-500 to-yellow-400"
                                : "bg-gradient-to-r from-red-500 to-red-400",
                          )}
                          style={{ width: `${comp.score}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
