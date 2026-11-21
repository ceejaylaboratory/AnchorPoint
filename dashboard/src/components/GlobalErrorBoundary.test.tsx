import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalErrorBoundary, {
  buildDiagnosticReport,
  formatDiagnosticReport,
  reportError,
} from './GlobalErrorBoundary';

// Obviously fake values: the assertions below verify that none of them leak.
const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const SEED = `S${'A'.repeat(55)}`;
const TOKEN = 'session-token-do-not-share';
const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ0ZXN0In0', 'c2lnbmF0dXJl'].join('.');
const COMPONENT_STACK = `\n    at LeakyWidget (http://localhost/dashboard?token=${TOKEN})\n    at transfer from ${WALLET}`;

const BrokenWidget = () => {
  throw new Error('widget render failed');
};

const LeakyWidget = () => {
  throw new Error(`render failed for ${WALLET} token=${TOKEN} seed=${SEED} jwt=${JWT}`);
};

const leakingError = () => {
  const error = new Error(`render failed for ${WALLET} token=${TOKEN} seed=${SEED} jwt=${JWT}`);
  error.stack = `Error: render failed for ${WALLET}\n    at LeakyWidget (/src/LeakyWidget.tsx:3:9)\n    authorization=Bearer ${TOKEN}`;
  return error;
};

beforeEach(() => {
  // React logs every deliberately thrown test error to the console.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GlobalErrorBoundary compact mode', () => {
  it('contains a widget failure without hiding sibling UI', () => {
    render(
      <>
        <GlobalErrorBoundary compact>
          <BrokenWidget />
        </GlobalErrorBoundary>
        <button>Dashboard navigation</button>
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This section could not be displayed.');
    expect(screen.getByRole('button', { name: 'Dashboard navigation' })).toBeInTheDocument();
  });
});

describe('anonymized diagnostic bundle', () => {
  it('captures context and redacts wallet addresses, seeds and session tokens', () => {
    const report = buildDiagnosticReport(leakingError(), { componentStack: COMPONENT_STACK }, {
      timestamp: '2026-01-02T03:04:05.000Z',
      userAgent: `Mozilla/5.0 (Diagnostic Test) token=${TOKEN}`,
      url: `http://localhost/dashboard?token=${TOKEN}&wallet=${WALLET}#seed=${SEED}`,
      sessionId: `sid-${TOKEN}`,
    });

    expect(report.timestamp).toBe('2026-01-02T03:04:05.000Z');
    // Query strings and fragments are dropped entirely from the reported URL.
    expect(report.url).toBe('http://localhost/dashboard');
    expect(report.sessionId).toBe('sid-[REDACTED]');
    expect(report.message).toContain('render failed');
    expect(report.stack).toContain('at LeakyWidget');
    expect(report.componentStack).toContain('LeakyWidget');

    const diagnostic = formatDiagnosticReport(report);
    expect(diagnostic).toContain('AnchorPoint Diagnostic Report');
    expect(diagnostic).toContain('Timestamp (timestamp): 2026-01-02T03:04:05.000Z');
    expect(diagnostic).toContain('URL (url): http://localhost/dashboard');
    expect(diagnostic).toContain('User Agent (userAgent):');
    expect(diagnostic).toContain('Session ID (sessionId):');
    expect(diagnostic).toContain('Message (message):');
    expect(diagnostic).toContain('Stack (stack):');
    expect(diagnostic).toContain('Component Stack (componentStack):');
    expect(diagnostic).toContain('[REDACTED]');

    for (const secret of [WALLET, SEED, TOKEN, JWT]) {
      expect(diagnostic).not.toContain(secret);
    }
  });

  it('redacts private keys embedded in stacks and messages', () => {
    const error = new Error('cannot sign');
    error.stack = `Error: cannot sign\n    at sign with privateKey=${SEED}\n    at 0x${'f'.repeat(64)}`;

    const report = buildDiagnosticReport(error, null, { timestamp: '2026-01-02T03:04:05.000Z' });
    const diagnostic = formatDiagnosticReport(report);

    expect(diagnostic).not.toContain(SEED);
    expect(diagnostic).not.toContain('f'.repeat(64));
    expect(diagnostic).toContain('privateKey=[REDACTED]');
  });
});

describe('GlobalErrorBoundary crash recovery', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const originalLocation = window.location;
  const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    writeText.mockClear();
    reloadMock = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Diagnostic Test)',
      configurable: true,
    });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: `http://localhost/dashboard?token=${TOKEN}`,
        origin: 'http://localhost',
        pathname: '/dashboard',
        search: `?token=${TOKEN}`,
        hash: '',
        reload: reloadMock,
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    if (originalUserAgent) Object.defineProperty(navigator, 'userAgent', originalUserAgent);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('shows recovery actions after a child throws during render', () => {
    render(
      <GlobalErrorBoundary>
        <BrokenWidget />
      </GlobalErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'System Error' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload App' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Diagnostic Info' })).toBeInTheDocument();
    expect(screen.getByTestId('report-problem-link')).toBeInTheDocument();
  });

  it('copies an anonymized diagnostic dump with the component stack', async () => {
    const { unmount } = render(
      <GlobalErrorBoundary>
        <LeakyWidget />
      </GlobalErrorBoundary>,
    );

    // The visible fallback is sanitized too, so screenshots cannot leak PII.
    expect(document.body.textContent).not.toContain(WALLET);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Diagnostic Info' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('AnchorPoint Diagnostic Report');
    expect(copied).toContain('Stack (stack):');
    expect(copied).toContain('Component Stack (componentStack):');
    expect(copied).toContain('render failed');
    expect(copied).toContain('[REDACTED]');
    for (const secret of [WALLET, SEED, TOKEN, JWT]) {
      expect(copied).not.toContain(secret);
    }
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();

    unmount();
  });

  it('reloads the app and clears the crash state', () => {
    render(
      <GlobalErrorBoundary>
        <BrokenWidget />
      </GlobalErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reload App' }));

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'System Error' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reloading AnchorPoint');
  });
});

describe('optional crash reporting', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('posts an anonymized report to a configured collector', async () => {
    vi.stubEnv('VITE_ERROR_REPORT_URL', 'https://collector.example.test/crash');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(reportError(leakingError(), { componentStack: COMPONENT_STACK })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe('https://collector.example.test/crash');

    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      timestamp: expect.any(String),
      message: expect.any(String),
      stack: expect.any(String),
      componentStack: expect.any(String),
      userAgent: expect.any(String),
      url: expect.any(String),
      sessionId: expect.any(String),
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('[REDACTED]');
    for (const secret of [WALLET, SEED, TOKEN, JWT]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('does not submit anything when no collector is configured', async () => {
    vi.stubEnv('VITE_ERROR_REPORT_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(reportError(new Error('nothing to send'), null)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
