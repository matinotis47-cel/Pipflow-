import React from 'react';
import { Download, CheckCircle2, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();

  if (isInstalled) {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs font-semibold">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>App Installed</span>
      </div>
    );
  }

  if (canInstall) {
    return (
      <button
        type="button"
        onClick={() => void promptInstall()}
        className={
          compact
            ? 'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold transition-colors'
            : 'inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors'
        }
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Install PIPFLOW App (Android / Desktop)</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
        <Smartphone className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
        <span>
          Tap <strong>Share</strong> then <strong>Add to Home Screen</strong> to install PIPFLOW.
        </span>
      </div>
    );
  }

  return null;
}
