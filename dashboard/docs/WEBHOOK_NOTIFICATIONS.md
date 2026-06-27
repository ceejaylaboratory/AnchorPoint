# Webhook Event Notifications UI

## Overview

This document describes the webhook event notifications feature implemented in the AnchorPoint dashboard. This feature allows users to view and manage webhook events and transaction notifications through a comprehensive UI.

## Components

### 1. NotificationBell

A header component that displays a notification bell icon with an unread count badge.

**Features:**
- Real-time unread notification count
- Dropdown preview of recent notifications (last 5)
- Auto-polling every 30 seconds for new notifications
- Click-outside to close dropdown
- "View All" button to navigate to full notification center

**Props:**
- `apiBaseUrl` (optional): API base URL, defaults to `http://localhost:3002`
- `onViewAll` (optional): Callback when "View All" is clicked

**Usage:**
```tsx
import { NotificationBell } from './components/NotificationBell';

<NotificationBell
  apiBaseUrl="http://localhost:3002"
  onViewAll={() => setActiveTab('notifications')}
/>
```

### 2. NotificationCenter

A full-page notification management interface.

**Features:**
- Statistics dashboard (Total, Sent, Pending, Failed)
- Filter notifications by status (All, PENDING, SENT, FAILED)
- Refresh button to manually fetch latest notifications
- Link to notification preferences
- Detailed notification list with:
  - Status icons and badges
  - Message content
  - Notification type (EMAIL, SMS, PUSH)
  - Transaction ID (if applicable)
  - Relative timestamps

**Props:**
- `apiBaseUrl` (optional): API base URL
- `onOpenPreferences` (optional): Callback to open preferences panel

**Usage:**
```tsx
import NotificationCenter from './components/NotificationCenter';

<NotificationCenter
  apiBaseUrl="http://localhost:3002"
  onOpenPreferences={() => setActiveTab('notification-preferences')}
/>
```

### 3. NotificationPreferences

A settings panel for managing notification preferences.

**Features:**
- Toggle email notifications
- Toggle SMS notifications (with phone number input)
- Toggle push notifications
- Save preferences with success/error feedback
- Information card explaining webhook notifications

**Props:**
- `apiBaseUrl` (optional): API base URL

**Usage:**
```tsx
import NotificationPreferences from './components/NotificationPreferences';

<NotificationPreferences apiBaseUrl="http://localhost:3002" />
```

## API Integration

### Endpoints Used

1. **GET /api/notifications/history**
   - Fetches notification history (last 50 notifications)
   - Requires authentication token
   - Returns array of notification objects

2. **GET /api/notifications/preferences**
   - Fetches user's notification preferences
   - Returns: `{ emailEnabled, smsEnabled, pushEnabled, phone }`

3. **PATCH /api/notifications/preferences**
   - Updates user's notification preferences
   - Body: `{ emailEnabled?, smsEnabled?, pushEnabled?, phone? }`

### Authentication

All API requests require an authentication token stored in `localStorage` under the key `authToken`:

```typescript
const token = localStorage.getItem('authToken');
const response = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
```

## Data Models

### Notification Object

```typescript
interface Notification {
  id: string;
  userId: string;
  transactionId: string | null;
  type: 'EMAIL' | 'SMS' | 'PUSH';
  status: 'PENDING' | 'SENT' | 'FAILED';
  message: string;
  createdAt: string; // ISO 8601 timestamp
}
```

### Notification Preferences

```typescript
interface Preferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  phone?: string;
}
```

## Webhook Events

The system supports the following webhook events:

1. **transaction.status_changed**
   - Triggered when a transaction status changes
   - Includes transaction details and previous status
   - Delivered via configured notification channels

2. **KYC updates**
   - Verification status changes
   - Document approval/rejection

3. **Multisig transaction events**
   - New signature requests
   - Transaction approvals
   - Threshold reached notifications

## Styling

The components use Tailwind CSS with a dark theme consistent with the AnchorPoint dashboard:

