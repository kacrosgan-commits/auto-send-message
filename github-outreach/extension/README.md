# Install the GitHub Outreach Chrome extension

1. Start the local server (see the main README) and run `npx prisma migrate deploy` in `github-outreach/server`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose this `chrome` folder.
5. Open a GitHub user search while signed in, such as `https://github.com/search?q=full+stack&type=users`.

The extension reads an email only when GitHub shows it on `https://github.com/{username}`. It does not open commit history.

**Collect public emails** walks the Next pages of the current user search until it saves the number you set (1–500), you click **Stop**, or the search runs out. GitHub lists about 1,000 people for one search.

**Seconds between sends** and **Max per day** are stored by the local server. **Send collected** drafts, approves, and sends the people saved in that collect run, waiting the number of seconds you set between each message.

**Send test** sends one copy of the selected template to the address in **Test inbox**.
