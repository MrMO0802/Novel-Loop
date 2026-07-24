import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: string;
  variant?: ButtonVariant;
}

export function Button({ children, className, type = 'button', variant = 'primary', ...props }: ButtonProps) {
  const classes = ['nl-button', `nl-button--${variant}`, className].filter(Boolean).join(' ');

  return <button className={classes} type={type} {...props}>{children}</button>;
}
