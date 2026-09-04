import { useEffect, useState } from "react";
import { ApiError, api, type ConnectedUser } from "~/lib/api";
import { useAuth } from "~/lib/auth";

function ConnectionRow({
  user,
  onDisconnected,
}: {
  user: ConnectedUser;
  onDisconnected: (userId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleDisconnect() {
    setLoading(true);
    setError("");
    try {
      await api.connections.disconnect(user.user_id);
      onDisconnected(user.user_id);
    } catch (err) {
      setError(err instanceof ApiError ? `Error ${err.status}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center border-b border-rule-soft py-4">
      <div className="w-64 shrink-0">
        <div className="font-display font-bold text-sm text-ink truncate">{user.preferred_name}</div>
      </div>
      <div className="w-28 shrink-0 font-mono text-xs text-muted">
{new Date(user.connected_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </div>
      <div className="w-28 shrink-0 flex justify-end items-center gap-3">
        {error && <span className="font-mono text-xs text-red-500">{error}</span>}
        <button
          onClick={handleDisconnect}
          disabled={loading}
          className="font-mono text-xs tracking-wider uppercase px-3 py-1.5 border border-rule-soft cursor-pointer disabled:opacity-50 hover:border-red-400 hover:text-red-500"
        >
          {loading ? "···" : "Disconnect"}
        </button>
      </div>
    </div>
  );
}

function ConnectionsInner() {
  const [connections, setConnections] = useState<ConnectedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.connections
      .list()
      .then(setConnections)
      .catch((err) => setError(err instanceof ApiError ? `Error ${err.status}: ${err.message}` : String(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-lg mx-auto px-4.5 pt-6">
      <h1 className="font-display font-extrabold text-3xl tracking-tight text-ink mb-5 text-center">
        Connections
      </h1>

      {error && <div className="font-mono text-xs text-red-500 mb-4">{error}</div>}

      {loading ? (
        <div className="font-mono text-xs text-muted tracking-wider uppercase py-10 text-center">
          Loading…
        </div>
      ) : connections.length === 0 ? (
        <div className="font-mono text-xs text-muted tracking-wider uppercase py-10 text-center">
          No connections yet
        </div>
      ) : (
        connections.map((u) => (
          <ConnectionRow
            key={u.user_id}
            user={u}
            onDisconnected={(id) => setConnections((prev) => prev.filter((c) => c.user_id !== id))}
          />
        ))
      )}
    </div>
  );
}

export default function Connections() {
  const { state: authState } = useAuth();

  if (authState.status !== "member") {
    return (
      <div className="max-w-lg mx-auto px-4.5 pt-6 font-mono text-xs text-muted tracking-wider uppercase">
        Sign in to view connections.
      </div>
    );
  }

  return <ConnectionsInner />;
}
