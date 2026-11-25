import { useId, type ReactNode } from "react";

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  children(id: string): ReactNode;
}

/** A labelled control with optional hint and error text. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint === undefined ? null : <span className="field__hint">{hint}</span>}
      {error === undefined || error === null ? null : <span className="field__error">{error}</span>}
    </div>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: "text" | "password" | "date" | "month" | "number" | "search";
  hint?: string;
  error?: string | null;
  placeholder?: string;
  readOnly?: boolean;
  narrow?: boolean;
  mono?: boolean;
}

export function TextField(props: TextFieldProps) {
  const classes = ["input", props.narrow === true ? "input--narrow" : "", props.mono === true ? "mono" : "", props.error ? "input--invalid" : ""].filter((name) => name !== "").join(" ");
  return (
    <Field label={props.label} {...(props.hint === undefined ? {} : { hint: props.hint })} error={props.error ?? null}>
      {(id) => (
        <input
          id={id}
          className={classes}
          type={props.type ?? "text"}
          value={props.value}
          readOnly={props.readOnly === true}
          aria-invalid={props.error ? true : undefined}
          {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange(value: string): void;
  hint?: string;
  disabled?: boolean;
}

export function SelectField(props: SelectFieldProps) {
  return (
    <Field label={props.label} {...(props.hint === undefined ? {} : { hint: props.hint })}>
      {(id) => (
        <select id={id} className="input" value={props.value} disabled={props.disabled === true} onChange={(event) => props.onChange(event.target.value)}>
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function CheckField({ checked, onChange, children, disabled }: { checked: boolean; onChange(checked: boolean): void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled === true} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
