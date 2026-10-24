import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  NotificationPreferences,
  toPreferencesPayload,
} from './NotificationPreferences';

const API = 'http://localhost:3002';
const ENDPOINT = `${API}/api/notifications/preferences`;

const SAVED = {
  emailEnabled: true,
  smsEnabled: true,
  pushEnabled: false,
  phone: '+15551234567',
};

/** Fetch stub: GET returns `saved`, PATCH succeeds unless told otherwise. */
const stubFetch = (saved: Record<string, unknown> = SAVED, patchOk = true) => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      return { ok: patchOk, json: async () => ({ data: JSON.parse(String(init.body)) }) };
    }
    return { ok: true, json: async () => ({ data: saved }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const renderLoaded = async (...args: Parameters<typeof stubFetch>) => {
  const fetchMock = stubFetch(...args);
  render(<NotificationPreferences apiBaseUrl={API} />);
  await waitFor(() => expect(screen.getByText('Notification Preferences')).toBeTruthy());
  return fetchMock;
};

const emailToggle = () => screen.getByLabelText('Toggle email notifications');
const smsToggle = () => screen.getByLabelText('Toggle SMS notifications');
const pushToggle = () => screen.getByLabelText('Toggle push notifications');
const saveButton = () => screen.getByRole('button', { name: /save preferences/i });
const resetButton = () =>
  screen.getByLabelText('Reset notification preferences to defaults');

/** The PATCH body of the nth save, parsed. */
const patchBody = (fetchMock: ReturnType<typeof vi.fn>, index = 0) => {
  const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
  return JSON.parse(String(patches[index]?.[1]?.body));
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('NotificationPreferences loading', () => {
  it('hydrates each toggle from the user configuration API', async () => {
    await renderLoaded();

    expect(emailToggle().getAttribute('aria-checked')).toBe('true');
    expect(smsToggle().getAttribute('aria-checked')).toBe('true');
    expect(pushToggle().getAttribute('aria-checked')).toBe('false');
    expect((screen.getByLabelText('Phone Number') as HTMLInputElement).value).toBe(
      '+15551234567',
    );
  });

  it('sends the auth token with the request', async () => {
    localStorage.setItem('authToken', 'test-token');
    const fetchMock = await renderLoaded();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('falls back to defaults for channels the response omits', async () => {
    await renderLoaded({ emailEnabled: false });

    expect(emailToggle().getAttribute('aria-checked')).toBe('false');
    expect(smsToggle().getAttribute('aria-checked')).toBe('false');
    expect(pushToggle().getAttribute('aria-checked')).toBe('false');
  });

  it('surfaces a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<NotificationPreferences apiBaseUrl={API} />);

    await waitFor(() => expect(screen.getByText('Failed to fetch preferences')).toBeTruthy());
  });
});

describe('NotificationPreferences toggling', () => {
  it('flips a toggle and marks the form dirty', async () => {
    await renderLoaded();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(pushToggle());

    await waitFor(() => expect(pushToggle().getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('reveals the phone field only while SMS is enabled', async () => {
    await renderLoaded({ ...SAVED, smsEnabled: false, phone: '' });

    expect(screen.queryByLabelText('Phone Number')).toBeNull();

    fireEvent.click(smsToggle());

    await waitFor(() => expect(screen.getByLabelText('Phone Number')).toBeTruthy());
  });

  it('does not persist a toggle until the form is saved', async () => {
    const fetchMock = await renderLoaded();

    fireEvent.click(pushToggle());

    await waitFor(() => expect(pushToggle().getAttribute('aria-checked')).toBe('true'));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
});

describe('NotificationPreferences saving', () => {
  it('PATCHes every channel and shows the success indicator', async () => {
    const fetchMock = await renderLoaded();

    fireEvent.click(pushToggle());
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByText('Preferences saved successfully')).toBeTruthy(),
    );
    expect(patchBody(fetchMock)).toMatchObject({
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: true,
      phone: '+15551234567',
    });
  });

  it('treats the saved values as the new baseline', async () => {
    await renderLoaded();

    fireEvent.click(pushToggle());
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByText('Preferences saved successfully')).toBeTruthy(),
    );
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('reports a failed save and keeps the form dirty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderLoaded(SAVED, false);

    fireEvent.click(pushToggle());
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText('Failed to save preferences')).toBeTruthy());
    expect(screen.queryByText('Preferences saved successfully')).toBeNull();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('announces the outcome politely', async () => {
    await renderLoaded();

    fireEvent.click(pushToggle());
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() => {
      const live = screen
        .getAllByRole('status')
        .find((node) => node.textContent?.includes('saved successfully'));
      expect(live?.getAttribute('aria-live')).toBe('polite');
    });
  });
});

describe('NotificationPreferences disabling every channel', () => {
  /** Fetch stub backed by a mutable server record, so a reload reflects saves. */
  const stubServer = (initial: Record<string, unknown>) => {
    let stored: Record<string, unknown> = { ...initial };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        stored = { ...stored, ...JSON.parse(String(init.body)) };
        return { ok: true, json: async () => ({ status: 'success' }) };
      }
      return { ok: true, json: async () => ({ data: stored }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const allOn = { emailEnabled: true, smsEnabled: true, pushEnabled: true, phone: '+15551234567' };

  it('PATCHes explicit false values when every channel is turned off', async () => {
    const fetchMock = stubServer(allOn);
    render(<NotificationPreferences apiBaseUrl={API} />);
    await waitFor(() => expect(screen.getByText('Notification Preferences')).toBeTruthy());

    fireEvent.click(emailToggle());
    fireEvent.click(smsToggle());
    fireEvent.click(pushToggle());
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByText('Preferences saved successfully')).toBeTruthy(),
    );
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patchBody(fetchMock)).toMatchObject({
      emailEnabled: false,
      smsEnabled: false,
      pushEnabled: false,
    });
  });

  it('keeps every channel off after a reload', async () => {
    stubServer(allOn);
    render(<NotificationPreferences apiBaseUrl={API} />);
    await waitFor(() => expect(screen.getByText('Notification Preferences')).toBeTruthy());

    fireEvent.click(emailToggle());
    fireEvent.click(smsToggle());
    fireEvent.click(pushToggle());
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(screen.getByText('Preferences saved successfully')).toBeTruthy(),
    );

    cleanup();
    render(<NotificationPreferences apiBaseUrl={API} />);
    await waitFor(() => expect(screen.getByText('Notification Preferences')).toBeTruthy());

    expect(emailToggle().getAttribute('aria-checked')).toBe('false');
    expect(smsToggle().getAttribute('aria-checked')).toBe('false');
    expect(pushToggle().getAttribute('aria-checked')).toBe('false');
  });

  it('sends a channel the API returned as null as an explicit boolean', async () => {
    const fetchMock = await renderLoaded({ emailEnabled: true, smsEnabled: null, pushEnabled: null });

    fireEvent.click(emailToggle());
    await waitFor(() => expect((saveButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByText('Preferences saved successfully')).toBeTruthy(),
    );
    const body = patchBody(fetchMock);
    expect(body).toMatchObject({ emailEnabled: false, smsEnabled: false, pushEnabled: false });
  });
});

describe('toPreferencesPayload', () => {
  it('serializes every channel even when all are disabled', () => {
    const json = JSON.parse(
      JSON.stringify(toPreferencesPayload({ emailEnabled: false, smsEnabled: undefined })),
    );

    expect(json).toEqual({ emailEnabled: false, smsEnabled: false, pushEnabled: false, phone: '' });
  });
});

describe('NotificationPreferences reset to defaults', () => {
  it('restores the default toggles and persists them', async () => {
    const fetchMock = await renderLoaded();

    fireEvent.click(resetButton());

    await waitFor(() => expect(smsToggle().getAttribute('aria-checked')).toBe('false'));
    expect(emailToggle().getAttribute('aria-checked')).toBe('true');
    expect(pushToggle().getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(patchBody(fetchMock)).toMatchObject(DEFAULT_PREFERENCES));
  });

  it('leaves the form clean afterwards', async () => {
    await renderLoaded();

    fireEvent.click(resetButton());

    await waitFor(() =>
      expect(screen.getByText('Preferences saved successfully')).toBeTruthy(),
    );
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('is disabled when the preferences already match the defaults', async () => {
    await renderLoaded({ ...DEFAULT_PREFERENCES });

    expect((resetButton() as HTMLButtonElement).disabled).toBe(true);
  });
});
