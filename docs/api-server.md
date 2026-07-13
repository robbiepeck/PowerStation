# Local API server

PowerStation can expose an installed model through an OpenAI-compatible HTTP API for applications
running on the same computer. The server is optional, disabled by default, and intentionally limited
to local inference.

## Enable the server

Open **Settings → Local API server** and select **Enable**.

When enabled:

- the server binds to `127.0.0.1`, never `0.0.0.0`;
- every request requires a generated bearer token;
- the default base URL is `http://127.0.0.1:4141/v1`;
- the port can be changed in Settings;
- requests appear in the Settings log with method, path, model, status, and duration.

Copy the token from Settings and pass it as `Authorization: Bearer <token>`. Select **Regenerate**
to revoke the current token and issue a replacement.

## Supported endpoints

| Method and path | Behaviour |
| --- | --- |
| `GET /v1/models` | Lists installed models. Each model ID is its filename. |
| `POST /v1/chat/completions` | Creates streaming or non-streaming chat completions. |
| `POST /v1/embeddings` | Creates embeddings with the bundled `nomic-embed-text-v1.5` model. |

The API implements the subset required by these workflows; it is not a complete implementation of
the OpenAI platform.

## Request examples

### cURL

```bash
curl http://127.0.0.1:4141/v1/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemma-4-E4B-it-Q4_K_M.gguf","messages":[{"role":"user","content":"Say hello in one word."}]}'
```

### Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:4141/v1",
    api_key="YOUR_TOKEN",
)

response = client.chat.completions.create(
    model="gemma-4-E4B-it-Q4_K_M.gguf",
    messages=[{"role": "user", "content": "Say hello in one word."}],
)

print(response.choices[0].message.content)
```

Use the exact model ID returned by `GET /v1/models` when selecting an installed model.

## Runtime behaviour

- **Requested model:** when the request names an installed model, PowerStation loads and uses it.
  An unknown model ID falls back to the model currently selected in the application.
- **Raw inference:** application system prompts, skills, projects, agents, retrieval, and MCP tools
  are not added. The calling application controls the request messages.
- **Serial execution:** API, chat, comparison, and scheduled inference share one worker and execute
  sequentially. Switching models requires a reload.
- **Conversation isolation:** an API request does not modify the active in-app chat session.
- **Admission control:** model and context requirements are checked before execution. Requests that
  do not fit return a clear error rather than loading unsafely.

## Security considerations

Loopback binding prevents direct access from other computers, but any local process can attempt to
connect to localhost. Keep the bearer token private and regenerate it if it may have been disclosed.

PowerStation does not provide TLS, remote authentication, user accounts, quotas, or public rate
limiting. Placing a reverse proxy or tunnel in front of the server changes its threat model; the user
is then responsible for transport encryption, authentication, access control, and abuse prevention.

The endpoint is inference-only and does not expose the agent harness. Tool permissions, previews,
and audit logs apply to interactive app chats, not to API requests.

See [Security](../SECURITY.md), the [threat model](../THREAT_MODEL.md), and
[Models and devices](models-and-devices.md).
