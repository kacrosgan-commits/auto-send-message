# Install the GitHub Outreach userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome, Edge, or Firefox.
2. Open Tampermonkey, choose **Create a new script**, and replace the template with the contents of `github-outreach.user.js`.
3. Save the script. `styles.css` documents the same rules; they are already inlined in the userscript so GitHub does not need the local server for styling.
4. Start the local server (see the main README), then open a GitHub user search such as `https://github.com/search?q=full+stack&type=users`.

The script only reads an email when GitHub renders it on `https://github.com/{username}`. It does not open commit history. If `http://localhost:3847` is down, public-email badges still appear and the panel says **Outreach server offline**.
