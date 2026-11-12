import { ExternalLink, List, Paragraph, Section, Subhead, TermList } from "~/components/Prose";

const CONTACT_EMAIL = "hi@ubcdiscovery.com";
const LAST_UPDATED = "November 7, 2026";

export function meta() {
  return [
    { title: "Privacy Policy — UBC Discovery" },
    {
      name: "description",
      content: "What UBC Discovery collects, why, who processes it, and how to delete it.",
    },
  ];
}

const COOKIES = [
  {
    name: "ubcd.session_token",
    purpose: "Keeps you signed in.",
    lasts: "60 days after you last use the site, or until you sign out",
  },
  {
    name: "ubcd.session_data",
    purpose: "A signed copy of your session so pages load without a database lookup.",
    lasts: "5 minutes",
  },
  {
    name: "Short-lived sign-in cookies",
    purpose: "Protect the Google sign-in redirect from tampering.",
    lasts: "a few minutes, during sign-in only",
  },
  {
    name: "_ga, _ga_*",
    purpose: "Google Analytics. Counts visits and page views.",
    lasts: "up to 2 years",
  },
];

const PROCESSORS = [
  {
    name: "Cloudflare",
    role: "Hosts the website and API, and stores profile photos (R2).",
  },
  { name: "Neon", role: "Hosts our database (PostgreSQL)." },
  {
    name: "Amazon Web Services",
    role: "SES sends sign-in code emails. Bedrock turns event descriptions into embeddings for recommendations; it never receives member data.",
  },
  {
    name: "Google",
    role: "Google sign-in, and Google Analytics for usage data.",
  },
  {
    name: "OpenAI",
    role: "Reads public event posts to pull out event details. It never receives member data.",
  },
];

