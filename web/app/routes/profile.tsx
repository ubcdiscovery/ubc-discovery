import { useRef, useState } from "react";
import { Link } from "react-router";
import { VIBES, FACULTIES, YEARS } from "~/lib/constants";
import { VibeTag } from "~/components/VibeTag";
import { type UserResponse } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { MemberBoundary } from "~/components/MemberBoundary";
import { yearLabelToStanding, yearStandingToLabel } from "~/lib/onboarding";

export function meta() {
  return [{ title: "Profile — UBC Discovery" }];
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4.5 border-b border-rule-soft md:p-0">
      <div className="font-mono text-[10px] text-muted tracking-wider uppercase mb-3 pb-1.5 border-b border-ink md:flex md:justify-between md:items-baseline">
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function KV({
  k,
  v,
  danger,
}: {
  k: string;
  v: string;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex justify-between items-center py-2 border-b border-dotted border-rule-soft font-mono text-xs tracking-wide ${
        danger ? "text-[#D63A2E]" : "text-ink"
      }`}
    >
      <span className="text-muted">{k}</span>
      <span className="font-bold">{v}</span>
    </div>
  );
}

function VisitorProfile() {
  return (
    <div>
      {/* Mobile */}
      <div className="md:hidden px-5.5 pt-7">
        <div className="font-mono text-[10px] text-accent font-bold tracking-wider uppercase">
          Join UBC Discovery
        </div>
        <h1 className="mt-2 font-display font-extrabold text-5xl text-ink tracking-tighter leading-[0.92]">
          Sign in
          <br />
          to make it
          <br />
          yours.
        </h1>
        <p className="mt-3.5 text-sm/relaxed text-ink-soft">
          Save events. Rate them. Unlock the re-ranked For You feed.
        </p>
        <Link
          to="/sign-in"
          className="mt-6 block py-3.5 border border-accent bg-accent text-white font-mono text-[11px] font-bold tracking-wider uppercase text-center no-underline"
        >
          SIGN IN →
        </Link>
      </div>

      {/* Desktop */}
      <div className="hidden md:block max-w-180 mx-auto px-8 py-20">
        <div className="border border-ink p-10 px-12">
          <div className="font-mono text-[10.5px] text-accent font-bold tracking-wider uppercase">
            Member feature
          </div>
          <h1 className="mt-3 mb-2 font-display font-extrabold text-6xl text-ink tracking-tighter leading-[0.92]">
            Sign in for a profile.
          </h1>
          <p className="mt-3.5 text-base/relaxed text-ink-soft max-w-135">
            Members get a profile with their interests and academic context, a
            saved-event shortlist, and a re-ranked <em>For you</em> feed.
          </p>
          <Link
            to="/sign-in"
            className="mt-5 inline-block px-4 py-3 border border-accent bg-accent text-white font-mono text-[11px] font-bold tracking-wider uppercase no-underline"
          >
            Sign in →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function Profile() {
  return (
    <MemberBoundary fallback={<VisitorProfile />}>
      {(profile) => <MemberProfile user={profile} />}
    </MemberBoundary>
  );
}

function formatMemberSince(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function MemberProfile({ user }: { user: UserResponse }) {
  const { updateProfile, uploadProfilePhoto } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.preferred_name);
  const [faculty, setFaculty] = useState(user.faculty ?? "");
  const [major, setMajor] = useState(user.major ?? "");
  const [year, setYear] = useState(yearStandingToLabel(user.year_standing));
  const [interests, setInterests] = useState(user.interests ?? []);
  const [avatar, setAvatar] = useState<string | null>(user.profile_picture_url);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const memberSince = formatMemberSince(user.created_at);

  function resetForm() {
    setName(user.preferred_name);
    setFaculty(user.faculty ?? "");
    setMajor(user.major ?? "");
    setYear(yearStandingToLabel(user.year_standing));
    setInterests(user.interests ?? []);
    setAvatar(user.profile_picture_url);
    setError("");
    setEditing(false);
  }

  function toggle(id: string) {
    setInterests((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
    );
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setAvatar(URL.createObjectURL(f));
    try {
      await uploadProfilePhoto(f);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveProfile() {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const next = await updateProfile({
        preferred_name: name.trim(),
        faculty: faculty || undefined,
        major: major.trim() || undefined,
        year_standing: yearLabelToStanding(year),
        interests,
      });
      setName(next.preferred_name);
      setFaculty(next.faculty ?? "");
      setMajor(next.major ?? "");
      setYear(yearStandingToLabel(next.year_standing));
      setInterests(next.interests ?? []);
      setAvatar(next.profile_picture_url);
      setEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Mobile */}
      <div className="md:hidden">
        {/* Avatar block */}
        <div className="px-4.5 py-5 border-b-2 border-ink flex items-center gap-3.5">
          <div className="relative shrink-0">
            <div
              className="size-19 border-[1.5px] border-ink flex items-center justify-center font-display font-extrabold text-3xl text-white tracking-tight"
              style={{
                background: avatar
                  ? `url(${avatar}) center/cover`
                  : "linear-gradient(135deg, #1E40FF, #7990FF)",
              }}
            >
              {!avatar && name[0]?.toUpperCase()}
            </div>
            {editing && (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="absolute -bottom-1.5 -right-1.5 size-7 bg-ink text-bg border-2 border-bg cursor-pointer flex items-center justify-center p-0"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <rect
                      x="1"
                      y="4"
                      width="14"
                      height="10"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                    <circle
                      cx="8"
                      cy="9"
                      r="2.5"
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                    <rect
                      x="5"
                      y="2"
                      width="6"
                      height="2"
                      fill="currentColor"
                    />
                  </svg>
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
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-3 border border-ink bg-surface font-display text-2xl font-bold text-ink tracking-tight outline-none"
              />
            ) : (
              <h1 className="font-display font-extrabold text-3xl text-ink tracking-tight leading-none">
                {name}
              </h1>
            )}
            {!editing && (
              <div className="mt-1.5 text-sm text-ink-soft">
                {[major, year].filter(Boolean).join(" · ") || "Profile ready"}
              </div>
            )}
          </div>
        </div>

        <Section label="Academic context">
          {editing ? (
            <div className="space-y-3">
              <div>
                <div className="font-mono text-[10px] text-muted tracking-wide uppercase mb-1.5">
                  Faculty
                </div>
                <select
                  value={faculty}
                  onChange={(e) => setFaculty(e.target.value)}
                  className="w-full px-3 py-2.5 border border-ink bg-surface font-body text-sm text-ink appearance-none cursor-pointer outline-none"
                >
                  {FACULTIES.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted tracking-wide uppercase mb-1.5">
                  Major
                </div>
                <input
                  value={major}
                  onChange={(e) => setMajor(e.target.value)}
                  className="w-full px-3 py-2.5 border border-ink bg-surface font-body text-sm text-ink outline-none"
                />
              </div>
              <div>
                <div className="font-mono text-[10px] text-muted tracking-wide uppercase mb-1.5">
                  Year
                </div>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-full px-3 py-2.5 border border-ink bg-surface font-body text-sm text-ink appearance-none cursor-pointer outline-none"
                >
                  {YEARS.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <>
              <KV k="Faculty" v={faculty} />
              <KV k="Major" v={major} />
              <KV k="Year" v={year} />
            </>
          )}
        </Section>

        <Section label="Interests">
          {editing ? (
            <div className="flex flex-wrap gap-1.5">
              {VIBES.map((v) => (
                <button
                  key={v.id}
                  onClick={() => toggle(v.id)}
                  className="p-0 border-none bg-transparent cursor-pointer"
                >
                  <VibeTag vibe={v.id} active={interests.includes(v.id)} />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {interests.map((v) => (
                <VibeTag key={v} vibe={v} />
              ))}
            </div>
          )}
        </Section>

        <Section label="Activity">
          <KV k="Member since" v={memberSince} />
        </Section>

        <Section label="Account">
          <KV k="Email" v={user.email} />
          <KV k="UBC verified" v={user.ubc_verified ? "Yes" : "No"} />
          {error && <p className="mt-2 text-xs text-[#D63A2E] font-mono">{error}</p>}
        </Section>

        {editing && (
          <div className="fixed bottom-0 inset-x-0 px-4.5 py-3 pb-7 bg-bg border-t border-ink flex gap-2 z-50 md:hidden">
            <button
              onClick={resetForm}
              className="px-3.5 py-3 border border-ink bg-transparent text-ink cursor-pointer font-mono text-[11px] font-bold tracking-wide uppercase"
            >
              Cancel
            </button>
            <button
              onClick={saveProfile}
              disabled={saving || !name.trim()}
              className="flex-1 py-3 border border-accent bg-accent text-white cursor-pointer font-mono text-[11px] font-bold tracking-wide uppercase disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        )}
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        {/* Hero */}
        <div className="px-8 pt-10 pb-8 border-b border-ink">
          <div className="max-w-270 mx-auto flex gap-7 items-center">
            <div className="relative shrink-0">
              <div
                className="size-33 border-2 border-ink flex items-center justify-center font-display font-extrabold text-6xl text-white tracking-tighter"
                style={{
                  background: avatar
                    ? `url(${avatar}) center/cover`
                    : "linear-gradient(135deg, #1E40FF, #7990FF)",
                }}
              >
                {!avatar && name[0]?.toUpperCase()}
              </div>
              {editing && (
                <>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="absolute -bottom-2.5 -right-2.5 bg-ink text-bg border-2 border-bg cursor-pointer px-3 py-1.5 font-mono text-[10px] font-bold tracking-wide uppercase flex items-center gap-1.5"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
                      <rect
                        x="1"
                        y="4"
                        width="14"
                        height="10"
                        stroke="currentColor"
                        strokeWidth="1.4"
                      />
                      <circle
                        cx="8"
                        cy="9"
                        r="2.5"
                        stroke="currentColor"
                        strokeWidth="1.4"
                      />
                      <rect
                        x="5"
                        y="2"
                        width="6"
                        height="2"
                        fill="currentColor"
                      />
                    </svg>
                    Change
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
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="flex gap-3 flex-wrap">
                  <div className="flex-[1_1_280px] min-w-0">
                    <div className="font-mono text-[10px] text-muted tracking-wider uppercase mb-1.5">
                      Preferred name
                    </div>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full p-3 border border-ink bg-surface font-display text-2xl font-bold text-ink tracking-tight outline-none"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="font-display font-extrabold text-6xl text-ink tracking-tighter leading-none">
                    {name}.
                  </h1>
                  <div className="mt-2 flex gap-3.5 items-center text-sm text-ink-soft">
                    <span>
                      {[major, year].filter(Boolean).join(" · ") || "Profile ready"}
                    </span>
                    <span className="size-1 rounded-full bg-muted" />
                    <span className="font-mono text-xs text-muted tracking-wide">
                      Member since {memberSince}
                    </span>
                  </div>
                </>
              )}
            </div>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="px-4 py-2.5 border border-ink bg-transparent text-ink font-mono text-[11px] font-bold tracking-wide uppercase cursor-pointer shrink-0 self-start mt-3.5"
              >
                Edit profile
              </button>
            )}
          </div>
        </div>

        {/* Two-column body */}
        <div className="max-w-270 mx-auto p-8 pb-14">
          <div className="grid grid-cols-2 gap-8">
            <Section label="Academic context">
              {editing ? (
                <div className="space-y-3.5">
                  <div>
                    <div className="font-mono text-[10px] text-muted tracking-wider uppercase mb-1.5">
                      Faculty
                    </div>
                    <select
                      value={faculty}
                      onChange={(e) => setFaculty(e.target.value)}
                      className="w-full px-3 py-2.5 border border-ink bg-surface font-body text-sm text-ink appearance-none cursor-pointer outline-none"
                    >
                      {FACULTIES.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] text-muted tracking-wider uppercase mb-1.5">
                      Major
                    </div>
                    <input
                      value={major}
                      onChange={(e) => setMajor(e.target.value)}
                      className="w-full px-3 py-2.5 border border-ink bg-surface font-body text-sm text-ink outline-none"
                    />
                  </div>
                  <div>
                    <div className="font-mono text-[10px] text-muted tracking-wider uppercase mb-1.5">
                      Year
                    </div>
                    <select
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      className="w-full px-3 py-2.5 border border-ink bg-surface font-body text-sm text-ink appearance-none cursor-pointer outline-none"
                    >
                      {YEARS.map((y) => (
                        <option key={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <>
                  <KV k="Faculty" v={faculty} />
                  <KV k="Major" v={major} />
                  <KV k="Year" v={year} />
                </>
              )}
            </Section>

            <Section label="Interests">
              {editing ? (
                <div className="flex flex-wrap gap-1.5">
                  {VIBES.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => toggle(v.id)}
                      className="p-0 border-none bg-transparent cursor-pointer"
                    >
                      <VibeTag
                        vibe={v.id}
                        active={interests.includes(v.id)}
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {interests.map((v) => (
                    <VibeTag key={v} vibe={v} />
                  ))}
                </div>
              )}
            </Section>

            <Section label="Activity">
              <KV k="Member since" v={memberSince} />
            </Section>

            <Section label="Account">
              <KV k="Email" v={user.email} />
              <KV k="UBC verified" v={user.ubc_verified ? "Yes" : "No"} />
              {error && <p className="mt-2 text-xs text-[#D63A2E] font-mono">{error}</p>}
            </Section>
          </div>
        </div>

        {editing && (
          <div className="sticky bottom-0 inset-x-0 px-8 py-3 bg-bg border-t-2 border-ink flex justify-end gap-2.5">
            <button
              onClick={resetForm}
              className="px-4 py-2.5 border border-ink bg-transparent text-ink cursor-pointer font-mono text-[11px] font-bold tracking-wide uppercase"
            >
              Cancel
            </button>
            <button
              onClick={saveProfile}
              disabled={saving || !name.trim()}
              className="px-4 py-2.5 border border-accent bg-accent text-white cursor-pointer font-mono text-[11px] font-bold tracking-wide uppercase disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
