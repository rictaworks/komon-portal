import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { ClientRef } from "../api/office-types";
import { useT } from "../i18n";
import { useSession } from "../session";
import { clientLabel, clientSearchPath, isComposing, isMoveKey, moveActive } from "./client-picker";
import { Icon } from "./Icon";
import { ErrorNotice } from "./Notice";
import { useLoad } from "./useLoad";

/** Clients listed at once. Typing narrows the list; it is never the whole client register. */
const RESULT_LIMIT = 20;
const SEARCH_DELAY_MS = 300;

/** The clients found for one request, kept with the request they answer. */
interface Found {
  path: string;
  items: ClientRef[];
}

export interface ClientPickerProps {
  label: string;
  value: ClientRef | null;
  onChange(client: ClientRef | null): void;
  /** What an empty picker means on this screen, for example "All clients". */
  emptyLabel: string;
  /** The status of the clients offered. Null offers clients of every status. Active when left out. */
  status?: ClientRef["status"] | null;
  /** Shown under the field in place of the general typing hint. */
  hint?: string;
  /** A fixed narrow width with the hint left to screen readers, for a row of filters. */
  compact?: boolean;
}

/**
 * Chooses one client by typing part of its code or name. The server does the search, so every client can be
 * reached however many there are. Arrow keys move through the list, Enter chooses, Escape closes.
 */
export function ClientPicker({ label, value, onChange, emptyLabel, status = "Active", hint, compact = false }: ClientPickerProps) {
  const t = useT();
  const { api } = useSession();
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  /** The text being typed, or null while the field shows the chosen client. */
  const [text, setText] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = (text ?? "").trim();
  const path = clientSearchPath({ search, status, limit: RESULT_LIMIT });
  /** True once the list is open and typing has paused: only then is the server asked. */
  const asking = open && typed === search;
  const found = useLoad<Found | null>(async () => (asking ? { path, items: (await api.get<{ items: ClientRef[] }>(path)).items } : null), [asking, path]);
  // Null while the answer for the typed text has not arrived, so clients of an earlier search are never offered under a new one.
  const answer = asking && found.data !== null && found.data.path === path ? found.data : null;
  const options = answer === null ? null : answer.items.slice(0, RESULT_LIMIT);
  const count = options === null ? null : options.length;
  const more = answer !== null && answer.items.length > RESULT_LIMIT;
  const failed = asking && !found.loading && found.error !== null;

  // Typing waits a moment so that each keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(typed), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);

  // A new list starts at its first client, so Enter takes the best match.
  useEffect(() => {
    setActive(count === null || count === 0 ? -1 : 0);
  }, [count, path]);

  useEffect(() => {
    if (active >= 0) {
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  const close = (): void => {
    setOpen(false);
    setText(null);
  };

  const choose = (client: ClientRef): void => {
    onChange(client);
    close();
  };

  const type = (next: string): void => {
    setText(next);
    setOpen(true);
    // Edited text no longer names the chosen client, so the choice is dropped rather than kept out of sight.
    if (value !== null) {
      onChange(null);
    }
  };

  const clear = (): void => {
    onChange(null);
    close();
    input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // A key pressed while Japanese text is being composed is the input method's, not the list's.
    if (isComposing(event.nativeEvent)) {
      return;
    }
    if (isMoveKey(event.key) && (event.key === "ArrowDown" || event.key === "ArrowUp" || open)) {
      event.preventDefault();
      if (!open) {
        setOpen(true);
      } else if (count !== null) {
        setActive(moveActive(event.key, active, count));
      }
    } else if (event.key === "Enter" && open) {
      // Enter belongs to the list while it is open; it never submits the surrounding form.
      event.preventDefault();
      const client = options?.[active];
      if (client !== undefined) {
        choose(client);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
      close();
    }
  };

  let note: string | null = null;
  if (open && !failed) {
    if (count === null) {
      note = t("office.clientPicker.searching");
    } else if (count === 0) {
      note = t("office.clientPicker.none");
    } else if (more) {
      note = t("office.clientPicker.more", { count });
    }
  }
  const announcement = note ?? (open && count !== null ? t("office.clientPicker.found", { count }) : "");

  return (
    <div className={`field picker${compact ? " picker--compact" : ""}`} onBlur={onBlur}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="picker__control">
        <input
          ref={input}
          id={id}
          className={`input picker__input${value === null ? "" : " picker__input--chosen"}`}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-describedby={hintId}
          {...(open && active >= 0 ? { "aria-activedescendant": `${listId}-${active}` } : {})}
          placeholder={emptyLabel}
          value={text ?? (value === null ? "" : clientLabel(value))}
          onChange={(event) => type(event.target.value)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {value === null ? null : (
          <button type="button" className="picker__clear" aria-label={t("office.clientPicker.clear")} onClick={clear}>
            <Icon icon={faXmark} />
          </button>
        )}
        <div className="picker__popup" hidden={!open}>
          <ul ref={list} id={listId} className="picker__list" role="listbox" aria-label={label} tabIndex={-1}>
            {(options ?? []).map((client, index) => (
              <li
                key={client.id}
                id={`${listId}-${index}`}
                className={`picker__option${index === active ? " picker__option--active" : ""}`}
                role="option"
                aria-selected={index === active}
                // Keeps the focus in the field, so choosing with the mouse does not close the list first.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(client)}
              >
                <span className="code">{client.code}</span>
                <span className="grow">{client.corporateName}</span>
                {client.status === "Active" ? null : <span className="muted">{t(`clientStatus.${client.status}`)}</span>}
              </li>
            ))}
          </ul>
          {note === null ? null : <p className="picker__note">{note}</p>}
          {failed ? <ErrorNotice error={found.error} /> : null}
        </div>
      </div>
      <span id={hintId} className={compact && hint === undefined ? "visually-hidden" : "field__hint"}>
        {hint ?? t("office.clientPicker.hint")}
      </span>
      <span className="visually-hidden" role="status">
        {announcement}
      </span>
    </div>
  );
}
