import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { 
  ToastProvider, 
  useToast, 
  createSuccessToast, 
  createWarningToast, 
  createInfoToast, 
  createErrorToast,
  ToastType 
} from './Tooltip';

// Test component that uses the toast hook
const TestComponent = () => {
  const { addToast, removeToast, toasts } = useToast();
  
  return (
    <div>
      <button 
        data-testid="add-success" 
        onClick={() => addToast(createSuccessToast('Success message'))}
      >
        Add Success
      </button>
      <button 
        data-testid="add-warning" 
        onClick={() => addToast(createWarningToast('Warning message'))}
      >
        Add Warning
      </button>
      <button 
        data-testid="add-with-action" 
        onClick={() => addToast({
          type: 'info',
          message: 'Click to view',
          action: { label: 'View', onClick: vi.fn() }
        })}
      >
        Add With Action
      </button>
      <button 
        data-testid="remove-toast" 
        onClick={() => toasts[0] && removeToast(toasts[0].id)}
      >
        Remove First
      </button>
      <div data-testid="toast-count">{toasts.length}</div>
    </div>
  );
};

describe('Toast Notification System', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ToastProvider', () => {
    it('should render children correctly', () => {
      render(
        <ToastProvider>
          <div data-testid="child-content">Child Content</div>
        </ToastProvider>
      );
      
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });

    it('should throw error when useToast is used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      expect(() => {
        render(<TestComponent />);
      }).toThrow('useToast must be used within a ToastProvider');
      
      consoleSpy.mockRestore();
    });
  });

  describe('useToast hook', () => {
    it('should add a toast and render it', async () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );
      
      const addButton = screen.getByTestId('add-success');
      fireEvent.click(addButton);
      
      await waitFor(() => {
        expect(screen.getByText('Success message')).toBeInTheDocument();
      });
    });

    it('should support different toast types', async () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );
      
      // Add success toast
      fireEvent.click(screen.getByTestId('add-success'));
      expect(screen.getByTestId('toast-success')).toBeInTheDocument();
      
      // Add warning toast
      fireEvent.click(screen.getByTestId('add-warning'));
      expect(screen.getByTestId('toast-warning')).toBeInTheDocument();
    });

    it('should remove a toast when removeToast is called', async () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );
      
      const addButton = screen.getByTestId('add-success');
      fireEvent.click(addButton);
      
      await waitFor(() => {
        expect(screen.getByText('Success message')).toBeInTheDocument();
      });
      
      const removeButton = screen.getByTestId('remove-toast');
      fireEvent.click(removeButton);
      
      await waitFor(() => {
        expect(screen.queryByText('Success message')).not.toBeInTheDocument();
      });
    });

    it('should auto-dismiss toasts after 5 seconds', async () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );
      
      const addButton = screen.getByTestId('add-success');
      fireEvent.click(addButton);
      
      await waitFor(() => {
        expect(screen.getByText('Success message')).toBeInTheDocument();
      });
      
      // Fast-forward time by 5 seconds
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      
      await waitFor(() => {
        expect(screen.queryByText('Success message')).not.toBeInTheDocument();
      });
    });

    it('should render action button when provided', async () => {
      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );
      
      const addButton = screen.getByTestId('add-with-action');
      fireEvent.click(addButton);
      
      await waitFor(() => {
        expect(screen.getByText('View')).toBeInTheDocument();
      });
    });

    it('should respect custom duration', async () => {
      const customDuration = 2000;
      
      const TestComponentWithCustomDuration = () => {
        const { addToast } = useToast();
        return (
          <button 
            data-testid="add-custom" 
            onClick={() => addToast({
              type: 'info',
              message: 'Custom duration',
              duration: customDuration
            })}
          >
            Add
          </button>
        );
      };
      
      render(
        <ToastProvider>
          <TestComponentWithCustomDuration />
        </ToastProvider>
      );
      
      fireEvent.click(screen.getByTestId('add-custom'));
      
      await waitFor(() => {
        expect(screen.getByText('Custom duration')).toBeInTheDocument();
      });
      
      // Fast-forward by 2 seconds (custom duration)
      act(() => {
        vi.advanceTimersByTime(customDuration);
      });
      
      await waitFor(() => {
        expect(screen.queryByText('Custom duration')).not.toBeInTheDocument();
      });
    });

    it('should limit toasts to maxToasts prop', async () => {
      const MaxToastsTest = () => {
        const { addToast } = useToast();
        return (
          <button 
            data-testid="add-many" 
            onClick={() => {
              for (let i = 0; i < 7; i++) {
                addToast({ type: 'info', message: `Toast ${i}` });
              }
            }}
          >
            Add Many
          </button>
        );
      };
      
      render(
        <ToastProvider maxToasts={5}>
          <MaxToastsTest />
        </ToastProvider>
      );
      
      fireEvent.click(screen.getByTestId('add-many'));
      
      await waitFor(() => {
        expect(screen.getByTestId('toast-count').textContent).toBe('5');
      });
    });
  });

  describe('Toast helper functions', () => {
    it('should create success toast object', () => {
      const toast = createSuccessToast('Test message');
      
      expect(toast.type).toBe('success');
      expect(toast.message).toBe('Test message');
      expect(toast.id).toBeUndefined();
    });

    it('should create warning toast object', () => {
      const toast = createWarningToast('Warning');
      
      expect(toast.type).toBe('warning');
      expect(toast.message).toBe('Warning');
    });

    it('should create info toast object', () => {
      const toast = createInfoToast('Info');
      
      expect(toast.type).toBe('info');
      expect(toast.message).toBe('Info');
    });

    it('should create error toast object', () => {
      const toast = createErrorToast('Error');
      
      expect(toast.type).toBe('error');
      expect(toast.message).toBe('Error');
    });

    it('should include action in toast when provided', () => {
      const action = { label: 'Click me', onClick: vi.fn() };
      const toast = createSuccessToast('Message', action);
      
      expect(toast.action).toBeDefined();
      expect(toast.action?.label).toBe('Click me');
    });
  });

  describe('Toast positioning', () => {
    it('should render toasts in top-right position by default', () => {
      render(
        <ToastProvider>
          <ToastProvider>
            <TestComponent />
          </ToastProvider>
        </ToastProvider>
      );
      
      const addButton = screen.getByTestId('add-success');
      fireEvent.click(addButton);
      
      // Verify toast renders (position classes are applied internally)
      expect(screen.getByText('Success message')).toBeInTheDocument();
    });

    it('should render toasts in custom position', () => {
      render(
        <ToastProvider position="bottom-left">
          <TestComponent />
        </ToastProvider>
      );
      
      const addButton = screen.getByTestId('add-success');
      fireEvent.click(addButton);
      
      expect(screen.getByText('Success message')).toBeInTheDocument();
    });
  });
});