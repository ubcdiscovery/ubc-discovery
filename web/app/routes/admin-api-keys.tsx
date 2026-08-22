import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Alert } from "~/components/ui/Alert";
import { Button } from "~/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/Table";
import { ApiError } from "~/lib/api";
import { adminApiKeysApi, type ApiCredential } from "~/lib/admin-api-keys";

export function meta() {
  return [{ title: "API Keys — UBC Discovery Admin" }];
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusLabel(credential: ApiCredential) {
  return credential.status === "active" ? "Active" : credential.status;
}

export default function AdminApiKeys() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const credentialsQuery = useQuery({
    queryKey: ["admin-api-keys"],
    queryFn: adminApiKeysApi.list,
    retry: false,
  });
  const createMutation = useMutation({
    mutationFn: adminApiKeysApi.create,
    onSuccess: (credential) => {
      setGeneratedToken(credential.raw_token);
      setCopied(false);
      setLabel("");
      setExpiresAt("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-api-keys"] });
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : "Could not generate credential."),
  });
  const revokeMutation = useMutation({
    mutationFn: adminApiKeysApi.revoke,
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-api-keys"] });
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : "Could not revoke credential."),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!label.trim()) {
      setError("Name the credential before generating it.");
      return;
    }
    createMutation.mutate({
      label: label.trim(),
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  }

  async function copyToken() {
    if (!generatedToken) return;
    await navigator.clipboard.writeText(generatedToken);
    setCopied(true);
  }

  const credentials = credentialsQuery.data?.credentials ?? [];

  return (
    <div className="px-4.5 py-8 md:px-8 md:py-12">
      <div className="mb-8 max-w-220">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
          Operations
        </p>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight md:text-5xl">
          API Keys
        </h1>
        <p className="mt-3 text-sm/relaxed text-ink-soft">
          Manage machine credentials for Candidate ingestion. Secrets are shown only once
          and are never recoverable.
        </p>
      </div>

      {error ? <Alert variant="error" className="mb-5 max-w-220">{error}</Alert> : null}
      {generatedToken ? (
        <Alert variant="success" className="mb-5 max-w-220">
          <p className="font-bold">Credential generated. Store this token now.</p>
          <p className="mt-2 text-sm">It will not appear again after this page is refreshed.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <code
              data-testid="generated-api-token"
              className="min-w-0 flex-1 break-all border border-ink bg-bg p-3 text-xs text-ink"
            >
              {generatedToken}
            </code>
            <Button type="button" size="sm" onClick={() => void copyToken()}>
              {copied ? "Copied" : "Copy token"}
            </Button>
          </div>
        </Alert>
      ) : null}

      <Card className="max-w-220">
        <CardHeader>
          <CardTitle>Generate Candidate ingestion credential</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)_auto] md:items-end"
            onSubmit={submit}
          >
            <label className="grid gap-1.5 text-sm font-bold" htmlFor="api-key-label">
              Name
              <Input
                id="api-key-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Calendar importer"
                maxLength={80}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-bold" htmlFor="api-key-expires">
              Expires (optional)
              <Input
                id="api-key-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </label>
            <Button type="submit" variant="primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Generating…" : "Generate"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="mt-10">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
          Managed credentials
        </h2>
        {credentialsQuery.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading credentials…</p>
        ) : null}
        {credentialsQuery.isError ? (
          <Alert variant="error" className="mt-4 max-w-220">
            Could not load credentials.
          </Alert>
        ) : null}
        {!credentialsQuery.isLoading && !credentialsQuery.isError ? (
          <Table className="mt-4 border border-ink bg-surface text-left">
            <TableCaption className="sr-only">Managed API credentials</TableCaption>
            <TableHeader className="bg-accent-soft">
              <TableRow className="hover:bg-accent-soft">
                <TableHead>Name</TableHead>
                <TableHead>Credential UUID</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((credential) => (
                <TableRow key={credential.id}>
                  <TableCell className="font-bold">{credential.label}</TableCell>
                  <TableCell className="font-mono text-xs text-ink-soft">{credential.id}</TableCell>
                  <TableCell>
                    <span className="block">{credential.created_by_name}</span>
                    <span className="font-mono text-2xs text-muted">{credential.created_by_email}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-ink-soft">
                    {formatDate(credential.created_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-ink-soft">
                    {formatDate(credential.expires_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-ink-soft">
                    {formatDate(credential.last_used_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-bold uppercase text-accent">
                    {statusLabel(credential)}
                  </TableCell>
                  <TableCell>
                    {credential.status === "active" ? (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => revokeMutation.mutate(credential.id)}
                        disabled={revokeMutation.isPending}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </section>
    </div>
  );
}
