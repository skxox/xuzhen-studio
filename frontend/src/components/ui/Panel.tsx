import type { HTMLAttributes, ReactNode } from 'react';

export function Panel({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section className={`panel ${className}`} {...props}>
      {children}
    </section>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading__actions">{actions}</div>}
    </header>
  );
}
