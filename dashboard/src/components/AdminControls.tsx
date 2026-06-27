import React, { useState, useEffect } from 'react';
import { Network, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

interface AdminControlsProps {
  apiBaseUrl: string;
}

export const AdminControls: React.FC<AdminControlsProps> = ({ apiBaseUrl }) => {
  const [network, setNetwork] = useState<string>('TESTNET');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Modal States
  const [isNetworkModalOpen, setIsNetworkModalOpen] = useState(false);
  const [targetNetwork, setTargetNetwork] = useState<string>('');
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);

  useEffect(() => {
    fetchCurrentNetwork();
  }, []);

  const fetchCurrentNetwork = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/network`);
      if (response.ok) {
        const data = await response.json();
        if (data.network) {
          setNetwork(data.network);
        }
      }
    } catch (err) {
      console.error('Failed to fetch network config:', err);
    }
  };

  const handleNetworkChangeInitiate = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value && value !== network) {
      setTargetNetwork(value);
      setIsNetworkModalOpen(true);
    }
  };

  const handleNetworkChangeConfirm = async () => {
    setIsNetworkModalOpen(false);
    setLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/network`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ network: targetNetwork }),
      });

      if (!response.ok) {
        throw new Error('Failed to switch network');
      }

      setNetwork(targetNetwork);
      showStatus(`Switched Stellar network to ${targetNetwork} successfully.`, false);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Error switching network.', true);
    } finally {
      setLoading(false);
    }
  };

  const handleQueueCleanConfirm = async () => {
    setIsQueueModalOpen(false);
    setLoading(true);
    setStatusMessage(null);

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${apiBaseUrl}/api/queue/clean?days=0`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to purge job queue.');
      }

      showStatus('All job queues successfully purged from Redis.', false);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Error purging queues.', true);
    } finally {
      setLoading(false);
    }
  };

  const showStatus = (text: string, isError: boolean) => {
    setStatusMessage({ text, isError });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  return (
    <div className="glass-card p-8">
      <h3 className="mb-4 text-xl font-bold text-slate-100 flex items-center gap-2">
        <span>Admin Control Center</span>
        <span className="rounded bg-rose-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-rose-400 border border-rose-500/20">
          Sensitive Actions
        </span>
      </h3>
      <p className="mb-6 text-sm text-slate-400">
        These options allow direct modification of system-wide settings, databases, and network environments. 
        All actions require authorization and explicit confirmation.
      </p>

      {statusMessage && (
        <div
          className={`mb-6 flex items-start gap-3 rounded-lg border p-4 text-sm ${
            statusMessage.isError
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {statusMessage.isError ? (
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
          )}
          <p>{statusMessage.text}</p>
        </div>
      )}

      <div className="space-y-6">
        {/* Switch Stellar Network */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <div className="space-y-1">
            <h4 className="font-semibold text-slate-200 flex items-center gap-2">
              <Network size={16} className="text-primary" />
              Stellar Network Environment
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Switches the blockchain environment that the anchor queries for ledger entries and indexes.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="admin-network-select" className="sr-only">Select Stellar Network</label>
            <select
              id="admin-network-select"
              value={network}
              onChange={handleNetworkChangeInitiate}
              disabled={loading}
              className="input-field text-sm font-medium pr-8"
            >
              <option value="TESTNET">TESTNET (Stellar Test Network)</option>
              <option value="PUBLIC">PUBLIC (Stellar Main Network)</option>
              <option value="FUTURENET">FUTURENET (Stellar Future Network)</option>
            </select>
          </div>
        </div>

        {/* Purge Job Queues */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <div className="space-y-1">
            <h4 className="font-semibold text-slate-200 flex items-center gap-2">
              <Trash2 size={16} className="text-rose-400" />
              Purge Redis Job Queues
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Deletes completed, active, and failed jobs from the BullMQ queues. This clears the processing history.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsQueueModalOpen(true)}
            disabled={loading}
            className="action-button flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/25 disabled:opacity-40 shrink-0"
          >
            Purge Queues
          </button>
        </div>
      </div>

      {/* Network Switch Confirmation Modal */}
      <ConfirmModal
        isOpen={isNetworkModalOpen}
        title="Switch Stellar Network?"
        message={`Are you sure you want to switch the Stellar network to ${targetNetwork}? This will alter system configurations, clear session indexes, and disconnect active client configurations.`}
        confirmText={`Switch to ${targetNetwork}`}
        requireTypingConfirm={true}
        onConfirm={handleNetworkChangeConfirm}
        onCancel={() => setIsNetworkModalOpen(false)}
      />

      {/* Queue Clean Confirmation Modal */}
      <ConfirmModal
        isOpen={isQueueModalOpen}
        title="Purge Active and Completed Job Queues?"
        message="This operation is irreversible. All cached event logs, historical transactions, and active processing tasks will be deleted from the system queue."
        confirmText="Purge All Queues"
        requireTypingConfirm={true}
        onConfirm={handleQueueCleanConfirm}
        onCancel={() => setIsQueueModalOpen(false)}
      />
    </div>
  );
};

export default AdminControls;
