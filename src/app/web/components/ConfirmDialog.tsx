import { useEffect, useId, useRef, type ReactNode } from "react";
import { useT } from "../i18n";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onConfirm(): void;
  onCancel(): void;
}

/** Modal confirmation built on the dialog element. Native alert, confirm and prompt are not used anywhere. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  // One ID per dialog: a page may hold several, and each must be announced by its own title.
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (props.open && !dialog.open) {
      dialog.showModal();
    }
    if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={props.onCancel} onClose={props.onCancel}>
      <div className="dialog__body">
        <h2 id={titleId} className="heading">
          {props.title}
        </h2>
        {props.children}
        <div className="row">
          <button type="button" className={`button ${props.danger === true ? "button--danger-solid" : "button--primary"}`} disabled={props.disabled === true} onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
          <button type="button" className="button" onClick={props.onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
