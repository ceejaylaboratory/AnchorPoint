import { useState } from 'react';

type DataPoint = { label: string; deposits: number; withdrawals: number };
type Period = '7D' | '1M' | '3M';

const CHART_DATA: Record<Period, DataPoint[]> = {
  '7D': [
    { label: 'Mon', deposits: 12400, withdrawals: 8200 },
    { label: 'Tue', deposits: 18600, withdrawals: 11300 },
    { label: 'Wed', deposits: 9800, withdrawals: 14500 },
    { label: 'Thu', deposits: 23100, withdrawals: 9700 },
    { label: 'Fri', deposits: 16500, withdrawals: 19200 },
    { label: 'Sat', deposits: 7300, withdrawals: 5100 },
    { label: 'Sun', deposits: 5900, withdrawals: 4300 },
  ],
  '1M': [
    { label: 'Wk 1', deposits: 54200, withdrawals: 38700 },
    { label: 'Wk 2', deposits: 71800, withdrawals: 52300 },
    { label: 'Wk 3', deposits: 48900, withdrawals: 61500 },
    { label: 'Wk 4', deposits: 83100, withdrawals: 44800 },
  ],
  '3M': [
    { label: 'Jan', deposits: 198400, withdrawals: 142600 },
    { label: 'Feb', deposits: 223700, withdrawals: 178900 },
    { label: 'Mar', deposits: 261500, withdrawals: 194300 },
  ],
};

// SVG viewport dimensions
const VW = 460;
const VH = 150;
const PL = 50; // left padding for Y-axis labels
const PR = 8;  // right padding
const PT = 10; // top padding
const PB = 28; // bottom padding for X-axis labels
const IW = VW - PL - PR;
const IH = VH - PT - PB;

const DEPOSIT_COLOR = '#6366f1';
const WITHDRAWAL_COLOR = '#f59e0b';

function niceMax(val: number): number {
  if (val <= 0) return 10000;
  const magnitude = Math.pow(10, Math.floor(Math.log10(val)));
  return Math.ceil(val / magnitude) * magnitude;
}

function formatValue(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

type TooltipState = { index: number; point: DataPoint } | null;

export const VolumeChart = () => {
  const [period, setPeriod] = useState<Period>('7D');
  const [hovered, setHovered] = useState<TooltipState>(null);

  const data = CHART_DATA[period];
  const maxVal = Math.max(...data.flatMap((d) => [d.deposits, d.withdrawals]));
  const yMax = niceMax(maxVal);

  const groupW = IW / data.length;
  const barW = Math.min(groupW * 0.28, 18);

  const scaleY = (v: number) => PT + IH - (v / yMax) * IH;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));

  const renderTooltip = (index: number, point: DataPoint) => {
    const gx = PL + index * groupW;
    const centerX = gx + groupW / 2;
    const TW = 88;
    const TH = 54;
    const tx = Math.max(PL, Math.min(centerX - TW / 2, VW - PR - TW));
    const ty = PT + 2;

    return (
      <g aria-hidden="true">
        <rect
          x={tx} y={ty} width={TW} height={TH}
          rx="5" ry="5"
          fill="rgb(2,6,23)"
          stroke="rgba(148,163,184,0.2)"
          strokeWidth="1"
        />
        <text
          x={tx + TW / 2} y={ty + 15}
          textAnchor="middle"
          fontSize="9.5"
          fontWeight="600"
          fill="rgb(226,232,240)"
        >
          {point.label}
        </text>
        <circle cx={tx + 11} cy={ty + 29} r="3.5" fill={DEPOSIT_COLOR} />
        <text x={tx + 18} y={ty + 32.5} fontSize="9" fill="rgb(148,163,184)">
          Dep: {formatValue(point.deposits)}
        </text>
        <circle cx={tx + 11} cy={ty + 44} r="3.5" fill={WITHDRAWAL_COLOR} />
        <text x={tx + 18} y={ty + 47.5} fontSize="9" fill="rgb(148,163,184)">
          Wit: {formatValue(point.withdrawals)}
        </text>
      </g>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-display text-xl font-bold text-slate-100">Transaction Volume</h3>
          <p className="text-xs text-slate-500 mt-0.5">Deposits vs Withdrawals</p>
        </div>
        <div
          className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1"
          role="group"
          aria-label="Select time period"
        >
          {(['7D', '1M', '3M'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => { setPeriod(p); setHovered(null); }}
              aria-pressed={period === p}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
                period === p
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 mb-2" aria-hidden="true">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: DEPOSIT_COLOR }} />
          <span className="text-xs text-slate-400">Deposits</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: WITHDRAWAL_COLOR }} />
          <span className="text-xs text-slate-400">Withdrawals</span>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          className="w-full h-full"
          aria-label={`Transaction volume chart — ${period} period`}
          role="img"
          onMouseLeave={() => setHovered(null)}
        >
          {/* Y-axis grid lines and labels */}
          {yTicks.map((tick) => {
            const y = scaleY(tick);
            return (
              <g key={tick}>
                <line
                  x1={PL} y1={y} x2={VW - PR} y2={y}
                  stroke="rgba(148,163,184,0.1)"
                  strokeWidth="1"
                  strokeDasharray={tick === 0 ? undefined : '3,3'}
                />
                <text
                  x={PL - 5} y={y + 3.5}
                  textAnchor="end"
                  fontSize="9"
                  fill="rgb(100,116,139)"
                >
                  {formatValue(tick)}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {data.map((point, i) => {
            const gx = PL + i * groupW;
            const centerX = gx + groupW / 2;
            const depX = centerX - barW - 1;
            const witX = centerX + 1;

            const depH = (point.deposits / yMax) * IH;
            const witH = (point.withdrawals / yMax) * IH;
            const depY = scaleY(point.deposits);
            const witY = scaleY(point.withdrawals);

            const isHov = hovered?.index === i;

            return (
              <g key={point.label}>
                {/* Column hover highlight */}
                {isHov && (
                  <rect
                    x={gx + 2} y={PT}
                    width={groupW - 4} height={IH}
                    fill="rgba(148,163,184,0.06)"
                    rx="3" ry="3"
                  />
                )}

                {/* Deposit bar */}
                <rect
                  x={depX} y={depY}
                  width={barW} height={depH}
                  rx="2" ry="2"
                  fill={DEPOSIT_COLOR}
                  opacity={isHov ? 1 : 0.75}
                  style={{ transition: 'opacity 0.15s' }}
                />

                {/* Withdrawal bar */}
                <rect
                  x={witX} y={witY}
                  width={barW} height={witH}
                  rx="2" ry="2"
                  fill={WITHDRAWAL_COLOR}
                  opacity={isHov ? 1 : 0.75}
                  style={{ transition: 'opacity 0.15s' }}
                />

                {/* X-axis label */}
                <text
                  x={centerX} y={VH - 8}
                  textAnchor="middle"
                  fontSize="9"
                  fill="rgb(100,116,139)"
                >
                  {point.label}
                </text>

                {/* Invisible hover target covering the full column */}
                <rect
                  x={gx} y={PT}
                  width={groupW} height={IH + PB - 6}
                  fill="transparent"
                  style={{ cursor: 'default' }}
                  onMouseEnter={() => setHovered({ index: i, point })}
                />
              </g>
            );
          })}

          {/* Tooltip */}
          {hovered && renderTooltip(hovered.index, hovered.point)}
        </svg>
      </div>
    </div>
  );
};

export default VolumeChart;
