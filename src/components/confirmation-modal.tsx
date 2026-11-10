"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

type ConfirmationModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationModal({
  open,
  title,
  description,
  confirmLabel = "Подтвердить",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmationModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  onCancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return <div
    className="product-edit-backdrop confirmation-backdrop"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}
  >
    <section ref={dialogRef} className="panel confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmation-modal-title" aria-describedby="confirmation-modal-description" tabIndex={-1}>
      <div className="panel-head">
        <div className="confirmation-modal-heading"><AlertTriangle size={18} aria-hidden="true" /><h2 id="confirmation-modal-title">{title}</h2></div>
        <button type="button" className="icon-button" aria-label="Закрыть" onClick={onCancel} disabled={busy}><X size={15} /></button>
      </div>
      <div className="panel-body">
        <p id="confirmation-modal-description" className="confirmation-modal-copy">{description}</p>
        <div className="form-actions">
          <button ref={cancelRef} type="button" className="button secondary" onClick={onCancel} disabled={busy}>Отмена</button>
          <button type="button" className="button danger" onClick={onConfirm} disabled={busy}>{busy ? "Выполняем…" : confirmLabel}</button>
        </div>
      </div>
    </section>
  </div>;
}
