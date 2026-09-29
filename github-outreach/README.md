# GitHub Outreach

A local tool for GitHub user search. It shows an email only when that person has published it on their normal GitHub profile, lets you save them to an outreach list, and creates a Gmail draft. Nothing is sent until you approve that draft and click Send.

```text
GitHub user search
        ↓
Public profile email
        ↓
Add to outreach
        ↓
Preview
        ↓
Create Gmail draft
        ↓
Approve
        ↓
Send one message
        ↓
Track status
```

The server binds to `127.0.0.1:3847`. Gmail tokens stay in the local SQLite database, encrypted, and are never sent to the Tampermonkey script.

## 1. Install and start the server

From this repository:

```bash
cd github-outreach/server
npm install
cp .env.example .env
```

Edit `server/.env` and set a long random `TOKEN_ENCRYPTION_KEY` before you connect Gmail. You can generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then create the database and start the app:

```bash
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

Open [http://localhost:3847](http://localhost:3847).

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the API and dashboard with reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run prisma:migrate` | Create or apply a Prisma migration |
| `npm run prisma:studio` | Open the database browser |
| `npm run lint` | Typecheck the server |
| `npm test` | Run the safety and formatting tests |

## 2. Create the Google Cloud OAuth client

The app never asks for your Gmail password. Google shows its own consent screen.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. APIs & Services → Library → enable **Gmail API**.
3. APIs & Services → OAuth consent screen.
   - User type: **External** is fine for personal use.
   - Add your Gmail address as a **test user** while the app is in Testing.
   - Scopes to add:
     - `https://www.googleapis.com/auth/gmail.compose`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/userinfo.email`
     - `openid`
   - These scopes create drafts and send mail. They do not request full mailbox access.
4. APIs & Services → Credentials → Create credentials → **OAuth client ID**.
   - Application type: **Web application**.
   - Authorized redirect URI, exactly:

```text
http://localhost:3847/api/auth/google/callback
```

5. Copy the client ID and client secret into `github-outreach/server/.env`:

```text
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3847/api/auth/google/callback
```

6. Restart `npm run dev`.

While the consent screen stays in Testing, Google expires refresh tokens after 7 days. Reconnect Gmail when that happens. Publishing the app, or moving it out of Testing, is a Google verification process and is not required to try the tool with a test user.

## 3. Connect Gmail

1. Open [http://localhost:3847](http://localhost:3847).
2. Go to **Settings**.
3. Click **Connect Gmail**.
4. Choose the Gmail account that should send mail and allow the requested scopes.
5. You land back on the dashboard with the connected address. The browser never receives the refresh token.

## 4. Install the Chrome extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose `github-outreach/extension/chrome`.
4. Open a GitHub **Users** search while logged in to GitHub, for example:

```text
https://github.com/search?q=full+stack&type=users
```

For each result the script requests only `https://github.com/{username}` and reads a public profile email from markup such as `[itemprop="email"]` or `.vcard-details a[href^="mailto:"]`. It does not open commit history, and it ignores `@users.noreply.github.com`.

You will see:

```text
📧 person@example.com   [+ Outreach]
```

or:

```text
📧 No public email
```

Click the email to copy it. Click **+ Outreach** to save the person. A second click, or a duplicate email, stays on **✓ Added** and the row says **Already in outreach**. Profile lookups are cached for 24 hours, queued with at most 2 at a time, and spaced 200–500ms apart. **Refresh** bypasses the cache for that person.

The toolbar on the search page can collect more than the current page. Set **Public emails** from 1 to 500 and click **Collect public emails**. It follows Next until it has saved that many public emails, you click **Stop**, or GitHub runs out of results. One user search lists about 1,000 people, and only some of them publish an email, so a narrow search may finish below 500.

Set **Seconds between sends** and **Max per day** (up to 500), then click **Send collected**. The server waits that many seconds between messages. 100 messages at 60 seconds take about 100 minutes. 500 messages at 60 seconds take about 8 hours. Leave the GitHub tab open while it sends.

**Send test** delivers one copy of the selected template to the address in **Test inbox**. Check Inbox and Spam there. The same fields are on the dashboard under **Settings → Send timing**.

The bottom-right **GitHub Outreach** panel shows counts and opens the dashboard. It is draggable and remembers whether it was collapsed. If the local server is down, email badges still work and the panel says **Outreach server offline** with **Retry**.

## 5. Test with one contact

1. Search GitHub users.
2. Confirm a public email appears beside a person who shows one on their profile.
3. Confirm someone without a public email shows **No public email** and has no outreach button.
4. Click **+ Outreach**.
5. Click it again, or add the same email later, and confirm no second contact is created.
6. Open the dashboard. The contact is status **NEW**.

## 6. Create a draft

1. In **Templates**, keep or edit the sample template. Variables:

```text
{{name}} {{first_name}} {{username}} {{email}}
{{github_url}} {{bio}} {{company}} {{location}} {{search_keyword}}
```

`{{first_name | default:"there"}}` is supported. A headline such as "Senior AI Full Stack Engineer" becomes "Hi there," rather than "Hi Senior,".

2. Open the contact and choose the template.
3. Click **Preview Message**. Check To, Subject, and Body. Edit the text if you want.
4. Click **Create Gmail Draft**.
5. Open Gmail → Drafts. The message is there and has not been sent.
6. The contact status is **DRAFTED**.

You can select several **NEW** contacts and click **Create Drafts**. The app asks you to confirm, shows each personalized opening, highlights missing variables such as `{{bio}}`, and creates the drafts one by one (`Creating 1/3...`). It still does not send them. Unresolved `{{tokens}}` are rejected.