- **Primary color**: Configurable via CSS variables (`--primary`)
- **Background**: Dark slate tones (`bg-slate-900`, `bg-slate-800`)
- **Borders**: Subtle slate borders (`border-slate-700`)
- **Text**: Light slate for readability (`text-slate-100`, `text-slate-400`)

### Status Colors

- **SENT**: Emerald (`text-emerald-400`, `bg-emerald-500/10`)
- **FAILED**: Red (`text-red-400`, `bg-red-500/10`)
- **PENDING**: Amber (`text-amber-400`, `bg-amber-500/10`)

## Accessibility

All components follow accessibility best practices:

- Semantic HTML elements
- ARIA labels and roles
- Keyboard navigation support
- Focus indicators
- Screen reader friendly
- Color contrast compliance

## Testing

### Manual QA Steps

1. **NotificationBell**
   - [ ] Bell icon displays in header
   - [ ] Unread count badge shows correct number
   - [ ] Clicking bell opens dropdown
   - [ ] Dropdown shows last 5 notifications
   - [ ] Clicking outside closes dropdown
   - [ ] "View All" navigates to notification center
   - [ ] Auto-polling updates notifications every 30s

2. **NotificationCenter**
   - [ ] Statistics cards show correct counts
   - [ ] Filter buttons work (All, PENDING, SENT, FAILED)
   - [ ] Refresh button fetches latest notifications
   - [ ] Notifications display with correct status icons
   - [ ] Timestamps format correctly (relative time)
   - [ ] Empty state shows when no notifications
   - [ ] Error state displays on API failure

3. **NotificationPreferences**
   - [ ] Toggles work for all notification types
   - [ ] Phone input appears when SMS enabled
   - [ ] Save button updates preferences
   - [ ] Success message displays after save
   - [ ] Error message displays on failure
   - [ ] Information card explains webhook notifications

### Integration Tests

```typescript
// Example test structure
describe('NotificationBell', () => {
  it('displays unread count badge', () => {
    // Test implementation
  });

  it('fetches notifications on open', () => {
    // Test implementation
  });

  it('polls for new notifications', () => {
    // Test implementation
  });
});
```

## Environment Variables

The dashboard uses the following environment variable:

- `VITE_API_BASE_URL`: Backend API base URL (default: `http://localhost:3002`)

Set in `.env` file:
```
VITE_API_BASE_URL=http://localhost:3002
```

## Storybook

All components have Storybook stories for isolated development and testing:

```bash
npm run storybook
```

Stories are located in `src/stories/`:
- `NotificationBell.stories.tsx`
- `NotificationCenter.stories.tsx`
- `NotificationPreferences.stories.tsx`

## Future Enhancements

1. **Real-time Updates**
   - WebSocket integration for instant notifications
   - Server-sent events (SSE) as alternative

2. **Advanced Filtering**
   - Date range filters
   - Transaction type filters
   - Search functionality

3. **Notification Actions**
   - Mark as read/unread
   - Delete notifications
   - Archive old notifications

4. **Rich Notifications**
   - Action buttons (e.g., "View Transaction")
   - Inline transaction details
   - Notification grouping

5. **Mobile Optimization**
   - Responsive design improvements
   - Touch-friendly interactions
   - Mobile-specific layouts

## Troubleshooting

### Notifications not loading

1. Check authentication token in localStorage
2. Verify API endpoint is accessible
3. Check browser console for errors
4. Verify CORS configuration on backend

### Preferences not saving

1. Ensure valid phone number format for SMS
2. Check network tab for API request/response
3. Verify authentication token is valid
4. Check backend logs for errors

### Polling not working

1. Check browser console for errors
2. Verify component is mounted
3. Check network tab for periodic requests
4. Ensure no JavaScript errors blocking execution

## Support

For issues or questions:
- Check backend logs: `backend/logs/`
- Review API documentation: `backend/docs/`
- Contact: support@anchorpoint.local