export default function Privacy() {
  return (
    <div className="bg-bg">
      <article className="mx-auto max-w-170 px-4.5 py-10 md:px-6 md:py-16">
        <div
          role="note"
          className="mb-8 border border-ink bg-hi p-4 font-mono text-xs/relaxed tracking-wide text-on-hi uppercase"
        >
          Draft for review · not legal advice · not yet in effect
        </div>

        <div className="font-mono text-xs font-bold uppercase tracking-wide text-accent">
          Privacy policy
        </div>
        <h1 className="mt-2 font-display text-4xl font-extrabold leading-none tracking-tight text-ink md:text-5xl">
          What we collect, and why
        </h1>
        <p className="mt-3 font-mono text-xs tracking-wide text-muted uppercase">
          Last updated {LAST_UPDATED}
        </p>

        <p className="mt-6 font-body text-base/relaxed text-ink-soft">
          UBC Discovery (ubcdiscovery.com) is an independent student project that lists events on
          and around the UBC campus. We are not run or endorsed by the University of British
          Columbia. This page explains what personal information we collect, how we use it, who
          helps us process it, and how you can see or delete it. We follow British Columbia&rsquo;s
          Personal Information Protection Act (PIPA).
        </p>
        <p className="mt-4 font-body text-base/relaxed text-ink-soft">
          You can browse events without an account. We only collect account information when you
          sign in.
        </p>

        <Section title="What we collect">
          <Subhead>When you sign in</Subhead>
          <List>
            <li>
              <strong>Email address</strong>, used as your account login. If you sign in with an
              email code, we send a short-lived one-time code to that address.
            </li>
            <li>
              <strong>From Google</strong>, if you choose Google sign-in: your name, email address,
              profile picture, and Google account ID. We ask Google only for basic profile and email
              access. We cannot see your Gmail, Drive, contacts, or anything else in your Google
              account.
            </li>
          </List>

          <Subhead>What you add to your profile</Subhead>
          <List>
            <li>Preferred name, major, academic level, and faculty.</li>
            <li>The event interests (vibes) you pick, and an optional bio.</li>
            <li>An optional profile photo you upload.</li>
          </List>

          <Subhead>What you do on the site</Subhead>
          <List>
            <li>The events you save, and when you saved them.</li>
            <li>Ratings you leave on events: stars, the vibes you pick, and an optional note.</li>
            <li>When you were last active.</li>
          </List>

          <Subhead>To keep accounts secure</Subhead>
          <List>
            <li>
              For each signed-in session: your IP address, your browser&rsquo;s user agent, and when
              the session expires.
            </li>
            <li>
              Request counts by IP address and email address, to stop people from flooding the
              sign-in form.
            </li>
          </List>

          <Subhead>Usage analytics</Subhead>
          <Paragraph>See Analytics below.</Paragraph>
        </Section>

        <Section title="How we use it">
          <List>
            <li>To run your account and keep you signed in.</li>
            <li>To show your saved events and your ratings.</li>
            <li>
              To build your For You feed. We rank events using your saved events and interests. This
              runs in our own database; your profile is not sent to an AI service.
            </li>
            <li>To send you sign-in code emails. We do not send marketing email.</li>
            <li>To prevent abuse and keep the service secure.</li>
            <li>To understand how the site is used so we can improve it.</li>
          </List>
          <Paragraph>
            We do not sell your personal information, show ads, or share it with anyone for their
            own marketing.
          </Paragraph>
        </Section>

        <Section title="What other people can see">
          <Paragraph>
            Ratings are public. Anyone viewing an event can see each rating&rsquo;s stars, vibes,
            note, and the rater&rsquo;s preferred name. The rest of your profile, your email, and
            your saved events are visible only to you and to the small team that runs UBC Discovery,
            when needed to operate the service.
          </Paragraph>
        </Section>

        <Section title="Analytics">
          <Paragraph>
            We use Google Analytics, provided by Google through Firebase, to understand how people
            find UBC Discovery and how the site is used. It records the pages you view, how long you
            actively spend on them, how you arrived (such as the link or website that referred you),
            and general device, browser, and approximate location information. Google Analytics uses
            cookies to do this.
          </Paragraph>
          <Paragraph>
            When you are signed in, we link this usage data to your account&rsquo;s internal ID, not
            your name or email, so we can understand usage across your devices. We never send your
            name or email to Google Analytics. We keep analytics data for 14 months.
          </Paragraph>
          <Paragraph>
            You can block Google Analytics with your browser&rsquo;s privacy settings or
            Google&rsquo;s{" "}
            <ExternalLink href="https://tools.google.com/dlpage/gaoptout">
              opt-out add-on
            </ExternalLink>
            .
          </Paragraph>
        </Section>

        <Section title="Cookies and local storage">
          <TermList
            mono
            terms={COOKIES.map(({ name, purpose, lasts }) => ({
              term: name,
              detail: `${purpose} Lasts: ${lasts}.`,
            }))}
          />
          <Paragraph>
            We also use your browser&rsquo;s local storage to remember your light or dark theme and
            to keep unfinished profile setup answers until you finish. That data stays on your
            device.
          </Paragraph>
        </Section>

        <Section title="Who processes your data">
          <Paragraph>
            We use these service providers to run UBC Discovery. They process data on our behalf and
            only for the purposes above.
          </Paragraph>
          <TermList terms={PROCESSORS.map(({ name, role }) => ({ term: name, detail: role }))} />
          <Paragraph>
            Some of these providers store or process data outside Canada, including in the United
            States, where it may be subject to local laws.
          </Paragraph>
        </Section>

        <Section title="Data from Google">
          <Paragraph>
            UBC Discovery&rsquo;s use and transfer to any other app of information received from
            Google APIs will adhere to the{" "}
            <ExternalLink href="https://developers.google.com/terms/api-services-user-data-policy">
              Google API Services User Data Policy
            </ExternalLink>
            , including the Limited Use requirements.
          </Paragraph>
          <Paragraph>
            In practice: we use your Google name, email, and profile picture only to create and show
            your UBC Discovery account. We do not use it for advertising, do not sell it, and do not
            transfer it to others except the service providers listed above as needed to run the
            site. People on our team do not read it unless you ask us to, it is needed for security,
            or the law requires it. Sign-in tokens from Google are stored encrypted. You can remove
            UBC Discovery&rsquo;s access at any time from your{" "}
            <ExternalLink href="https://myaccount.google.com/connections">
              Google account
            </ExternalLink>
            .
          </Paragraph>
        </Section>

        <Section title="How long we keep it">
          <List>
            <li>
              Account, profile, saved events, and ratings: while your account exists. We delete them
              within 30 days of a deletion request.
            </li>
            <li>Sessions: until you sign out, or 60 days after you last use the site.</li>
            <li>Sign-in codes: a few minutes, until they are used or expire.</li>
            <li>Analytics data: 14 months.</li>
            <li>
              Database backups may keep a copy for a limited time after deletion, and are not used
              to restore deleted accounts except to recover from an outage.
            </li>
          </List>
        </Section>

        <Section title="Your choices">
          <List>
            <li>You can change your profile at any time on your Profile page.</li>
            <li>
              To get a copy of your data, correct it, or delete your account, email <Mail />.
              Deleting your account removes your profile, profile photo, saved events, ratings,
              sessions, and the analytics data linked to your account.
            </li>
            <li>We reply within 30 days.</li>
          </List>
          <Paragraph>
            If you are not satisfied with our answer, you can contact the{" "}
            <ExternalLink href="https://www.oipc.bc.ca/">
              Office of the Information and Privacy Commissioner for British Columbia
            </ExternalLink>
            .
          </Paragraph>
        </Section>

        <Section title="Changes">
          <Paragraph>
            If we change this policy, we will update the date at the top of this page. For
            significant changes we will also tell signed-in members on the site.
          </Paragraph>
        </Section>

        <Section title="Contact">
          <Paragraph>
            Questions or privacy requests: <Mail />.
          </Paragraph>
        </Section>
      </article>
    </div>
  );
}

function Mail() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent underline underline-offset-2">
      {CONTACT_EMAIL}
    </a>
  );
}
