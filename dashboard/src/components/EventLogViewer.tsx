import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Filter, Search, Terminal, Trash2, X } from 'lucide-react';
import {
  decodeContractEvent,
  decodeContractEventEnvelope,
  eventName,
  toDecodedJson,
  type DecodedEvent,
} from '../lib/xdrEvents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Event frame as it arrives on the stream. Topics and data are base64 XDR;
 * `xdr` carries a full ContractEvent envelope when the backend sends one.
 */
export interface RawContractEvent {
  id?: string;
  topics?: unknown;
  data?: unknown;
  contractId?: string;
  xdr?: string;
  timestamp?: string;
  /** Monotonic stream sequence, used to resume after a reconnect. */
  sequence?: number;
}

export type Severity = 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  id: string;
  timestamp: string;
  decoded: DecodedEvent;
  /** Event name taken from the first topic. */
  topic: string;
  contractId?: string;
  /** Severity derived from the event topic name. */
  severity: Severity;
  sequence?: number;
}

const MAX_ENTRIES = 200;
/** Delay before re-opening the stream after it drops. */
const RECONNECT_DELAY_MS = 3000;

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const ERROR_PATTERN = /error|fail|fault|reject|abort/i;
const WARN_PATTERN = /warn|caution|deprecat/i;

/**
 * Derives a log severity level from the event topic name.
 *
 * - Topics matching `error`, `fail`, `fault`, `reject`, or `abort` → ERROR
 * - Topics matching `warn`, `caution`, or `deprecat` → WARN
 * - Everything else → INFO
 */
export const deriveSeverity = (topic: string): Severity => {
  if (ERROR_PATTERN.test(topic)) return 'ERROR';
  if (WARN_PATTERN.test(topic)) return 'WARN';
  return 'INFO';
};

const SEVERITY_STYLES: Record<Severity, string> = {
  ERROR: 'bg-red-500/20 text-red-300 border-red-500/40',
  WARN: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  INFO: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
};

