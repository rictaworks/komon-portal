# komon-portal

A document portal for a labour and social security office and the client companies it serves.

When a document arrives, staff currently decide by eye which client it belongs to, rename it, file it, send it, and check that it was received. komon-portal does one thing with that work: it places each incoming document on the correct client's shelf without mix-ups, and records that the client received it. Case progress (submitted, document received, delivered, seen by the client) is updated from those records instead of being typed in.

The design is in [`instructions.md`](instructions.md) (Japanese). The software as built is described in [`SPEC/`](SPEC/README.md), with the API in [`SPEC/api/openapi.json`](SPEC/api/openapi.json). The web UI is English only.

## Status

Every feature in the design has been built and merged: the domain core, the D1 schema and adapters, sign-in and sessions, the office and client APIs, the office and client screens, the Jev classifier (with the office's own key), Web Push notifications, daily trash purging, the developer's admin Worker, and the release workflow.

**Known gaps** (none is a silent failure; each is reported where it occurs):

- A document whose stored body cannot be removed after its record was erased is left without a row, so it cannot be retried. Fixing it needs a purge state.
- The client home lists unread documents by intake time, not publication time, within a window of 100 (the response says when more exist).
- The Owner dashboard shows a count of mis-deliveries; the spec asks for the readers and times, which are in the incidents list.
- The weekly count of staff using the portal is not measured: events do not record the acting staff member.
- The Settings page fetches the staff list for Staff as well; the server still refuses the Owner-only actions.
- The client pickers and the document list load a first page only (200 clients; documents are not paged in the screen yet).
- Browser checks are manual in this version: there is no automated end-to-end run in CI yet.

## Stack

- Cloudflare Workers with [Hono](https://hono.dev) for the API
- Cloudflare D1 for data and R2 for document bodies
- React 19 and Vite for the web UI, served as static assets by the Worker
- Google OpenID Connect for sign-in, Cloudflare Turnstile for human checks, Web Push (VAPID) for notifications
- TypeScript in strict mode, Vitest with the Workers pool, ESLint

## Requirements

- Node.js 22 or later
- A Cloudflare account; Wrangler comes with the project's dev dependencies

## Local development

```bash
npm ci
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply komon-portal --local
npm run dev
```

`npm run dev` builds the web UI and starts `wrangler dev`. `.dev.vars` is git-ignored; never commit it.

### Development sign-in (automatic)

With `ENVIRONMENT=development` the sign-in page offers development sign-in buttons. They call `POST /api/dev/login` with a role of `owner`, `staff` or `member`, and sign in as a ready-made test user without Google. The `member` role belongs to a demo client (code `DEMO01`). The route does not exist in production.

Google sign-in needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The redirect URI registered with Google is `<origin>/api/auth/callback`.

### Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Pages

| Path | Who | Page |
|---|---|---|
| `/` | everyone | Sends a visitor to the place for their role |
| `/sign-in` | everyone | Sign in with Google (or the development buttons) |
| `/redeem` | signed in | Use an invitation code (Turnstile required) |
| `/setup` | signed in | First-time setup with the setup token (Turnstile required) |
| `/pending` | signed in | Waiting for the office to approve the invitation |
| `/no-access` | signed in | No role and no membership |
| `/notices` | everyone | Open-source notices and what the portal keeps |
| `/office/dashboard` | active staff | Counts, retrieval and due items, unread documents |
| `/office/intake` | active staff | Take in files and folders; classify with Jev |
| `/office/review` | active staff | Decide the client of files the system could not place |
| `/office/staged` | active staff | Publish by client, with a confirmation and per-file results |
| `/office/clients` | active staff | Clients, and `/office/clients/:clientId` for one client's members and invitations |
| `/office/shelf/:clientId` | active staff | One client's published, withdrawn and trashed documents |
| `/office/cases` | active staff | Cases: register, submit with arrival numbers, close or cancel |
| `/office/settings` | active staff | Office settings, document and case types, staff, the Jev key (browser only) |
| `/office/audit` | Owner | The audit log and incidents |
| `/client/:clientId/home` | active member | New documents and cases |
| `/client/:clientId/documents` | active member | Published documents, filtered by type and month |
| `/client/:clientId/send` | active member | Send one file to the office; see what was confirmed |
| `/client/:clientId/notifications` | active member | Browser notifications for this device |

Any other path shows the not-found page.

## API

The office Worker's API. Each operation's access rule is in the OpenAPI file; a test keeps the file and the routes in step.

| Method | Path | What it does | Who |
|---|---|---|---|
| GET | `/api/auth/callback` | Completes Google sign-in and starts a session. Redirects back. | none |
| GET | `/api/auth/login` | Starts Google sign-in (OpenID Connect with PKCE). Redirects to Google. | none |
| POST | `/api/auth/logout` | Ends the current session. | session |
| GET | `/api/client/{clientId}/doc-types` | Document types the company may send and receive. | member |
| GET | `/api/client/{clientId}/documents` | Published documents of the company, filtered by type and month. | member |
| GET | `/api/client/{clientId}/home` | The company's unread documents and cases (up to 100 each, with truncation flags). | member |
| GET | `/api/client/{clientId}/notifications` | Whether notifications are available, the VAPID public key and the account's subscription count. | member |
| DELETE | `/api/client/{clientId}/notifications/subscriptions` | Removes this browser's push subscription by endpoint. | member |
| POST | `/api/client/{clientId}/notifications/subscriptions` | Stores this browser's push subscription for the member. | member |
| GET | `/api/client/{clientId}/submissions` | Files the company has sent, with their confirmation state. | member |
| POST | `/api/client/{clientId}/submissions` | Sends one file to the office (multipart: file, docTypeId, targetMonth). Answers with the outcome. | member |
| POST | `/api/client/{clientId}/submissions/{id}/cancel` | Cancels a submission the office has not confirmed (version required). | member |
| GET | `/api/config` | Public configuration: environment, Turnstile key, sign-in availability, setup state. | none |
| POST | `/api/dev/login` | Development only: signs in as a test user (owner, staff or member). | development |
| GET | `/api/files/{id}/content` | Opens a file as an attachment (mode=view or download). Records the first view or acknowledgement. | session |
| GET | `/api/health` | Liveness check. | none |
| POST | `/api/invitations/redeem` | Uses an invitation code. Requires a Turnstile token and a signed-in user. | session |
| GET | `/api/me` | The signed-in user with memberships and CSRF token. 401 when signed out. | session |
| GET | `/api/office/audit` | The audit log, newest first (append-only). | owner |
| POST | `/api/office/batches` | Starts an upload batch, optionally with a destination client hint. | staff |
| POST | `/api/office/batches/{batchId}/files` | Uploads one file into a batch and returns its result (stored, duplicate or rejected). | staff |
| POST | `/api/office/case-types` | Adds a case type. | staff |
| PUT | `/api/office/case-types/{id}` | Updates a case type. | staff |
| GET | `/api/office/cases` | Cases, optionally for one client. | staff |
| POST | `/api/office/cases` | Registers a case for a client, case type and target month. | staff |
| GET | `/api/office/cases/{id}` | One case with its arrival numbers and deadlines. | staff |
| POST | `/api/office/cases/{id}/cancel` | Cancels a case (version required). | staff |
| POST | `/api/office/cases/{id}/close` | Closes a confirmed case (version required). | staff |
| POST | `/api/office/cases/{id}/submit` | Records the submission of a case with its arrival numbers. | staff |
| POST | `/api/office/classify` | Asks Jev to suggest document types. The key is sent in the X-Jev-Key header and never stored. | staff |
| GET | `/api/office/clients` | Lists clients, optionally filtered by status. | staff |
| POST | `/api/office/clients` | Registers a client. | staff |
| GET | `/api/office/clients/{id}` | One client. | staff |
| PATCH | `/api/office/clients/{id}` | Updates a client's name, number or status (version required). | staff |
| POST | `/api/office/clients/{id}/invitations` | Issues a client invitation. The code is shown once. | staff |
| GET | `/api/office/clients/{id}/members` | Members and open invitations of a client. | staff |
| GET | `/api/office/dashboard` | Office dashboard counts and the lists of unread, retrieval and due items. | staff |
| POST | `/api/office/doc-rules` | Adds a keyword rule for a document type. | staff |
| DELETE | `/api/office/doc-rules/{id}` | Removes a keyword rule. 404 when the rule does not exist. | staff |
| POST | `/api/office/doc-types` | Adds a document type. | staff |
| PUT | `/api/office/doc-types/{id}` | Updates a document type. | staff |
| GET | `/api/office/files` | Lists files with filters (direction, states, client, case, document type, month, review reason) and paging. | staff |
| GET | `/api/office/files/{id}` | One file with its readers. | staff |
| POST | `/api/office/files/{id}/assign` | Assigns a file to a client (and optionally a case and document type) during review. | staff |
| POST | `/api/office/files/{id}/doc-type` | Sets the document type of a file. | staff |
| POST | `/api/office/files/{id}/link-case` | Links a file to a case. | staff |
| POST | `/api/office/files/{id}/restore` | Restores a trashed file. | staff |
| POST | `/api/office/files/{id}/send-back` | Sends a staged file back to review. | staff |
| POST | `/api/office/files/{id}/trash` | Moves a file to the trash. | staff |
| POST | `/api/office/files/{id}/withdraw` | Withdraws a published file with a reason, and says where it goes next. | staff |
| GET | `/api/office/incidents` | Mis-delivered files that were withdrawn as wrong client or wrong file. | owner |
| POST | `/api/office/invitations/{id}/cancel` | Cancels an open invitation. | staff |
| POST | `/api/office/memberships/{id}/approve` | Approves a client member. | staff |
| POST | `/api/office/memberships/{id}/reject` | Rejects a client member. | staff |
| POST | `/api/office/memberships/{id}/revoke` | Revokes a client member's access. | staff |
| POST | `/api/office/publish` | Publishes staged files, one result per file. | staff |
| GET | `/api/office/settings` | Office settings, document and case types, and rules. | staff |
| PUT | `/api/office/settings/office` | Updates office settings (time zone, arrival-number pattern, deadlines, automatic publishing). | owner |
| GET | `/api/office/staff` | Staff members and open staff invitations. | owner |
| POST | `/api/office/staff/invitations` | Issues a staff invitation for the Staff or Owner role. | owner |
| POST | `/api/office/staff/{userId}/approve` | Approves a staff member. | owner |
| POST | `/api/office/staff/{userId}/reject` | Rejects a staff member. | owner |
| POST | `/api/office/staff/{userId}/revoke` | Revokes a staff member's access. | owner |
| GET | `/api/session` | The signed-in user and memberships, or null when nobody is signed in. Always 200. | none |
| POST | `/api/setup/claim` | Makes the signed-in user the first Owner, with the setup token and a Turnstile token. | session |

## Admin Worker (developer)

A separate Worker in `src/admin` with `wrangler.admin.jsonc`. It has a D1 binding and no R2, Jev or asset binding. Every request must carry the Cloudflare Access assertion, which is verified against the team's keys.

| Path | What it returns |
|---|---|
| `/` | Summary page: events, weekly active clients, accepted documents by method, withdrawals by reason, time from publication to first view |
| `/api/summary` | The same figures as JSON |
| `/api/health` | Liveness |

Counts and averages only: no names, file names or identifiers.

## Deployment

Each deployment serves one office, in that office's own Cloudflare account.

1. Create the database and bucket, then put the returned D1 ID into `wrangler.jsonc` and `wrangler.admin.jsonc` in place of the placeholder:

   ```bash
   npx wrangler d1 create komon-portal
   npx wrangler r2 bucket create komon-portal-files
   ```

2. Apply the migrations to the remote database:

   ```bash
   npx wrangler d1 migrations apply komon-portal --remote
   ```

3. Set the portal's secrets. Values are never stored in the repository.

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put SETUP_TOKEN
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT
   ```

   `TURNSTILE_SITE_KEY` is public and goes in `wrangler.jsonc`. The three VAPID values must be set together; a partial set is refused. `ENVIRONMENT` must be `production`.

4. Create the Access application for the admin Worker, then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` on `komon-portal-admin` and deploy it with `npx wrangler deploy --config wrangler.admin.jsonc`.

5. Create the first Owner. Sign in with Google, then call `POST /api/setup/claim` with the `SETUP_TOKEN` and a Turnstile token (`{"token": "...", "turnstileToken": "..."}`). The token stops working once an Owner exists.

## Releases

Versions have the form `01.01.00`. A published GitHub release with that tag runs `.github/workflows/release.yml`: it checks the tag format, runs lint, types, tests and the build, and then deploys the portal Worker and the admin Worker. The deploy job uses the `production` environment, which needs the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

To release: create an annotated tag `01.01.00` on the commit to ship, push it, and publish a release for that tag.

## Security and personal data

- Only Google's account ID (`sub`) and the display name are stored. The email address is never requested or stored, and IP addresses are not stored.
- Sessions are stored as hashes. The session cookie is `__Host-kp_session` (HttpOnly, Secure, SameSite=Lax), with a 60-minute idle timeout and a 12-hour limit.
- A client member can reach only the data of clients they belong to. Requests for other clients receive "not found".
- Original file names are not kept; names shown and downloaded are generated by the system.
- Documents containing an Individual Number (My Number) must not be submitted.
- The Jev key stays in the office's browser and is sent only with a classification request.

## Repository layout

| Path | Contents |
|---|---|
| `src/core` | Domain core: model, ports, access policy, intake, cases, publishing, office. Imports nothing from Cloudflare, Hono or React. |
| `src/app` | The portal Worker: API (`api`), adapters (`adapters`), migrations, web UI (`web`), scheduled tasks |
| `src/admin` | The developer's admin Worker |
| `src/locales/en.json` | All user-facing strings |
| `test` | Unit tests for the core, adapter and API tests, admin tests, and static checks (strings, core purity, API documentation) |
| `SPEC` | The software as built: an overview with diagrams, and the OpenAPI file |
| `app-ui` | Design mock-ups and the design system used for them |
| `instructions.md` | The design document (Japanese) |

## Contact

info@rictaworks.jp

## License

MIT. See [`LICENSE`](LICENSE).
