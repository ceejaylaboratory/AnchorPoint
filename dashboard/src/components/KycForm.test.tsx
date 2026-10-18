import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KycForm } from './KycForm';
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
});
