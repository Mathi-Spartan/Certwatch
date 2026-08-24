import { useEffect } from 'react';

export default function Modal({ title, sub, children, footer, onClose, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="modal-bg on" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 680 } : undefined} role="dialog" aria-modal="true">
        <div className="modal-hd"><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
        <div className="modal-bd">{children}</div>
        {footer && <div className="modal-ft">{footer}</div>}
      </div>
    </div>
  );
}
