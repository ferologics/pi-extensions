# TODO

## Add ChatGPT Codex backend path support

Goal: allow `/deep-review` to run with ChatGPT Plus/Pro OAuth (`openai-codex`) by supporting the Codex responses endpoint in addition to OpenAI Platform API.

### TODO

- [ ] Add dual-path request logic in `index.ts`:
  - Platform API path: `https://api.openai.com/v1/responses`
  - Codex subscription path: `https://chatgpt.com/backend-api/codex/responses`
- [ ] Auto-detect token/source and pick endpoint + headers accordingly
- [ ] Keep current Platform API behavior fully intact
- [ ] Validate parameter compatibility across both paths (effort/summary/verbosity/model IDs)
- [ ] Decide whether Codex path should become default when OAuth token is present
- [ ] Add docs to `README.md` for auth + endpoint routing behavior
- [ ] Add smoke tests for both auth modes (API key + OAuth)

### Exit criteria

- [ ] `/deep-review` works with either:
  - `OPENAI_API_KEY` (Platform)
  - `openai-codex` OAuth credentials from `~/.pi/agent/auth.json`
- [ ] No regression in output format, cost reporting, or debug artifacts
- [ ] Clear failure messages when selected auth/token cannot access selected endpoint
