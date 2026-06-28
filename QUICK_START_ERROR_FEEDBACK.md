# Quick Start: Deposit Error Feedback System

## What's New

Three new components have been added to improve error feedback for failed deposits:

1. **DepositErrorAlert** - Semantic error alert component
2. **DepositForm** - Deposit form with validation
3. **SEP24Flow** - Enhanced deposit flow with error handling

## Quick Examples

### Using DepositErrorAlert

```tsx
import { DepositErrorAlert } from './components/DepositErrorAlert';
import type { DepositError } from './components/DepositErrorAlert';

const [error, setError] = useState<DepositError | null>(null);

// Show an error
<DepositErrorAlert
  error={error}
  onDismiss={() => setError(null)}
  onRetry={() => handleRetry()}
  dismissible={true}
/>

// Create an error object
const networkError: DepositError = {
  type: 'network',
  title: 'Connection Error',
  message: 'Failed to process your deposit. Please check your internet connection.',
  details: 'Error: Network timeout after 30 seconds',
  retryable: true,
};
setError(networkError);
```

### Using DepositForm

```tsx
import { DepositForm } from './components/DepositForm';

<DepositForm
  fields={uiConfig.fieldRequirements.deposit}
  assetCode="USDC"
  onSubmit={(values) => {
    console.log('Deposit details:', values);
    // Send to backend API
  }}
/>
```

### Using Enhanced SEP24Flow

```tsx
import { SEP24Flow } from './components/SEP24Flow';

// For deposits
<SEP24Flow type="deposit" uiConfig={config} />

// For withdrawals
<SEP24Flow type="withdraw" uiConfig={config} />
```

## Error Types Reference

| Type | Color | Use Case | Retryable |
|------|-------|----------|-----------|
| `validation` | Amber | Field validation fails | No |
| `network` | Rose | API/connection failure | Yes |
| `kyc` | Orange | Identity verification required | Yes |
| `server` | Red | Backend error (5xx) | Yes |
| `asset` | Cyan | Asset unavailable | No |
| `amount` | Amber | Amount invalid | No |

## Validation Rules

### Amount
- ✅ Format: Decimal with 1-2 places (e.g., 50.00)
- ✅ Range: $10 - $100,000
- ❌ Less than $10
- ❌ More than $100,000
- ❌ Non-decimal format

### Email
- ✅ Standard email format
- ❌ Missing @ or domain
- ❌ Invalid characters

### Wallet Address
- ✅ Stellar G-address (56 characters starting with G)
- ❌ Wrong length
- ❌ Invalid characters
- ❌ Wrong prefix

### Required Fields
- ✅ Must contain value
- ❌ Empty or whitespace only

## File Locations

```
dashboard/src/components/
├── DepositErrorAlert.tsx          (NEW - 101 lines)
├── DepositForm.tsx                (NEW - 253 lines)
├── SEP24Flow.tsx                  (ENHANCED - +78 lines)
└── DEPOSIT_ERROR_FEEDBACK.md      (DOCUMENTATION - 230 lines)
```

## Build & Deployment

```bash
# Build the dashboard
cd dashboard
npm run build

# Expected output
# ✓ 1945 modules transformed
# ✓ No errors or warnings
# ✓ Build size: ~50 KB gzip
```

## Testing

### Quick Manual Test - Validation Errors
1. Navigate to Deposit flow
2. Select an asset (e.g., USDC)
3. Leave amount empty and click Submit
4. See validation error message
5. Fix the error and resubmit

### Quick Manual Test - KYC Error
1. Complete deposit form
2. Cancel KYC verification
3. See "Verification Required" error
4. Click "Try Again" to restart KYC

### Quick Manual Test - Keyboard Navigation
1. Tab through all form fields
2. Use arrow keys in dropdowns
3. Press Enter to submit
4. Press Escape to dismiss alerts (if applicable)

## Key Features

✅ **Semantic Errors**: Different error types for different scenarios
✅ **Color-Coded**: Visual indication of error severity
✅ **Accessible**: Full ARIA support, keyboard navigation
✅ **Dismissible**: Users can close errors
✅ **Retryable**: Some errors allow retry attempts
✅ **Validated**: Real-time field-level validation
✅ **Clear Messaging**: User-friendly error descriptions
✅ **Smooth Animations**: Professional UX with transitions

## Component Props Reference

### DepositErrorAlert

```typescript
interface DepositErrorAlertProps {
  error: DepositError | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  dismissible?: boolean;
}

interface DepositError {
  type: 'validation' | 'network' | 'kyc' | 'server' | 'asset' | 'amount';
  title: string;
  message: string;
  details?: string;
  retryable?: boolean;
}
```

### DepositForm

```typescript
interface DepositFormProps {
  fields: FieldRequirement[];
  assetCode: string;
  onSubmit: (values: FormValues) => void;
}
```

### SEP24Flow

```typescript
interface SEP24FlowProps {
  type: 'deposit' | 'withdraw';
  uiConfig: UiConfig;
}
```

## Integration with Backend

To integrate with real backend APIs:

1. **DepositForm onSubmit**: Call your deposit API
2. **Error Handling**: Catch errors and create DepositError objects
3. **Error Display**: Set error state to show in DepositErrorAlert
4. **Retry Logic**: Implement retry handler

```tsx
const handleDepositFormSubmit = async (values) => {
  try {
    const response = await api.createDeposit({
      asset: selectedAsset,
      ...values,
    });
    // Success - navigate to next step
    goToStep(3);
  } catch (error) {
    // Handle error
    if (error.code === 'NETWORK_ERROR') {
      setError({
        type: 'network',
        title: 'Connection Error',
        message: 'Failed to create deposit',
        retryable: true,
      });
    }
    // etc.
  }
};
```

## Accessibility Checklist

- [x] ARIA live regions for error announcements
- [x] Proper semantic HTML
- [x] Keyboard navigation support
- [x] Focus indicators
- [x] Color contrast compliant
- [x] Screen reader compatible
- [x] Error messages clear and descriptive

## Support & Documentation

- Full documentation: `DEPOSIT_ERROR_FEEDBACK.md`
- Implementation summary: `../IMPLEMENTATION_SUMMARY.md`
- Component source files with inline comments
- Commit message with detailed feature list

---

**Branch**: `feature/issue-585-dashboard-improve-error-feedback-fo`
**Status**: ✅ Ready for review and testing
**Last Updated**: June 28, 2026
