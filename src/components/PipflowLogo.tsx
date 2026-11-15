import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';

interface PipflowLogoProps {
  variant?: 'main' | 'dashboard' | 'footer' | 'mobile';
  showWordmark?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
}

export function PipflowLogo({
  variant = 'main',
  showWordmark = true,
  size = 'md',
  onClick,
  className = '',
}: PipflowLogoProps) {
  const { config } = usePlatform();
  const [imgError, setImgError] = useState(false);

  const logoSrc =
    variant === 'dashboard'
      ? config.branding.dashboardLogoUrl
      : variant === 'footer'
        ? config.branding.footerLogoUrl
        : variant === 'mobile'
          ? config.branding.mobileLogoUrl
          : config.branding.mainLogoUrl;

  const boxDims = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-12 h-12' : 'w-10 h-10';
  const textSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';
  const appName = config.branding.appName || 'PIPFLOW';
  const firstHalf = appName.toUpperCase().startsWith('PIP') ? 'PIP' : appName.slice(0, Math.ceil(appName.length / 2));
  const secondHalf = appName.toUpperCase().startsWith('PIP') ? appName.slice(3) : appName.slice(Math.ceil(appName.length / 2));

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 select-none whitespace-nowrap shrink-0 cursor-pointer focus:outline-none ${className}`}
      aria-label={appName}
    >
      {!imgError && logoSrc ? (
        <img
          src={logoSrc}
          alt={`${appName} Logo`}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className={`${boxDims} rounded-full object-cover border border-emerald-500/40 bg-[#050b12] shrink-0`}
        />
      ) : (
        <span
          className={`${boxDims} rounded-lg bg-[#0d1829] border border-slate-700 flex items-center justify-center shrink-0`}
        >
          <svg viewBox="0 0 36 36" className="w-6 h-6" fill="none">
            <path
              d="M7 25 L14 16 L20 20 L28 10"
              stroke="#1b8fe6"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="7" cy="25" r="2.8" fill="#ef4444" />
            <path
              d="M23 10 H28 V15"
              stroke="#22c55e"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
      {showWordmark && (
        <span className={`font-display font-extrabold tracking-tight ${textSize} leading-none`}>
          <span className="text-slate-900 dark:text-white">{firstHalf}</span>
          <span style={{ color: 'var(--pf-primary, #1b8fe6)' }}>{secondHalf}</span>
        </span>
      )}
    </button>
  );
}
