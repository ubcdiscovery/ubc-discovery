import { useEffect, useState } from "react";
import { ApiError, api, type EventRatingResponse } from "~/lib/api";
import type { AuthState } from "~/lib/auth";

export type RatingDraft = { stars: number; note: string; strong_vibes: string[] };

/** Public ratings for an event, the member's own rating, and the rating being drafted. */
export function useEventRatings(eventId: string, authStatus: AuthState["status"]) {
  const [allRatings, setAllRatings] = useState<EventRatingResponse[]>([]);
  const [myRating, setMyRating] = useState<EventRatingResponse | null | undefined>(undefined);
  const [ratingDraft, setRatingDraft] = useState<RatingDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ratingsAvailable, setRatingsAvailable] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    api.ratings
      .getAll(eventId)
      .then((ratings) => {
        setAllRatings(Array.isArray(ratings) ? ratings : []);
        setRatingsAvailable(true);
      })
      .catch((err) => {
        if (
          err instanceof ApiError &&
          (err.status === 400 || err.status === 403 || err.status === 404)
        ) {
          setRatingsAvailable(false);
        } else {
          setAllRatings([]);
          setRatingsAvailable(true);
        }
      });
  }, [eventId]);

  useEffect(() => {
    if (authStatus !== "member") return;
    api.ratings
      .get(eventId)
      .then(setMyRating)
      .catch(() => setMyRating(null));
  }, [eventId, authStatus]);

  async function submitRating() {
    if (!ratingDraft) return;
    setSubmitting(true);
    try {
      const result = await api.ratings.rate(eventId, ratingDraft);
      setMyRating(result);
      setAllRatings((prev) => [result, ...prev.filter((r) => r.user_id !== result.user_id)]);
      setRatingDraft(null);
    } finally {
      setSubmitting(false);
    }
  }

  return {
    allRatings,
    myRating,
    ratingsAvailable,
    ratingDraft,
    setRatingDraft,
    submitting,
    submitRating,
  };
}
