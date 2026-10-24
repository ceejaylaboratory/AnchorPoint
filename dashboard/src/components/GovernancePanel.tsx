import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Vote } from 'lucide-react';

export interface Proposal {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'passed' | 'rejected' | 'expired';
  deadline: string;
  votesFor: number;
  votesAgainst: number;
  userVote?: 'for' | 'against';
  votingPower: number;
}

interface GovernancePanelProps {
  apiBaseUrl?: string;
  walletAddress?: string;
}

const MOCK_PROPOSALS: Proposal[] = [
  {
    id: 'prop-1',
    title: 'Increase base reserve for liquidity vaults',
    description: 'Raise the minimum reserve ratio from 110% to 120% to reduce liquidation cascades during volatility.',
    status: 'active',
    deadline: new Date(Date.now() + 3 * 86400000).toISOString(),
    votesFor: 12400,
    votesAgainst: 3100,
    votingPower: 500,
  },
  {
    id: 'prop-2',
    title: 'Add EURT as accepted collateral',
    description: 'Whitelist EURT for minting yXLM to diversify collateral and deepen euro liquidity.',
    status: 'active',
    deadline: new Date(Date.now() + 6 * 86400000).toISOString(),
    votesFor: 8200,
    votesAgainst: 1500,
    votingPower: 500,
  },
];

async function fetchProposals(apiBaseUrl: string): Promise<Proposal[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/governance/proposals`);
    if (!res.ok) return null;
    const data = await res.json();
    return (Array.isArray(data) ? data : data.proposals) as Proposal[];
  } catch {
    return null;
  }
}

export const GovernancePanel: React.FC<GovernancePanelProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  walletAddress = '',
}) => {
  const [proposals, setProposals] = useState<Proposal[]>(MOCK_PROPOSALS);
  const [selectedId, setSelectedId] = useState<string>(MOCK_PROPOSALS[0].id);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchProposals(apiBaseUrl).then(list => {
      if (!cancelled && list && list.length > 0) {
        setProposals(list);
        setSelectedId(list[0].id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  const selected = proposals.find(p => p.id === selectedId) ?? proposals[0];

  const vote = useCallback(
    async (choice: 'for' | 'against') => {
      if (!selected || voting) return;
      setVoting(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/governance/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposalId: selected.id, choice, voter: walletAddress }),
        });
        if (!res.ok) throw new Error(`Vote failed (${res.status})`);
        const data = await res.json().catch(() => ({}));
        setProposals(prev =>
          prev.map(p =>
            p.id === selected.id
              ? {
                  ...p,
                  votesFor: Number(data.votesFor ?? p.votesFor + (choice === 'for' ? p.votingPower : 0)),
                  votesAgainst: Number(data.votesAgainst ?? p.votesAgainst + (choice === 'against' ? p.votingPower : 0)),
                  userVote: choice,
                }
              : p,
          ),
        );
      } catch (e: any) {
        // Optimistic local update so UI works without backend.
        setProposals(prev =>
          prev.map(p =>
            p.id === selected.id
              ? {
                  ...p,
                  votesFor: p.votesFor + (choice === 'for' ? p.votingPower : 0),
                  votesAgainst: p.votesAgainst + (choice === 'against' ? p.votingPower : 0),
                  userVote: choice,
                }
              : p,
          ),
        );
        setError(e?.message ?? 'Vote failed');
      } finally {
        setVoting(false);
      }
    },
    [apiBaseUrl, selected, voting, walletAddress],
  );

  if (!selected) return null;
  const total = selected.votesFor + selected.votesAgainst;
  const forPct = total === 0 ? 0 : Math.round((selected.votesFor / total) * 100);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" data-testid="governance-panel">
      <div className="lg:col-span-5 space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Proposals</h3>
        {proposals.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            data-testid={`proposal-item-${p.id}`}
            className={`w-full text-left p-4 rounded-xl border transition-colors ${
              p.id === selectedId ? 'border-primary bg-primary/10' : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-100 text-sm">{p.title}</span>
              <span
                data-testid={`proposal-status-${p.id}`}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  p.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {p.status}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
              <Clock size={12} /> Deadline: {new Date(p.deadline).toLocaleDateString()}
              {p.userVote && (
                <span className="ml-2 inline-flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 size={12} /> Voted {p.userVote}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="lg:col-span-7">
        <div className="glass-card p-6 border border-slate-800 space-y-4" data-testid="proposal-detail">
          <h2 className="text-lg font-bold text-slate-100">{selected.title}</h2>
          <p className="text-sm text-slate-400">{selected.description}</p>
          <div className="text-xs text-slate-400">
            Your voting power: <strong className="text-slate-100 font-mono">{selected.votingPower}</strong>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-emerald-400">For: {selected.votesFor.toLocaleString()}</span>
              <span className="text-rose-400">Against: {selected.votesAgainst.toLocaleString()}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden" aria-hidden="true">
              <div className="h-full bg-emerald-500" style={{ width: `${forPct}%` }} />
            </div>
          </div>
          {selected.userVote ? (
            <p className="text-sm text-emerald-300 flex items-center gap-2" data-testid="user-vote-badge">
              <CheckCircle2 size={16} /> You voted {selected.userVote}
            </p>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => void vote('for')}
                disabled={voting || selected.status !== 'active'}
                data-testid="vote-for-btn"
                className="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold disabled:opacity-50"
              >
                <Vote size={15} /> Vote For
              </button>
              <button
                onClick={() => void vote('against')}
                disabled={voting || selected.status !== 'active'}
                data-testid="vote-against-btn"
                className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50"
              >
                Vote Against
              </button>
            </div>
          )}
          {error && (
            <p className="text-xs text-amber-300" role="note">
              Backend unreachable ({error}); vote recorded locally.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default GovernancePanel;
