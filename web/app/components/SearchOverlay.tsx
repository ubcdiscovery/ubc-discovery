import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { api, type ApiEvent } from "~/lib/api";
import { fmtMonth, fmtDate02 } from "~/lib/date";

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchOverlay({ isOpen, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setResults([]);
      setHasSearched(false);
      setActiveIndex(-1);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Debounced search with request cancellation
  useEffect(() => {
    if (!isOpen) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    const abortController = new AbortController();

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.events.search(term);
        // Only update if this request wasn't cancelled
        if (!abortController.signal.aborted) {
          setResults(data.events);
          setHasSearched(true);
          setActiveIndex(-1);
        }
      } catch {
        if (!abortController.signal.aborted) {
          setResults([]);
          setHasSearched(true);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [query, isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, -1));
      } else if (
        e.key === "Enter" &&
        activeIndex >= 0 &&
        results[activeIndex]
      ) {
        onClose();
        navigate(`/events/${results[activeIndex].id}`);
      }
    },
    [onClose, results, activeIndex, navigate],
  );

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        overlayRef.current &&
        !overlayRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-ink/20 backdrop-blur-[2px]">
      <div
        ref={overlayRef}
        className="w-full md:max-w-[600px] md:mx-auto md:mt-16"
      >
        {/* Search input */}
        <div className="bg-bg border-2 border-ink">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="font-mono text-accent text-lg shrink-0">⌕</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search events, clubs, locations…"
              className="flex-1 bg-transparent font-mono text-[13px] text-ink placeholder:text-muted tracking-wide outline-none"
            />
            {loading && (
              <span className="font-mono text-[10px] text-muted tracking-wider uppercase animate-pulse">
                …
              </span>
            )}
            <button
              onClick={onClose}
              className="font-mono text-[10px] text-muted tracking-wider uppercase px-2 py-1 border border-rule-soft hover:border-ink hover:text-ink transition-colors cursor-pointer"
            >
              ESC
            </button>
          </div>
        </div>

        {/* Results dropdown */}
        {(results.length > 0 || (hasSearched && query.trim().length >= 2)) && (
          <div className="bg-bg border-2 border-t-0 border-ink max-h-[400px] overflow-y-auto">
            {results.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="font-mono text-[11px] text-muted tracking-wider uppercase">
                  No events found for "{query.trim()}"
                </p>
              </div>
            ) : (
              results.map((event, i) => {
                const d = event.event_date ? new Date(event.event_date) : null;
                return (
                  <button
                    key={event.id}
                    onClick={() => {
                      onClose();
                      navigate(`/events/${event.id}`);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-rule-soft last:border-b-0 cursor-pointer transition-colors ${
                      i === activeIndex
                        ? "bg-accent-soft"
                        : "hover:bg-accent-soft"
                    }`}
                  >
                    {/* Date chip */}
                    <div className="w-10 shrink-0 pt-0.5 text-center">
                      {d ? (
                        <>
                          <div className="font-mono text-[9px] text-muted tracking-wider uppercase leading-none">
                            {fmtMonth(d)}
                          </div>
                          <div className="font-display font-bold text-lg text-ink leading-tight tabular-nums">
                            {fmtDate02(d)}
                          </div>
                        </>
                      ) : (
                        <div className="font-mono text-[9px] text-muted tracking-wider uppercase">
                          TBD
                        </div>
                      )}
                    </div>

                    {/* Event info */}
                    <div className="min-w-0 flex-1">
                      <div className="font-display font-bold text-[14px] text-ink tracking-tight leading-tight truncate">
                        {event.title}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {event.club_name && (
                          <span className="font-mono text-[10px] text-muted tracking-wide truncate">
                            {event.club_name}
                          </span>
                        )}
                        {event.club_name && (
                          <span className="text-rule-soft">·</span>
                        )}
                        <span className="font-mono text-[10px] text-muted tracking-wide truncate">
                          {event.location_name}
                        </span>
                      </div>
                    </div>

                    {/* Arrow */}
                    <span className="font-mono text-accent text-sm shrink-0 pt-1">
                      →
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
