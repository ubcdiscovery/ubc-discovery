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
  const dialogRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    setQuery("");
    setResults([]);
    setHasSearched(false);
    setActiveIndex(-1);
    const focusFrame = requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => previouslyFocused?.focus());
    };
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

  const handleDialogKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  const handleComboboxKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
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
        e.preventDefault();
        onClose();
        navigate(`/events/${results[activeIndex].id}`);
      }
    },
    [onClose, results, activeIndex, navigate],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/20 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="search-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-search-title"
        className="w-full sm:max-w-[600px] sm:mx-auto sm:mt-16"
        onKeyDown={handleDialogKeyDown}
      >
        <h2 id="event-search-title" className="sr-only">
          Search events
        </h2>
        {/* Search input */}
        <div className="bg-bg border-2 border-ink">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="font-mono text-accent text-lg shrink-0">⌕</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleComboboxKeyDown}
              placeholder="Search events, clubs, locations…"
              className="flex-1 bg-transparent font-mono text-[13px] text-ink placeholder:text-muted tracking-wide outline-none"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="event-search-results"
              aria-expanded={results.length > 0}
              aria-activedescendant={
                activeIndex >= 0
                  ? `event-search-result-${results[activeIndex]?.id}`
                  : undefined
              }
            />
            {loading && (
              <span className="font-mono text-[10px] text-muted tracking-wider uppercase animate-pulse">
                …
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-11 min-w-11 items-center justify-center border border-rule-soft px-2 font-mono text-[10px] text-muted tracking-wider uppercase hover:border-ink hover:text-ink transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label="Close search"
            >
              ESC
            </button>
          </div>
        </div>

        {/* Results dropdown */}
        {(results.length > 0 || (hasSearched && query.trim().length >= 2)) && (
          <div
            id="event-search-results"
            role="listbox"
            aria-label="Event search results"
            className="bg-bg border-2 border-t-0 border-ink max-h-[400px] overflow-y-auto"
          >
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
                    id={`event-search-result-${event.id}`}
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
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
