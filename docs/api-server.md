# Local API server

PowerStation can serve your running model as an **OpenAI-compatible HTTP endpoint** on this
machine, so anything that speaks the OpenAI API — your IDE assistant, a Python/JS script, another
app — can use your local model with a one-line `base_url` change, entirely offline. It's the
complement to the Ollama/LM Studio *import*: now PowerStation can be the thing others call.

## Turning it on

Settings → **Local API server** → *Enable*. It's **off by default**. When on:

- It binds to **`127.0.0.1` only** — never `0.0.0.0`, so nothing off this machine can reach it.
- It generates a **bearer token**. Copy it from Settings and send it as `Authorization: Bearer
  <token>`. **Regenerate** rotates the token and instantly revokes the old one.
- The base URL is `http://127.0.0.1:<port>/v1` (default port 4141, editable).
- Every request shows up in a live log in Settings (method, path, model, status, duration).

## Endpoints

| Method & path | What it does |
| --- | --- |
| `GET /v1/models` | Lists your installed models; each `id` is the model's file name. |
| `POST /v1/chat/completions` | Chat completions, **streaming** (SSE) and non-streaming. |
| `POST /v1/embeddings` | Embeddings from the bundled `nomic-embed-text-v1.5` model. |

### Example

```bash
curl http://127.0.0.1:4141/v1/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "gemma-4-E4B-it-Q4_K_M.gguf",
       "messages": [{"role": "user", "content": "Say hello in one word."}]}'
```

With the OpenAI SDK, point it at the server:

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:4141/v1", api_key="YOUR_TOKEN")
client.chat.completions.create(model="gemma-4-E4B-it-Q4_K_M.gguf",
                               messages=[{"role": "user", "content": "Hi"}])
```

## How it behaves (by design)

- **Token required.** Any process on your Mac can reach localhost, so the token is what stops other
  apps using your model unprompted. Keep it private.
- **Honours the requested model.** If the request's `model` matches an installed model it's used
  (loading it if needed); otherwise the app's selected model answers. Because only one model loads
  at a time, switching models between requests costs a reload.
- **Raw inference.** The endpoint is just the model: your app's system prompt, skills, and MCP
  tools are **not** applied — the caller controls everything through the messages it sends, exactly
  like the real OpenAI API. (Tool calling over the API may come in a later version.)
- **One at a time.** The worker holds a single model and chat sequence, so requests — and any
  in-app chat — are serialized rather than run in parallel. An API request never disturbs your
  in-app conversation (it runs against an isolated copy of the session).
- **Still admission-controlled.** Each request runs the same fit check as in-app chat, so an
  over-large model or context returns a clear `422` instead of swapping your machine.

## What it is not

- **Not exposed off-machine.** There is no option to bind to a public interface. If you need remote
  access, put your own reverse proxy in front — deliberately your call, not the app's.
- **Not the agent harness.** Permission prompts, skills, and audit logging live in the app's chat;
  the API path is bare inference.

*Related: [Agent harness](agent-harness.md) · [Models & devices](models-and-devices.md).*
