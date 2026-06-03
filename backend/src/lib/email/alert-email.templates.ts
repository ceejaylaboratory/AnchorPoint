import type { AlertPayload } from '../../types/alerts';

export interface AlertEmailContent {
  subject: string;
  text: string;
  html: string;
}

export type SystemAlertSeverity = 'info' | 'warning' | 'critical';

export interface SystemAlertTemplateInput {
  severity: SystemAlertSeverity;
  metric: string;
  message: string;
  value?: string | number;
  threshold?: string | number;
  window?: string;
  detectedAt?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function severityColor(severity: SystemAlertSeverity): string {
  switch (severity) {
    case 'critical':
      return '#dc2626';
    case 'warning':
      return '#d97706';
    default:
      return '#2563eb';
  }
}

function wrapAlertHtml(title: string, severity: SystemAlertSeverity, bodyHtml: string): string {
  const accent = severityColor(severity);
  return `
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#0f172a;font-family:Arial,Helvetica,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#111827;border:1px solid #1e293b;border-radius:8px;">
      <tr>
        <td style="padding:20px 24px;border-bottom:3px solid ${accent};">
          <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">AnchorPoint Alert</p>
          <h1 style="margin:8px 0 0;font-size:20px;color:#f8fafc;">${escapeHtml(title)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">${bodyHtml}</td>
      </tr>
      <tr>
        <td style="padding:16px 24px;border-top:1px solid #1e293b;font-size:12px;color:#64748b;">
          Automated notification from AnchorPoint. Do not reply to this email.
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

export function renderHotWalletLowBalanceAlert(alert: AlertPayload): AlertEmailContent {
  const subject = `[AnchorPoint] Low Balance Alert: ${alert.walletLabel}`;
  const text = [
    'Hot Wallet Low Balance Alert',
    '',
    `Wallet: ${alert.walletLabel}`,
    `Asset: ${alert.assetCode}`,
    `Current Balance: ${alert.currentBalance}`,
    `Threshold: ${alert.thresholdAmount}`,
    `Public Key: ${alert.publicKey}`,
    `Detected At: ${alert.checkedAt}`,
    '',
    'Please fund the wallet or investigate unexpected outflows.',
  ].join('\n');

  const html = wrapAlertHtml(
    'Hot Wallet Low Balance',
    'critical',
    `
      <p style="margin:0 0 16px;color:#cbd5e1;">A monitored hot wallet balance has fallen below its configured threshold.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;">
        <tr><td style="padding:6px 0;color:#94a3b8;width:160px;">Wallet</td><td style="padding:6px 0;color:#f8fafc;">${escapeHtml(alert.walletLabel)}</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;">Asset</td><td style="padding:6px 0;color:#f8fafc;">${escapeHtml(alert.assetCode)}</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;">Current Balance</td><td style="padding:6px 0;color:#f8fafc;">${escapeHtml(String(alert.currentBalance))}</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;">Threshold</td><td style="padding:6px 0;color:#f8fafc;">${escapeHtml(String(alert.thresholdAmount))}</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;">Public Key</td><td style="padding:6px 0;color:#f8fafc;word-break:break-all;">${escapeHtml(alert.publicKey)}</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;">Detected At</td><td style="padding:6px 0;color:#f8fafc;">${escapeHtml(alert.checkedAt)}</td></tr>
      </table>
    `,
  );

  return { subject, text, html };
}

export function renderSystemAlert(input: SystemAlertTemplateInput): AlertEmailContent {
  const severityLabel = input.severity.toUpperCase();
  const subject = `[AnchorPoint] [${severityLabel}] ${input.metric}`;
  const detectedAt = input.detectedAt ?? new Date().toISOString();

  const detailLines = [
    `Severity: ${severityLabel}`,
    `Metric: ${input.metric}`,
    `Message: ${input.message}`,
    input.value !== undefined ? `Value: ${input.value}` : null,
    input.threshold !== undefined ? `Threshold: ${input.threshold}` : null,
    input.window ? `Window: ${input.window}` : null,
    `Detected At: ${detectedAt}`,
  ].filter((line): line is string => line !== null);

  const text = ['AnchorPoint System Alert', '', ...detailLines].join('\n');

  const detailRows = detailLines
    .map((line) => {
      const [label, ...rest] = line.split(': ');
      const value = rest.join(': ');
      return `<tr><td style="padding:6px 0;color:#94a3b8;width:160px;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#f8fafc;">${escapeHtml(value)}</td></tr>`;
    })
    .join('');

  const html = wrapAlertHtml(
    input.metric,
    input.severity,
    `
      <p style="margin:0 0 16px;color:#cbd5e1;">${escapeHtml(input.message)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;">
        ${detailRows}
      </table>
    `,
  );

  return { subject, text, html };
}
