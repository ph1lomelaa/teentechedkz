import React from 'react';

export type PageMaxWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface PageShellProps {
  children: React.ReactNode;
  maxWidth?: PageMaxWidth;
  className?: string;
}

const MAX_WIDTH_CLASSES: Record<PageMaxWidth, string> = {
  sm: 'max-w-2xl',
  md: 'max-w-3xl',
  lg: 'max-w-[1180px]',
  xl: 'max-w-5xl',
  full: 'w-full',
};

export const PageShell: React.FC<PageShellProps> = ({
  children,
  maxWidth = 'lg',
  className = '',
}) => {
  const maxWidthClass = MAX_WIDTH_CLASSES[maxWidth];

  return (
    <div className={`page-shell mx-auto w-full ${maxWidthClass} px-0 py-5 sm:px-5 sm:py-7 md:px-8 ${className}`}>
      {children}
    </div>
  );
};
