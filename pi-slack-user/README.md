# pi-slack-user

Minimal Slack user-context tools for Pi. It reads a Slack permalink and can post a confirmed thread reply using an official Slack User OAuth Token (`xoxp-...`).

No MCP client, daemon, Slack event listener, bot-channel invitations, desktop-session scraping, or Slack SDK dependency.

## Tools

| Tool                   | Behavior                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| `slack_read_url`       | Read a message and its thread from a normal Slack permalink              |
| `slack_post_reply_url` | Post a reply to a permalink after showing an interactive confirmation UI |

The `/slack-user` command validates the configured token and shows its Slack identity.

## Slack app setup

Create or reuse an internal app at <https://api.slack.com/apps>. Under **OAuth & Permissions**, add the permissions below as **User Token Scopes**, not Bot Token Scopes.

Read-only starting scopes:

```text
channels:history
groups:history
im:history
mpim:history
users:read
```

Add this when posting is desired:

```text
chat:write
```

`users:read` is optional for API access but recommended so transcripts show names instead of Slack user IDs. Add `files:read` later if file downloading is implemented; v0 only displays file metadata returned with messages.

Install or reinstall the app to the workspace after changing scopes, then copy the **User OAuth Token** beginning with `xoxp-`.

## Pi environment

Expose that token to Pi as:

```text
SLACK_USER_TOKEN=xoxp-...
```

In the dotfiles setup, store the token in 1Password, add only its `op://...` reference to `~/.pi/agent/env.op`, run `pi-secrets-refresh`, and restart Pi. Do not commit the token itself.

Verify after restarting Pi:

```text
/slack-user
```

## Usage

Paste a Slack message or thread permalink:

```text
Read this Slack thread: https://workspace.slack.com/archives/C0123ABC456/p1700000000123456
```

Posting is separate and explicit:

```text
Reply to this Slack thread with: "I reviewed this and agree with the proposed fix."
```

Pi shows the exact destination and message in a confirmation dialog before calling Slack. Posting refuses to run in non-interactive modes where confirmation is unavailable.

## Privacy and safety

- Slack content returned by a tool becomes part of the Pi conversation and can be sent to the configured model provider.
- Pi sessions may retain returned Slack text locally.
- The extension never logs or returns the OAuth token.
- No write occurs without an explicit `slack_post_reply_url` call and interactive confirmation.
- The extension does not request or use `chat:write.customize`; it relies on normal user-token authorship and Slack's standard app attribution.
