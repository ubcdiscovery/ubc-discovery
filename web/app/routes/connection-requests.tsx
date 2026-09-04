import { useEffect, useState } from "react";
import { ApiError, api, type ConnectRequest } from "~/lib/api";
import { useAuth } from "~/lib/auth";

function RequestRow({
  req,
  onAccepted,
  onRemoved,
}: {
  req: ConnectRequest;
  onAccepted?: (id: string) => void;
  onRemoved?: (id: string) => void;
}) {
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAccept() {
    setAcceptLoading(true);
    setError("");
    try {
      await api.connectionRequests.accept(req.id);
      onAccepted?.(req.id);
    } catch (err) {
      setError(err instanceof ApiError ? `Error ${err.status}: ${err.message}` : String(err));
    } finally {
      setAcceptLoading(false);
    }
  }

  async function handleRemove() {
    setRemoveLoading(true);
    setError("");
    try {
      await api.connectionRequests.remove(req.id);
      onRemoved?.(req.id);
    } catch (err) {
      setError(err instanceof ApiError ? `Error ${err.status}: ${err.message}` : String(err));
    } finally {
      setRemoveLoading(false);
    }
  }

  const busy = acceptLoading || removeLoading;

  return (
    <div className="flex items-center justify-between border-b border-rule-soft py-3">
      <div>
        <div className="font-display font-bold text-sm text-ink">{req.preferred_name}</div>
        <div className="font-mono text-xs text-muted mt-0.5">
          {new Date(req.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {error && <span className="font-mono text-xs text-red-500">{error}</span>}
        {onRemoved && (
          <button
            onClick={handleRemove}
            disabled={busy}
            className="font-mono text-xs tracking-wider uppercase px-3 py-1.5 border border-rule-soft cursor-pointer disabled:opacity-50 hover:border-red-400 hover:text-red-500"
          >
            {removeLoading ? "···" : onAccepted ? "Decline" : "Cancel"}
          </button>
        )}
        {onAccepted && (
          <button
            onClick={handleAccept}
            disabled={busy}
            className="border border-accent bg-accent text-on-color font-mono text-xs font-bold tracking-wider uppercase px-3 py-1.5 cursor-pointer disabled:opacity-50"
          >
            {acceptLoading ? "···" : "Accept"}
          </button>
        )}
      </div>
    </div>
  );
}

function SendRequestForm({ onSent }: { onSent: (req: ConnectRequest) => void; }) {
  const [uuid, setUuid] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!uuid.trim()) return;
    setStatus("sending");
    setErrorMsg("");
    try {
      const req = await api.connectionRequests.send(uuid.trim());
      onSent(req);
      setUuid("");
      setStatus("sent");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409 && err.message.includes("Connection already exists")) setErrorMsg("You're already connected with this user.");
        else if (err.status === 409) setErrorMsg("You already have a pending request with this user.");
        else if (err.status === 404) setErrorMsg("No user found with that ID.");
        else if (err.status === 400) setErrorMsg("You can't send a request to yourself.");
        else setErrorMsg("Something went wrong. Try again.");
      } else {
        setErrorMsg("Something went wrong. Try again.");
      }
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 mb-7">
      <div className="font-mono text-xs text-muted tracking-wider uppercase mb-1">Send request by UUID</div>
      <div className="flex gap-2">
        <input
          value={uuid}
          onChange={(e) => setUuid(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className="flex-1 border border-rule-soft bg-transparent font-mono text-xs text-ink px-2.5 py-2 placeholder:text-muted focus:outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={status === "sending" || !uuid.trim()}
          className="border border-accent bg-accent text-on-color font-mono text-xs font-bold tracking-wider uppercase px-3 py-2 cursor-pointer disabled:opacity-50"
        >
          {status === "sending" ? "···" : status === "sent" ? "Sent!" : "Send"}
        </button>
      </div>
      {status === "error" && (
        <div className="font-mono text-xs text-red-500">{errorMsg}</div>
      )}
    </form>
  );
}

function ConnectionRequestsInner() {
  const [inbound, setInbound] = useState<ConnectRequest[]>([]);
  const [outbound, setOutbound] = useState<ConnectRequest[]>([]);
  const [tab, setTab] = useState<"inbound" | "outbound">("inbound");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    Promise.all([api.connectionRequests.inbound(), api.connectionRequests.outbound()])
      .then(([i, o]) => {
        setInbound(i);
        setOutbound(o);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? `Error ${err.status}: ${err.message}` : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const items = tab === "inbound" ? inbound : outbound;

  return (
    <div className="max-w-lg mx-auto px-4.5 pt-6">
      <h1 className="font-display font-extrabold text-3xl tracking-tight text-ink mb-5">
        Connection Requests
      </h1>

      <SendRequestForm onSent={(req) => { setOutbound((prev) => [req, ...prev]); setTab("outbound"); }} />

      <div className="flex border-b-2 border-ink mb-5">
        {(["inbound", "outbound"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`font-mono text-xs font-bold tracking-wider uppercase px-4 py-2 cursor-pointer border-none bg-transparent ${
              tab === t ? "text-ink border-b-2 border-accent -mb-0.5" : "text-muted"
            }`}
          >
            {t} {t === "inbound" ? `(${inbound.length})` : `(${outbound.length})`}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="font-mono text-xs text-red-500 mb-4">{loadError}</div>
      )}

      {loading ? (
        <div className="font-mono text-xs text-muted tracking-wider uppercase py-10 text-center">
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="font-mono text-xs text-muted tracking-wider uppercase py-10 text-center">
          No {tab} requests
        </div>
      ) : (
        items.map((req) => (
          <RequestRow
            key={req.id}
            req={req}
            onAccepted={tab === "inbound" ? (id) => setInbound((prev) => prev.filter((r) => r.id !== id)) : undefined}
            onRemoved={tab === "inbound"
              ? (id) => setInbound((prev) => prev.filter((r) => r.id !== id))
              : (id) => setOutbound((prev) => prev.filter((r) => r.id !== id))
            }
          />
        ))
      )}
    </div>
  );
}

export default function ConnectionRequests() {
  const { state: authState } = useAuth();

  if (authState.status !== "member") {
    return (
      <div className="max-w-lg mx-auto px-4.5 pt-6 font-mono text-xs text-muted tracking-wider uppercase">
        Sign in to view connection requests.
      </div>
    );
  }

  return <ConnectionRequestsInner />;
}
