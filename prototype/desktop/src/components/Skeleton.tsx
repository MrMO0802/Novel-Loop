import type { CSSProperties } from 'react';

export interface SkeletonProps {
  className?: string;
  height?: CSSProperties['height'];
  width?: CSSProperties['width'];
}

export function Skeleton({ className, height = '1em', width = '100%' }: SkeletonProps) {
  const classes = ['nl-skeleton', className].filter(Boolean).join(' ');

  return <span aria-hidden="true" className={classes} style={{ height, width }} />;
}
