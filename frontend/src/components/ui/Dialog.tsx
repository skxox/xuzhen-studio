import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';

export function Dialog({ open, title, description, onClose, children, footer }: {
  open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('dialog-open');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('dialog-open'); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <header className="dialog__header"><div><h2 id="dialog-title">{title}</h2>{description && <p>{description}</p>}</div>
        <IconButton label="关闭" onClick={onClose}><X size={17} /></IconButton>
      </header>
      <div className="dialog__body">{children}</div>
      {footer && <footer className="dialog__footer">{footer}</footer>}
    </section>
  </div>;
}
