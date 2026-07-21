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
  lg: 'max-w-4xl',
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
    <div className={`mx-auto w-full ${maxWidthClass} px-4 md:px-6 ${className}`}>
      {children}
    </div>
  );
};
