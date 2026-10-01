import { AnimatePresence, motion } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { ComponentType } from 'react';
import type { UiConfig } from '../types';
import { LogoMark } from './LogoMark';

type SidebarMenuItem = {
  id: string;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  label: string;
};

type SidebarProps = {
  activeTab: string;
  loadingState: 'loading' | 'ready' | 'error';
  menuItems: SidebarMenuItem[];
  sidebarOpen: boolean;
  uiConfig: UiConfig;
  onClose: () => void;
  onSelect: (tabId: string) => void;
};

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof document !== 'undefined') {
      const stored = document.documentElement.getAttribute('data-theme');
      if (stored === 'light') return 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggle = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-slate-400 transition-all hover:bg-slate-900 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
    >
      {theme === 'dark' ? <Moon size={20} aria-hidden="true" /> : <Sun size={20} aria-hidden="true" />}
      <span className="font-medium">{theme === 'dark' ? 'Dark' : 'Light'} Mode</span>
    </button>
  );
}

export const Sidebar = ({
  activeTab,
  loadingState,
  menuItems,
  sidebarOpen,
  uiConfig,
  onClose,
  onSelect,
}: SidebarProps) => (
  <>
    <AnimatePresence>
      {sidebarOpen ? (
        <motion.button
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          aria-label="Close navigation menu overlay"
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm sm:hidden"
          onClick={onClose}
        />
      ) : null}
    </AnimatePresence>

    <motion.aside
      data-testid="sidebar"
      id="main-sidebar"
      role="complementary"
      aria-label="Main navigation"
      initial={false}
      animate={{ x: sidebarOpen ? 0 : '-100%' }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="fixed inset-y-0 left-0 z-50 w-[min(18rem,calc(100vw-2rem))] border-r border-slate-800 bg-card sm:relative sm:w-64 sm:translate-x-0"
    >
      <div className="p-5 sm:p-6">
        <div className="mb-8 flex items-center gap-3 sm:mb-10">
          <LogoMark uiConfig={uiConfig} />
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-bold tracking-tight">{uiConfig.brandName}</h1>
            <p className="truncate text-xs uppercase tracking-[0.2em] text-slate-400">Anchor dashboard</p>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          <ul className="m-0 list-none space-y-1 p-0">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => {
                      onSelect(item.id);
                      onClose();
                    }}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                      activeTab === item.id
                        ? 'border border-primary/40 bg-primary/10 text-primary-text'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    <Icon size={20} aria-hidden />
                    <span className="font-medium">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <div className="absolute bottom-0 w-full border-t border-slate-800 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-slate-800" aria-hidden="true" />
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium">Institutional Admin</p>
            <p className="truncate text-xs text-slate-400">
              {loadingState === 'ready'
                ? 'Backend config synced'
                : loadingState === 'error'
                  ? 'Using fallback config'
                  : 'Loading config'}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <ThemeToggle />
        </div>
      </div>
    </motion.aside>
  </>
);

export default Sidebar;
