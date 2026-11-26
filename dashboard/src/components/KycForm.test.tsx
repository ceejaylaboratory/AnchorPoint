import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KycForm,
  KYC_DRAFT_STORAGE_KEY,
  KYC_SESSION_KEY_STORAGE,
  saveKycDraft,
  loadKycDraft,
  clearKycDraft,
  encryptKycDraft,
  decryptKycDraft,
} from './KycForm';
import { I18nProvider } from '../i18n/config';

const renderForm = (onSubmit = vi.fn()) => {
  render(
    <I18nProvider>
      <KycForm onSubmit={onSubmit} />
    </I18nProvider>,
  );
  return onSubmit;
};

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

const fillValidForm = () => {
  fireEvent.change(input('First Name'), { target: { value: 'Ada' } });
  fireEvent.change(input('Last Name'), { target: { value: 'Lovelace' } });
  fireEvent.change(input('Email Address'), { target: { value: 'ada@example.com' } });
  fireEvent.change(input('Mobile Number'), { target: { value: '+14155552671' } });
  fireEvent.change(screen.getByLabelText('Identity Document'), { target: { value: 'passport' } });
  fireEvent.change(input('Identity Number'), { target: { value: 'A1234567' } });
};

describe('KycForm', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('resets all fields after a successful submission', async () => {
    const onSubmit = renderForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Submit for Verification' }));

    expect(await screen.findByText('Customer details submitted for verification.')).toBeTruthy();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Ada', idType: 'passport', idNumber: 'A1234567' }),
    );

    await waitFor(() => expect(input('First Name').value).toBe(''));
    expect(input('Last Name').value).toBe('');
    expect(input('Email Address').value).toBe('');
    expect(input('Mobile Number').value).toBe('');
    expect((screen.getByLabelText('Identity Document') as HTMLSelectElement).value).toBe('national_id');
    expect(input('Identity Number').value).toBe('');
  });

  it('automatically syncs entered form state to encrypted local draft storage on change', async () => {
    renderForm();

    fireEvent.change(input('First Name'), { target: { value: 'Grace' } });
    fireEvent.change(input('Email Address'), { target: { value: 'grace@example.com' } });

    await waitFor(() => {
      const storedRaw = localStorage.getItem(KYC_DRAFT_STORAGE_KEY);
      expect(storedRaw).toBeTruthy();
      // Ensure data is not stored in plaintext
      expect(storedRaw).not.toContain('Grace');
      expect(storedRaw).not.toContain('grace@example.com');
    });

    // Decrypted draft should match
    const decrypted = loadKycDraft();
    expect(decrypted).toMatchObject({
      firstName: 'Grace',
      emailAddress: 'grace@example.com',
    });
  });

  it('detects existing draft on mount and displays resume prompt with Resume and Discard options', () => {
    saveKycDraft({
      firstName: 'Katherine',
      lastName: 'Johnson',
      emailAddress: 'katherine@nasa.gov',
      mobileNumber: '+12025550199',
      idType: 'passport',
      idNumber: 'P9876543',
    });

    renderForm();

    expect(screen.getByText('Resume saved KYC submission?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();

    // Fields should still be empty before clicking Resume
    expect(input('First Name').value).toBe('');
  });

  it('restores draft data into form fields when clicking Resume', async () => {
    saveKycDraft({
      firstName: 'Katherine',
      lastName: 'Johnson',
      emailAddress: 'katherine@nasa.gov',
      mobileNumber: '+12025550199',
      idType: 'passport',
      idNumber: 'P9876543',
    });

    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => {
      expect(input('First Name').value).toBe('Katherine');
      expect(input('Last Name').value).toBe('Johnson');
      expect(input('Email Address').value).toBe('katherine@nasa.gov');
      expect(input('Mobile Number').value).toBe('+12025550199');
      expect((screen.getByLabelText('Identity Document') as HTMLSelectElement).value).toBe('passport');
      expect(input('Identity Number').value).toBe('P9876543');
    });

    // Prompt is dismissed
    expect(screen.queryByText('Resume saved KYC submission?')).toBeNull();
  });

  it('discards draft from storage and dismisses prompt without restoring fields', async () => {
    saveKycDraft({
      firstName: 'Katherine',
      lastName: 'Johnson',
      emailAddress: 'katherine@nasa.gov',
    });

    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => {
      expect(screen.queryByText('Resume saved KYC submission?')).toBeNull();
    });

    expect(localStorage.getItem(KYC_DRAFT_STORAGE_KEY)).toBeNull();
    expect(input('First Name').value).toBe('');
  });

  it('clears draft storage completely upon successful submission', async () => {
    const onSubmit = renderForm();
    fillValidForm();

    await waitFor(() => {
      expect(localStorage.getItem(KYC_DRAFT_STORAGE_KEY)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit for Verification' }));

    expect(await screen.findByText('Customer details submitted for verification.')).toBeTruthy();
    expect(onSubmit).toHaveBeenCalled();

    await waitFor(() => {
      expect(localStorage.getItem(KYC_DRAFT_STORAGE_KEY)).toBeNull();
    });
  });

  it('encrypts and decrypts draft data using temporary session key', () => {
    const testData = { firstName: 'Margaret', lastName: 'Hamilton', emailAddress: 'margaret@mit.edu' };
    const encrypted = encryptKycDraft(testData);

    expect(encrypted).not.toBe(JSON.stringify(testData));
    expect(sessionStorage.getItem(KYC_SESSION_KEY_STORAGE)).toBeTruthy();

    const decrypted = decryptKycDraft(encrypted);
    expect(decrypted).toEqual(testData);

    clearKycDraft();
    expect(loadKycDraft()).toBeNull();
  });
});
