import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  requireTypingConfirm?: boolean;
  isDanger?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  requireTypingConfirm = false,
  isDanger = true,
}) => {
  const [typedConfirm, setTypedConfirm] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTypedConfirm('');
    }
  }, [isOpen]);

  const handleConfirm = () => {
    if (requireTypingConfirm && typedConfirm.toUpperCase() !== 'CONFIRM') {
      return;
    }
    onConfirm();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl z-10"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
          >
            {/* Close Button */}
            <button
              onClick={onCancel}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
              aria-label="Close confirmation dialog"
            >
              <X size={18} />
            </button>

            {/* Icon & Title */}
            <div className="flex items-start gap-4">
              <div
                className={`rounded-full p-3 shrink-0 ${
                  isDanger ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'
                }`}
              >
                <AlertTriangle size={24} />
              </div>
              <div className="space-y-1">
                <h3 id="confirm-modal-title" className="text-lg font-bold text-slate-100">
                  {title}
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
              </div>
            </div>

            {/* Typing Confirmation field if needed */}
            {requireTypingConfirm && (
              <div className="mt-5 space-y-2">
                <label
                  htmlFor="confirm-typing-input"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
                >
                  Type <span className="text-rose-400">CONFIRM</span> to proceed:
                </label>
                <input
                  id="confirm-typing-input"
                  type="text"
                  value={typedConfirm}
                  onChange={(e) => setTypedConfirm(e.target.value)}
                  placeholder="CONFIRM"
                  className="w-full input-field text-sm font-mono tracking-widest placeholder-slate-700"
                  autoComplete="off"
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="action-button rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={requireTypingConfirm && typedConfirm.toUpperCase() !== 'CONFIRM'}
                className={`action-button rounded-lg px-5 py-2 text-sm font-medium text-white disabled:opacity-30 ${
                  isDanger
                    ? 'bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/20'
                    : 'bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-600/20'
                }`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default ConfirmModal;
