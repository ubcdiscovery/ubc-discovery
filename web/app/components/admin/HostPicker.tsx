import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { api, type AdminApiHost } from "~/lib/api";
import { normalizeHandle } from "~/lib/hosts";
import { Button } from "~/components/ui/Button";
import { Input } from "~/components/ui/Input";

/**
 * Ordered Instagram handles for an Event Listing's Hosts; the first is the main host.
 * Unknown handles are allowed: saving creates the Host.
 */
export function HostPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (handles: string[]) => void;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AdminApiHost[]>([]);

  useEffect(() => {
    const q = text.trim();
    if (!q) return setSuggestions([]);
    const timer = setTimeout(() => {
      api.admin.hosts
        .list(q, 0, 8)
        .then((page) => setSuggestions(page.hosts))
        .catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [text]);

  function add() {
    if (!text.trim()) return;
    const handle = normalizeHandle(text);
    if (!handle) return setError("Use an Instagram handle such as @ubcfilmsociety.");
    setError(null);
    setText("");
    if (!value.includes(handle)) onChange([...value, handle]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected hosts">
          {value.map((handle, index) => (
            <li
              key={handle}
              className="inline-flex items-center gap-1.5 border border-ink bg-surface px-2 py-1 font-mono text-xs text-ink"
            >
              @{handle}
              {index === 0 && value.length > 1 && <span className="text-muted">(main)</span>}
              <button
                type="button"
                onClick={() => onChange(value.filter((item) => item !== handle))}
                aria-label={`Remove @${handle}`}
                className="cursor-pointer text-muted hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          list={listId}
          value={text}
          placeholder="@handle or instagram.com/handle"
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          aria-invalid={error ? true : undefined}
        />
        <datalist id={listId}>
          {suggestions.map((host) => (
            <option key={host.handle} value={host.handle}>
              {host.name}
            </option>
          ))}
        </datalist>
        <Button size="sm" onClick={add}>
          Add
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
