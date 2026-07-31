import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { VibeTag } from "~/components/VibeTag";
import type { UserResponse } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { FACULTIES, VIBES, YEARS } from "~/lib/constants";
import { yearLabelToStanding, yearStandingToLabel } from "~/lib/onboarding";
import { useProfileEditor } from "~/lib/use-profile-editor";

const PROFILE_YEAR_OPTIONS = YEARS.flatMap((label) => {
  const value = yearLabelToStanding(label);
  return value === undefined ? [] : [{ label, value: String(value) }];
});
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-b border-rule-soft p-4.5 md:p-0">
      <h2 className="mb-3 border-b border-ink pb-1.5 font-mono text-xs uppercase tracking-wider text-muted">
        {label}
      </h2>
      {children}
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-dotted border-rule-soft py-2 font-mono text-xs tracking-wide text-ink">
      <span className="text-muted">{label}</span>
      <span className="font-bold">{value || "Not specified"}</span>
    </div>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-muted md:tracking-wider"
    >
      {children}
    </label>
  );
}

function formatMemberSince(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function MemberProfile({ user }: { user: UserResponse }) {
  const { uploadProfilePhoto } = useAuth();
  const editor = useProfileEditor(user);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const draft = editor.draft;
  const name = draft?.preferredName ?? user.preferred_name;
  const avatar = avatarPreview ?? user.profile_picture_url;
  const memberSince = formatMemberSince(user.created_at);

  async function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarPreview(URL.createObjectURL(file));
    setPhotoError("");
    try {
      await uploadProfilePhoto(file);
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : "Could not upload profile photo.");
    }
  }

  function cancelEditing() {
    editor.cancelEditing();
    setAvatarPreview(null);
    setPhotoError("");
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = await editor.saveProfile();
    if (next) setAvatarPreview(null);
  }

  return (
    <form onSubmit={submitProfile} className={draft ? "pb-24 md:pb-0" : undefined}>
      <div className="border-b-2 border-ink px-4.5 py-5 md:border-b md:px-8 md:pt-10 md:pb-8">
        <div className="mx-auto flex max-w-270 items-center gap-3.5 md:gap-7">
          <div className="relative shrink-0">
            <div
              className="flex size-19 items-center justify-center border-2 border-ink bg-linear-to-br from-avatar-start to-avatar-end bg-cover bg-center font-display text-3xl font-extrabold tracking-tight text-on-color md:size-33 md:text-6xl md:tracking-tighter"
              style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}
            >
              {!avatar && name[0]?.toUpperCase()}
            </div>
            {draft && (
              <>
                <button
                  type="button"
                  aria-label="Change profile photo"
                  onClick={() => fileRef.current?.click()}
                  className="absolute -right-1.5 -bottom-1.5 flex size-7 cursor-pointer items-center justify-center border-2 border-bg bg-ink p-0 text-bg md:-right-2.5 md:-bottom-2.5 md:size-auto md:gap-1.5 md:px-3 md:py-1.5"
                >
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect
                      x="1"
                      y="4"
                      width="14"
                      height="10"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                    <circle cx="8" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4" />
                    <rect x="5" y="2" width="6" height="2" fill="currentColor" />
                  </svg>
                  <span className="hidden font-mono text-xs font-bold uppercase tracking-wide md:inline">
                    Change
                  </span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={onPickFile}
                  className="hidden"
                />
              </>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {draft ? (
              <>
                <label
                  htmlFor="preferred-name"
                  className="sr-only font-mono text-xs uppercase tracking-wider text-muted md:not-sr-only md:mb-1.5 md:block"
                >
                  Preferred name
                </label>
                <input
                  id="preferred-name"
                  required
                  value={draft.preferredName}
                  onChange={(event) => editor.updateDraft({ preferredName: event.target.value })}
                  className="w-full border border-ink bg-surface p-3 font-display text-2xl font-bold tracking-tight text-ink outline-none"
                />
              </>
            ) : (
              <>
                <h1 className="font-display text-3xl leading-none font-extrabold tracking-tight text-ink md:text-6xl md:tracking-tighter">
                  {user.preferred_name}
                  <span className="hidden md:inline">.</span>
                </h1>
                <div className="mt-1.5 text-sm text-ink-soft md:mt-2 md:flex md:items-center md:gap-3.5">
                  <span>
                    {[user.major, yearStandingToLabel(user.year_standing)].filter(Boolean).join(" · ") ||
                      "Profile ready"}
                  </span>
                  <span className="hidden size-1 rounded-full bg-muted md:block" />
                  <span className="hidden font-mono text-xs tracking-wide text-muted md:block">
                    Member since {memberSince}
                  </span>
                </div>
              </>
            )}
          </div>

          {!draft && (
            <button
              type="button"
              aria-label="Edit profile"
              onClick={editor.beginEditing}
              className="shrink-0 cursor-pointer self-start border border-ink bg-transparent px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide text-ink md:mt-3.5 md:px-4 md:py-2.5"
            >
              <span className="md:hidden">Edit</span>
              <span className="hidden md:inline">Edit profile</span>
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-270 md:p-8 md:pb-14">
        <div className="md:grid md:grid-cols-2 md:gap-8">
          <Section label="Academic context">
            {draft ? (
              <div className="space-y-3 md:space-y-3.5">
                <div>
                  <FieldLabel htmlFor="profile-faculty">Faculty</FieldLabel>
                  <select
                    id="profile-faculty"
                    value={draft.faculty}
                    onChange={(event) => editor.updateDraft({ faculty: event.target.value })}
                    className="w-full cursor-pointer appearance-none border border-ink bg-surface px-3 py-2.5 font-body text-sm text-ink outline-none"
                  >
                    <option value="">Not specified</option>
                    {FACULTIES.map((faculty) => (
                      <option key={faculty}>{faculty}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel htmlFor="profile-major">Major or program</FieldLabel>
                  <input
                    id="profile-major"
                    value={draft.major}
                    onChange={(event) => editor.updateDraft({ major: event.target.value })}
                    className="w-full border border-ink bg-surface px-3 py-2.5 font-body text-sm text-ink outline-none"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="profile-year">Year</FieldLabel>
                  <select
                    id="profile-year"
                    value={draft.yearStanding}
                    onChange={(event) => editor.updateDraft({ yearStanding: event.target.value })}
                    className="w-full cursor-pointer appearance-none border border-ink bg-surface px-3 py-2.5 font-body text-sm text-ink outline-none"
                  >
                    <option value="">Not specified</option>
                    {PROFILE_YEAR_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <>
                <KV label="Faculty" value={user.faculty ?? ""} />
                <KV label="Major" value={user.major ?? ""} />
                <KV label="Year" value={yearStandingToLabel(user.year_standing)} />
              </>
            )}
          </Section>

          <Section label="Interests">
            {draft ? (
              <div className="flex flex-wrap gap-1.5">
                {VIBES.map((vibe) => (
                  <button
                    key={vibe.id}
                    type="button"
                    aria-pressed={draft.interests.includes(vibe.id)}
                    onClick={() => editor.toggleInterest(vibe.id)}
                    className="cursor-pointer border-none bg-transparent p-0"
                  >
                    <VibeTag vibe={vibe.id} active={draft.interests.includes(vibe.id)} />
                  </button>
                ))}
              </div>
            ) : user.interests?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {user.interests.map((vibe) => (
                  <VibeTag key={vibe} vibe={vibe} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No interests selected.</p>
            )}
          </Section>

          <Section label="Activity">
            <KV label="Member since" value={memberSince} />
          </Section>

          <Section label="Account">
            <KV label="Email" value={user.email} />
            <KV label="UBC verified" value={user.ubc_verified ? "Yes" : "No"} />
            {(editor.error || photoError) && (
              <p role="alert" className="mt-2 font-mono text-xs text-danger">
                {editor.error || photoError}
              </p>
            )}
          </Section>
        </div>
      </div>

      {draft && (
        <div className="flex gap-2 border-t border-ink bg-bg px-4.5 py-3 md:sticky md:bottom-0 md:justify-end md:gap-2.5 md:border-t-2 md:px-8">
          <button
            type="button"
            onClick={cancelEditing}
            className="cursor-pointer border border-ink bg-transparent px-3.5 py-3 font-mono text-xs font-bold uppercase tracking-wide text-ink md:px-4 md:py-2.5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={editor.saving || !draft.preferredName.trim()}
            className="flex-1 cursor-pointer border border-accent bg-accent py-3 font-mono text-xs font-bold uppercase tracking-wide text-on-color disabled:opacity-50 md:flex-none md:px-4 md:py-2.5"
          >
            {editor.saving ? "Saving..." : "Save changes"}
            <span className="hidden md:inline"> →</span>
          </button>
        </div>
      )}
    </form>
  );
}
