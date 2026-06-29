import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings,
  LogOut,
  ChevronDown,
  Shield,
  Bell,
  HelpCircle,
  Copy,
  Check,
} from 'lucide-react';

interface UserAvatarDropdownProps {
  /** Display name shown in the avatar and dropdown header */
  displayName?: string;
  /** Email or sub-label shown under the display name */
  email?: string;
  /** Role badge label */
  role?: string;
  /** Callback when "Settings" is selected */
  onSettings?: () => void;
  /** Callback when "Notifications" is selected */
  onNotifications?: () => void;
  /** Callback when "Sign Out" is selected */
  onSignOut?: () => void;
}

/** Derive initials from a display name (up to 2 characters). */
const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Deterministic gradient colour based on name string. */
const getAvatarGradient = (name: string): string => {
  const gradients = [
    'from-blue-500 to-violet-600',
    'from-teal-500 to-cyan-600',
    'from-amber-500 to-orange-600',
    'from-rose-500 to-pink-600',
    'from-emerald-500 to-green-600',
    'from-indigo-500 to-purple-600',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return gradients[Math.abs(hash) % gradients.length];
};

export const UserAvatarDropdown: React.FC<UserAvatarDropdownProps> = ({
  displayName = 'Institutional Admin',
  email = 'admin@anchorpoint.local',
  role = 'Admin',
  onSettings,
  onNotifications,
  onSignOut,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const initials = getInitials(displayName);
  const gradient = getAvatarGradient(displayName);

  /* Close on outside click */
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  /* Close on Escape */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  const handleAction = (cb?: () => void) => {
    setIsOpen(false);
    cb?.();
  };

  const menuItems = [
    {
      id: 'settings',
      icon: Settings,
      label: 'Account Settings',
      description: 'Manage preferences',
      onClick: () => handleAction(onSettings),
    },
    {
      id: 'notifications',
      icon: Bell,
      label: 'Notifications',
      description: 'View alerts & events',
      onClick: () => handleAction(onNotifications),
    },
    {
      id: 'kyc',
      icon: Shield,
      label: 'KYC / Compliance',
      description: 'Verification status',
      onClick: () => handleAction(),
    },
    {
      id: 'help',
      icon: HelpCircle,
      label: 'Help & Support',
      description: 'Docs & contact',
      onClick: () => handleAction(),
    },
  ];

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger button */}
      <button
        id="user-avatar-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls="user-avatar-dropdown"
        aria-label={`User menu for ${displayName}`}
        className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 transition-all hover:bg-slate-800 hover:border-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {/* Avatar circle */}
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-xs font-bold text-white shadow-inner select-none`}
          aria-hidden="true"
        >
          {initials}
        </span>

        {/* Name - hidden on small screens */}
        <span className="hidden text-sm font-medium text-slate-200 sm:block max-w-[120px] truncate">
          {displayName}
        </span>

        {/* Animated chevron */}
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="hidden sm:block"
          aria-hidden="true"
        >
          <ChevronDown size={14} className="text-slate-400" />
        </motion.span>
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            id="user-avatar-dropdown"
            role="menu"
            aria-label="User account menu"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute right-0 z-50 mt-2 w-72 origin-top-right rounded-xl border border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-md"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-slate-800 p-4">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-sm font-bold text-white shadow-lg select-none`}
                aria-hidden="true"
              >
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-100">{displayName}</p>
                <button
                  onClick={copyEmail}
                  title="Copy email address"
                  className="group mt-0.5 flex items-center gap-1 text-xs text-slate-500 transition-colors hover:text-slate-300 focus-visible:outline-none"
                  aria-label={copied ? 'Email copied' : `Copy email: ${email}`}
                >
                  <span className="truncate">{email}</span>
                  {copied ? (
                    <Check size={11} className="shrink-0 text-emerald-400" aria-hidden="true" />
                  ) : (
                    <Copy
                      size={11}
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </div>
              {/* Role badge */}
              <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                {role}
              </span>
            </div>

            {/* Menu items */}
            <div className="p-2" role="none">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  id={`user-menu-item-${item.id}`}
                  role="menuitem"
                  onClick={item.onClick}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-800 transition-colors group-hover:border-primary/30 group-hover:bg-primary/10">
                    <item.icon
                      size={15}
                      className="text-slate-400 transition-colors group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-200">{item.label}</span>
                    <span className="block text-xs text-slate-500">{item.description}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* Divider + Sign out */}
            <div className="border-t border-slate-800 p-2">
              <button
                id="user-menu-item-signout"
                role="menuitem"
                onClick={() => handleAction(onSignOut)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 group"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-800 transition-colors group-hover:border-red-500/30 group-hover:bg-red-500/10">
                  <LogOut
                    size={15}
                    className="text-slate-400 transition-colors group-hover:text-red-400"
                    aria-hidden="true"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-200 group-hover:text-red-300 transition-colors">
                    Sign Out
                  </span>
                  <span className="block text-xs text-slate-500">End your session</span>
                </span>
              </button>
            </div>

            {/* Footer version pill */}
            <div className="flex justify-center border-t border-slate-800/50 py-2">
              <span className="text-[10px] text-slate-600 select-none">AnchorPoint · v1.0.0</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