## 7. Approve and send

1. Open **Drafts** and click **Approve**. Status becomes **APPROVED**.
2. Open **Approved** and click **Send** for that one message.
3. After Gmail accepts it, status becomes **SENT**, with `sentAt` and the Gmail message id stored locally.

These jumps are impossible: **NEW → SENT** and **DRAFTED → SENT**. A failed send becomes **FAILED** and can be sent only after you click **Approve again**.

**Mark Do Not Contact** or **Mark opted out** disables drafts and sending. That status is not changed back automatically.

Defaults in `.env`:

```text
MAX_SENDS_PER_DAY=20
MIN_SECONDS_BETWEEN_SENDS=60
MAX_CONTACT_ATTEMPTS_PER_EMAIL=1
```

The daily cap can be set from 1 to 500 on the dashboard (**Settings → Send timing**) or in the extension toolbar. After pulling this version, apply the new database table:

```bash
npx prisma migrate deploy
```

## Architecture

```text
extension/chrome
  GitHub user search → public profile HTML → POST /api/contacts

server (Express + Prisma + SQLite)
  dashboard at /
  contacts, templates, outreach, Gmail drafts
  Google OAuth tokens encrypted with AES-256-GCM

Gmail API
  drafts.create to store a draft
  drafts.send only after approval
```

Contact identity is the normalized email (trimmed, lowercased). The same email updates profile fields and does not create a second row. GitHub noreply addresses are rejected.

Statuses: `NEW → DRAFTED → APPROVED → SENT`. `APPROVED → FAILED` is the send-error path. `REPLIED`, `OPTED_OUT`, and `DO_NOT_CONTACT` are explicit manual states.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Server is up |
| GET | `/api/stats` | Dashboard and panel counts |
| GET | `/api/contacts` | Filterable contact list |
| POST | `/api/contacts` | Add or update a public contact |
| GET | `/api/contacts/lookup` | Which emails are already saved |
| GET | `/api/contacts/:id` | Contact plus outreach history |
| PATCH | `/api/contacts/:id` | Do-not-contact, opted out, or replied |
| DELETE | `/api/contacts/:id` | Delete the local record |
| GET/POST | `/api/templates` | List or create templates |
| PATCH/DELETE | `/api/templates/:id` | Edit or delete a template |
| POST | `/api/templates/preview` | Personalize and find missing variables |
| GET | `/api/outreach` | Drafts, approved, and sent messages |
| POST | `/api/outreach/:contactId/draft` | Create one Gmail draft |
| POST | `/api/outreach/:outreachId/approve` | Approve one draft |
| POST | `/api/outreach/:outreachId/send` | Send one approved draft |
| GET | `/api/gmail/status` | Connection and send limits |
| GET | `/api/gmail/drafts` | Drafts created by this app |
| GET | `/api/auth/google` | Start OAuth |
| GET | `/api/auth/google/callback` | OAuth redirect |
| GET | `/api/auth/status` | Connected account, no tokens |
| POST | `/api/auth/logout` | Revoke and delete local tokens |

GitHub pages may only call health, stats, contact lookup, and contact create. Approve, send, templates, and OAuth stay on localhost. Payloads are validated with zod. Rendered contact data is inserted as text, not HTML.

## Logs

Server logs use pino. Emails are masked (`j***@example.com`). OAuth tokens are redacted. Useful lines include `[Contact] Added`, `[Contact] Duplicate skipped`, `[Gmail] Draft created`, `[Gmail] Draft approved`, `[Gmail] Message sent`, `[Gmail] Send failed`, and `[Auth] Google OAuth connected`.

Set `LOG_LEVEL=info` in `.env`.

## Common errors

| What you see | What to do |
| --- | --- |
| Gmail is not connected. | Settings → Connect Gmail |
| Google authorization expired. Reconnect Gmail. | Connect again. Testing-mode tokens expire in 7 days |
| GitHub profile could not be checked. | Retry. GitHub may have rate-limited the page or changed the profile layout |
| Outreach server offline | Start `npm run dev`, then Retry |
| Draft creation failed. Nothing was sent. | The contact was not emailed. Check Gmail connection and the draft error |
| Daily send limit reached | Wait until the next local day, or lower the day's volume |
| Cooldown active | Wait for `MIN_SECONDS_BETWEEN_SENDS` |
| Message still contains unresolved template values | Fill the missing field or remove that variable |

## Known limitations

- Only an email GitHub actually renders on the profile page can be saved. Private emails, commit emails, and noreply addresses are out of scope.
- An unauthenticated or blocked profile fetch cannot see the sidebar. Use the script while logged in to GitHub.
- GitHub can change search or profile markup. The script uses stable hooks (`data-testid="results-list"`, `.search-title`, vcard email selectors) and shows a check error when the profile shell is missing.
- Gmail draft listing shows drafts this app created. It does not read the rest of the mailbox.
- Sending uses Gmail's draft-send API for the approved draft. If that draft was deleted in Gmail, send fails and nothing is marked sent unless Gmail returns a message id.
- One successful send per email is the default. Failed sends do not consume that attempt.
- The OAuth client secret must stay in `server/.env`. Do not paste it into Tampermonkey.
- This is a single-user local app. Do not expose port 3847 beyond your machine.

## Manual steps you still do

- Create the Google Cloud project, enable Gmail API, and add the redirect URI.
- Put the client id, client secret, and encryption key in `.env`.
- Click **Connect Gmail** once in the dashboard.
- Install Tampermonkey and the userscript.
- Approve and send each message yourself.