const SeverityBadge: React.FC<{ severity: Severity }> = ({ severity }) => (
  <span
    className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SEVERITY_STYLES[severity]}`}
    aria-label={`Severity ${severity}`}
  >
    {severity}
  </span>
);


// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const TOPIC_COLORS: Record<string, string> = {
  transfer: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  mint: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  swap: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
};

const TopicBadge: React.FC<{ topic: string }> = ({ topic }) => {
  const cls = TOPIC_COLORS[topic] ?? 'bg-slate-700/40 text-slate-300 border-slate-600/40';
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {topic}
    </span>
  );
};

/** Shortens a strkey for the filter chip; the full id stays in the title. */
const shortenId = (id: string): string =>
  id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;

/** Minimal JSON syntax highlighter — colours keys, strings, numbers, literals. */
const HighlightedJson: React.FC<{ text: string }> = ({ text }) => {
  const tokens = useMemo(
    () =>
      text.split(
        /("(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      ),
    [text],
  );

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed text-slate-300">
      {tokens.map((token, index) => {
        if (/^"/.test(token)) {
          const isKey = tokens[index + 1]?.trimStart().startsWith(':');
          return (
            <span key={index} className={isKey ? 'text-sky-300' : 'text-emerald-300'}>
              {token}
            </span>
          );
        }
        if (/^(true|false)$/.test(token)) {
          return (
            <span key={index} className="text-yellow-300">
              {token}
            </span>
          );
        }
        if (token === 'null') {
          return (
            <span key={index} className="text-red-400">
              {token}
            </span>
          );
        }
        if (/^-?\d/.test(token)) {
          return (
            <span key={index} className="text-purple-300">
              {token}
            </span>
          );
        }
        return <span key={index}>{token}</span>;
      })}
    </pre>
  );
};

/** Copies the decoded JSON for one entry, confirming inline for a moment. */
const CopyDecodedButton: React.FC<{ json: string; label: string }> = ({ json, label }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      // Clipboard is unavailable over http:// and in some embedded webviews.
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy Decoded JSON'}
    </button>
  );
};

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

let fallbackId = 0;

/** Decodes one stream frame into a renderable entry. */
export const toLogEntry = (raw: RawContractEvent): LogEntry => {
  const decoded =
    typeof raw.xdr === 'string' && raw.xdr.length > 0
      ? decodeContractEventEnvelope(raw.xdr)
      : decodeContractEvent(raw);

  // An envelope carries its own contract id; a split frame supplies one.
  const contractId = decoded.contractId ?? raw.contractId;
  const topic = eventName(decoded);

  return {
    id: raw.id ?? `event-${(fallbackId += 1)}`,
    timestamp: raw.timestamp ?? new Date().toISOString(),
    decoded: { ...decoded, contractId },
    topic,
    contractId,
    severity: deriveSeverity(topic),
    ...(typeof raw.sequence === 'number' ? { sequence: raw.sequence } : {}),
  };
};

/**
 * Appends `incoming` to `prev`, skipping entries whose id is already in the
 * log (or repeated within `incoming`), and keeps only the newest `maxEntries`.
 * A reconnecting stream may replay history, so this keeps ids unique.
 */
export const mergeEvents = (
  prev: LogEntry[],
  incoming: LogEntry[],
  maxEntries: number,
): LogEntry[] => {
  const seen = new Set(prev.map((entry) => entry.id));
  const additions = incoming.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  if (additions.length === 0) return prev;

  const next = [...prev, ...additions];
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
};

/** Highest stream sequence present in `entries`, or null when none carry one. */
const maxSequence = (entries: LogEntry[]): number | null =>
  entries.reduce<number | null>(
    (max, entry) =>
      typeof entry.sequence === 'number' && (max === null || entry.sequence > max)
        ? entry.sequence
        : max,
    null,
  );

// ---------------------------------------------------------------------------
// useDebounce
// ---------------------------------------------------------------------------

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms of
 * inactivity. Used to avoid filtering on every keystroke.
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

// ---------------------------------------------------------------------------
// EventLogViewer
// ---------------------------------------------------------------------------

interface EventLogViewerProps {
  /** Base URL for the anchor API. Connects to `{apiBaseUrl}/api/events`. */
  apiBaseUrl?: string;
  /** Maximum entries kept in memory (default: 200). */
  maxEntries?: number;
  /** Seed entries. Primarily for tests and storybook. */
  initialEvents?: RawContractEvent[];
}

/**
 * Terminal-style viewer for Soroban contract events streamed over SSE.
 *
 * Topics and payloads arrive as base64 XDR, which is unreadable in a log, so
 * each frame is decoded to native values and rendered as a JSON tree. Entries
 * can be filtered by contract id and copied as decoded JSON.
 */
export const EventLogViewer: React.FC<EventLogViewerProps> = ({
  apiBaseUrl = '',
  maxEntries = MAX_ENTRIES,
  initialEvents,
}) => {
  const [events, setEvents] = useState<LogEntry[]>(() =>
    mergeEvents([], (initialEvents ?? []).map(toLogEntry), maxEntries),
  );
  const [contractFilter, setContractFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  /** Highest sequence received so far; frames at or below it are replays. */
  const [seedSequence] = useState(() => maxSequence(events));
  const lastSequenceRef = useRef<number | null>(seedSequence);

  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    // jsdom and older webviews have no EventSource; the seeded log still works.
    if (typeof EventSource === 'undefined') return undefined;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      // Resume from the last sequence we saw so the server can skip history
      // the log already holds; replays are still filtered below.
      const since = lastSequenceRef.current;
      const url =
        since === null
          ? `${apiBaseUrl}/api/events`
          : `${apiBaseUrl}/api/events?since=${encodeURIComponent(String(since))}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setError(null);
      };

      es.onmessage = (message) => {
        let parsed: RawContractEvent;
        try {
          parsed = JSON.parse(message.data as string) as RawContractEvent;
        } catch {
          // Keep-alive comments and other non-JSON frames are not events.
          return;
        }

        if (typeof parsed.sequence === 'number') {
          const last = lastSequenceRef.current;
          if (last !== null && parsed.sequence <= last) return;
          lastSequenceRef.current = parsed.sequence;
        }

        const entry = toLogEntry(parsed);
        setEvents((prev) => mergeEvents(prev, [entry], maxEntries));
      };

      es.onerror = () => {
        setConnected(false);
        setError('Stream disconnected. Reconnecting…');
        // Reconnect ourselves (rather than letting EventSource retry the
        // original URL) so the resume point is sent with the new request.
        es.close();
        if (esRef.current === es) esRef.current = null;
        if (!disposed) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    };

    setError(null);
    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [apiBaseUrl, maxEntries]);

  useEffect(() => {
    // Guarded: jsdom and some embedded webviews do not implement it.
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [events]);

  const contractIds = useMemo(() => {
    const ids = new Set<string>();
    events.forEach((event) => {
      if (event.contractId) ids.add(event.contractId);
    });
    return [...ids].sort();
  }, [events]);

  /**
   * Multi-pass filter pipeline:
   * 1. Contract ID dropdown
   * 2. Severity dropdown
   * 3. Debounced search text — matches against topic, contractId, and full
   *    decoded JSON payload (event name / correlation id / amounts / etc.)
   */
  const filtered = useMemo(() => {
    let result = events;

    if (contractFilter !== 'all') {
      result = result.filter((e) => e.contractId === contractFilter);
    }

    if (severityFilter !== 'all') {
      result = result.filter((e) => e.severity === severityFilter);
    }

    const query = debouncedSearch.trim().toLowerCase();
    if (query) {
      result = result.filter((e) => {
        if (e.topic.toLowerCase().includes(query)) return true;
        if (e.contractId?.toLowerCase().includes(query)) return true;
        // Search the full decoded payload text for correlation ids / amounts
        const json = toDecodedJson({
          contractId: e.contractId,
          topics: e.decoded.topics.map((t) => t.value),
          data: e.decoded.data.value,
        });
        return json.toLowerCase().includes(query);
      });
    }

    return result;
  }, [events, contractFilter, severityFilter, debouncedSearch]);

  const handleClear = useCallback(() => setEvents([]), []);
  const handleClearSearch = useCallback(() => setSearchInput(''), []);

  const hasActiveFilters =
    searchInput !== '' || contractFilter !== 'all' || severityFilter !== 'all';

  const emptyMessage = (): string => {
    if (events.length === 0) return 'Waiting for events…';
    if (hasActiveFilters) return 'No events match the current search and filter criteria.';
    return 'No events for the selected contract.';
  };

  return (
    <section
      aria-label="Contract event log"
      className="flex h-full flex-col rounded-xl border border-slate-700 bg-slate-950"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2">
        <Terminal size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
        <span className="text-xs font-semibold text-slate-200">Event Stream</span>
        <span
          role="status"
          aria-label={connected ? 'Connected' : 'Disconnected'}
          className={`ml-1 inline-block h-2 w-2 rounded-full ${
            connected ? 'animate-pulse bg-emerald-400' : 'bg-red-500'
          }`}
        />

        <div className="ml-auto flex items-center gap-2">
          {/* Search input */}
          <div className="relative flex items-center">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 text-slate-400"
              aria-hidden="true"
            />
            <label htmlFor="event-search" className="sr-only">
              Search events
            </label>
            <input
              id="event-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search events…"
              aria-label="Search events"
              className="w-44 rounded-md border border-slate-700 bg-slate-800 py-1 pl-6 pr-6 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchInput && (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Clear search"
                className="absolute right-1.5 rounded p-0.5 text-slate-400 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <X size={11} aria-hidden="true" />
              </button>
            )}
          </div>

          <Filter size={13} className="text-slate-400" aria-hidden="true" />

          {/* Severity filter */}
          <label htmlFor="severity-filter" className="sr-only">
            Filter by severity
          </label>
          <select
            id="severity-filter"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as Severity | 'all')}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All severities</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>

          {/* Contract filter */}
          <label htmlFor="contract-filter" className="sr-only">
            Filter by contract ID
          </label>
          <select
            id="contract-filter"
            value={contractFilter}
            onChange={(e) => setContractFilter(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All contracts</option>
            {contractIds.map((id) => (
              <option key={id} value={id} title={id}>
                {shortenId(id)}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear log"
            className="rounded-md border border-slate-700 bg-slate-800 p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-label="Contract events"
        className="flex-1 overflow-y-auto p-3 font-mono"
      >
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

        {filtered.length === 0 ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center justify-center gap-2 py-10 text-center"
          >
            <Search size={20} className="text-slate-600" aria-hidden="true" />
            <p className="text-xs text-slate-500">{emptyMessage()}</p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setSeverityFilter('all');
                  setContractFilter('all');
                }}
                className="mt-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          filtered.map((event) => {
            const json = toDecodedJson({
              contractId: event.contractId,
              topics: event.decoded.topics.map((topic) => topic.value),
              data: event.decoded.data.value,
            });

            return (
              <article
                key={event.id}
                aria-label={`Event ${event.topic}`}
                className="mb-3 rounded-lg border border-slate-800 bg-slate-900 p-3"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <TopicBadge topic={event.topic} />
                  <SeverityBadge severity={event.severity} />
                  <time className="text-[10px] text-slate-500" dateTime={event.timestamp}>
                    {event.timestamp}
                  </time>
                  {event.contractId && (
                    <span className="text-[10px] text-slate-600" title={event.contractId}>
                      {shortenId(event.contractId)}
                    </span>
                  )}
                  <CopyDecodedButton
                    json={json}
                    label={`Copy decoded JSON for event ${event.topic}`}
                  />
                </div>

                {/* Topic arms are the readable half of an event; list them
                    before the payload so the shape is obvious at a glance. */}
                <ul className="mb-2 space-y-0.5">
                  {event.decoded.topics.map((topic, index) => (
                    <li key={index} className="flex items-baseline gap-2 text-[11px]">
                      <span className="text-slate-500">topic[{index}]</span>
                      {topic.type && <span className="text-slate-600">{topic.type}</span>}
                      <span className={topic.error ? 'text-red-400' : 'text-slate-200'}>
                        {topic.error ?? String(topic.value)}
                      </span>
                    </li>
                  ))}
                </ul>

                {event.decoded.data.error ? (
                  <p className="text-xs text-red-400">{event.decoded.data.error}</p>
                ) : (
                  <HighlightedJson text={toDecodedJson(event.decoded.data.value)} />
                )}
              </article>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
};

export default EventLogViewer;
