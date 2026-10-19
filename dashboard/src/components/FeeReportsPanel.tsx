import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Loader2, RefreshCw } from 'lucide-react';

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

export interface FeeReport {
  id: string;
  period: ReportPeriod;
  createdAt: string;
  format: 'pdf' | 'csv';
}

interface FeeReportsPanelProps {
  apiBaseUrl?: string;
}

const baseUrl = (override?: string) =>
  override ?? ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3002');

export const FeeReportsPanel: React.FC<FeeReportsPanelProps> = ({ apiBaseUrl }) => {
  const [reports, setReports] = useState<FeeReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState<ReportPeriod | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${baseUrl(apiBaseUrl)}/api/reports`);
      if (!res.ok) throw new Error(`Failed to load reports: ${res.status}`);
      const payload = await res.json();
      setReports(payload?.data ?? payload?.reports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load fee reports.');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  const handleGenerate = async (period: ReportPeriod) => {
    setGenerating(period);
    setError('');
    try {
      const res = await fetch(`${baseUrl(apiBaseUrl)}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      });
      if (!res.ok) throw new Error(`Report generation failed: ${res.status}`);
      await fetchReports();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report generation failed.');
    } finally {
      setGenerating(null);
    }
  };

  const handleDownload = async (report: FeeReport) => {
    setDownloadingId(report.id);
    setError('');
    try {
      const res = await fetch(`${baseUrl(apiBaseUrl)}/api/reports/${report.id}/download`);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fee-report-${report.period}-${report.id}.${report.format === 'csv' ? 'csv' : 'pdf'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  };

  const periods: ReportPeriod[] = ['daily', 'weekly', 'monthly'];

  return (
    <div className="glass-card p-6 border border-slate-800 space-y-5" data-testid="fee-reports-panel">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-display text-slate-100 flex items-center gap-2">
            <FileText size={20} /> Fee Reports
          </h2>
          <p className="text-sm text-slate-400 mt-1">Generate and download fee reports as PDF or CSV.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {periods.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void handleGenerate(p)}
              disabled={generating !== null}
              data-testid={`generate-${p}-report-btn`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:opacity-90 disabled:opacity-60"
            >
              {generating === p ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Generate {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400" data-testid="fee-reports-loading" role="status">
          <Loader2 size={16} className="animate-spin" /> Loading reports…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" data-testid="fee-reports-error" role="alert">
          {error}
          <button type="button" onClick={() => void fetchReports()} className="ml-3 underline font-semibold">
            Retry
          </button>
        </div>
      ) : reports.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid="fee-reports-empty">
          No reports generated yet. Use the generate buttons above.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 overflow-hidden" data-testid="fee-reports-list">
          {reports.map((r) => (
            <li key={r.id} data-testid={`fee-report-${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-950/40">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-200 capitalize">
                  {r.period} report <span className="text-slate-500 font-mono text-xs">· {r.id}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {r.createdAt} · {r.format.toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleDownload(r)}
                disabled={downloadingId === r.id}
                data-testid={`download-report-${r.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 disabled:opacity-60"
              >
                {downloadingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default FeeReportsPanel;
