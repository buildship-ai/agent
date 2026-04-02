# @buildship-ai/agent

A type-safe TypeScript SDK for [BuildShip](https://buildship.com) agents with
streaming support.

- 🔄 **Streaming-first** — real-time text, reasoning, tool calls & handoffs via
  SSE
- 🧩 **Client tools** — headless handlers, interactive widgets, pause/resume
- 📎 **Multimodal input** — send text, images & files in a single message
- ⚛️ **React bindings** — hooks & context for chat UIs with session management
- 💬 **Multi-turn** — session-based conversations with persistent history
- 🛑 **Abort** — cancel any streaming request mid-flight
- 🐛 **Inline debug info** — tool calls, reasoning, handoffs & errors as
  message parts
- 📦 **Zero extra deps** — native `fetch` + `ReadableStream`, only `zod` as a
  dependency

## Install

```bash
npm install @buildship-ai/agent
```

The package exposes two entry points:

```ts
import { ... } from "@buildship-ai/agent/core";   // Vanilla JS/TS — works anywhere
import { ... } from "@buildship-ai/agent/react";   // React hooks, context & components
```

---

# Core (`@buildship-ai/agent/core`)

The core module provides a class-based API that works in any JavaScript
environment — Node.js, browser, Edge Runtime, etc.

## Quick Start

```ts
import { BuildShipAgent, z } from "@buildship-ai/agent/core";

const agent = new BuildShipAgent({
  agentId: "YOUR_AGENT_ID",
  accessKey: "YOUR_ACCESS_KEY", // optional
  baseUrl: "https://your-project.buildship.run",
});

// Simple one-shot
const session = await agent.execute("Hello!", {
  onText: (text) => process.stdout.write(text),
  onComplete: (fullText) => console.log("\nDone:", fullText),
  onError: (err) => console.error(err),
});
```

## Multimodal Input

The `execute()` method accepts either a plain string or an array of content
parts. This lets you send text alongside images and files in a single message.

```ts
type AgentInput = string | ContentPart[];

type ContentPart = TextPart | ImagePart | FilePart;

type TextPart = { type: "text"; text: string };

// mimeType is optional — defaults to "image/png" if omitted.
// Images can often be inferred from the data URI prefix.
type ImagePart = { type: "image"; data: string; mimeType?: string };

// mimeType is required — files (CSV, PDF, JSON, etc.) need an explicit
// MIME type so the agent knows how to interpret the content.
type FilePart = {
  type: "file";
  data: string;
  mimeType: string;
  filename?: string;
};
```

The `data` field accepts three formats:

| Format     | Example                            | Prefix       |
| ---------- | ---------------------------------- | ------------ |
| HTTP URL   | `"https://example.com/photo.jpg"`  | `http(s)://` |
| Data URL   | `"data:image/png;base64,iVBOR..."` | `data:`      |
| Raw base64 | `"iVBORw0KGgo..."`                 | _(none)_     |

### Text-only (backward compatible)

```ts
await agent.execute("What is this?", callbacks);
```

### Image + text

```ts
await agent.execute(
  [
    { type: "text", text: "What's in this image?" },
    {
      type: "image",
      data: "https://example.com/photo.jpg",
      mimeType: "image/jpeg",
    },
  ],
  callbacks,
);
```

### File attachment

```ts
await agent.execute(
  [
    { type: "text", text: "Summarize this CSV" },
    {
      type: "file",
      data: "https://storage.example.com/report.csv",
      mimeType: "text/csv",
      filename: "report.csv",
    },
  ],
  callbacks,
);
```

## Multi-Turn Conversations

```ts
// First message returns a session
const session = await agent.execute("What is 2 + 2?", {
  onText: (t) => process.stdout.write(t),
  onComplete: () => console.log(),
});

// Continue with the same session ID
const continued = agent.session(session.getSessionId());
await continued.execute("Now multiply that by 3", {
  onText: (t) => process.stdout.write(t),
  onComplete: () => console.log(),
});
```

## Client Tools

Define tools the agent can invoke on the client side. Use **Zod schemas** for
type-safe parameter definitions:

```ts
import { BuildShipAgent, z } from "@buildship-ai/agent/core";

const agent = new BuildShipAgent({ agentId: "..." });

// Fire-and-forget tool
agent.registerClientTool({
  name: "show_notification",
  description: "Display a notification to the user",
  parameters: z.object({
    title: z.string().describe("Notification title"),
    message: z.string().describe("Notification body"),
  }),
  handler: (args) => {
    showNotification(args.title, args.message);
  },
});

// Blocking tool — agent pauses until result is returned
agent.registerClientTool({
  name: "get_location",
  description: "Get the user's current location",
  parameters: z.object({}),
  await: true,
  handler: async () => {
    const pos = await navigator.geolocation.getCurrentPosition();
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  },
});
```

### Pause & Resume (Manual)

For blocking tools without a handler, the agent pauses and you resume manually:

```ts
agent.registerClientTool({
  name: "confirm_action",
  description: "Ask the user to confirm an action",
  parameters: z.object({
    action: z.string().describe("The action to confirm"),
  }),
  await: true,
  // No handler — you handle it manually
});

const session = await agent.execute("Delete my account", {
  onText: (t) => process.stdout.write(t),
  onPaused: (toolName, args) => {
    console.log(`Agent paused for: ${toolName}`, args);
  },
});

if (session.isPaused()) {
  const tool = session.getPausedTool();
  // ... show confirmation UI, then resume:
  await session.resume(
    { confirmed: true },
    {
      onText: (t) => process.stdout.write(t),
    },
  );
}
```

### Scoping Tools to Specific Agents

In multi-agent setups, you can restrict a client tool to specific server-side
agents or subagents using `targetAgentIds`. When omitted, the tool is available
to all agents.

```ts
agent.registerClientTool({
  name: "admin_panel",
  description: "Show an admin-only panel",
  parameters: z.object({ section: z.string() }),
  handler: (args) => showAdminPanel(args.section),
  // Only the admin agent and supervisor agent can call this tool
  targetAgentIds: ["admin-agent-id", "supervisor-agent-id"],
});
```

## Abort

```ts
const session = agent.session(sessionId);

session.execute("Write a long essay...", {
  onText: (text) => {
    process.stdout.write(text);
    if (userCancelled) session.abort();
  },
});
```

## Stream Callbacks

```ts
interface StreamCallbacks {
  /** Called for each text chunk from the agent. */
  onText?: (text: string) => void;
  /** Called for each reasoning chunk (models with chain-of-thought). */
  onReasoning?: (delta: string, index: number) => void;
  /** Called when control is handed off to a sub-agent. */
  onAgentHandoff?: (agentName: string) => void;
  /** Called when a tool execution starts. */
  onToolStart?: (toolName: string, toolType: ToolType) => void;
  /** Called when a tool execution completes. */
  onToolEnd?: (toolName: string, result?: any, error?: string) => void;
  /** Called when agent pauses for a blocking client tool. */
  onPaused?: (toolName: string, args: any) => void;
  /** Called when the stream completes successfully. */
  onComplete?: (fullText: string) => void;
  /** Called if an error occurs during streaming. */
  onError?: (error: Error) => void;
  /** Called for every raw SSE event. Useful for debug panels. */
  onEvent?: (event: StreamEvent) => void;
}
```

## Core API Reference

### `BuildShipAgent`

| Method                                | Description                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `execute(input, callbacks, options?)` | Start a new conversation. `input` is `string \| ContentPart[]`. Returns `AgentSession`. |
| `session(sessionId)`                  | Continue an existing conversation. Returns `AgentSession`.                              |
| `registerClientTool(tool)`            | Register a client-side tool.                                                            |
| `unregisterClientTool(name)`          | Remove a registered tool.                                                               |

### `AgentSession`

| Method                                | Description                                          |
| ------------------------------------- | ---------------------------------------------------- |
| `execute(input, callbacks, options?)` | Send a message (`string \| ContentPart[]`).          |
| `resume(result, callbacks)`           | Resume after a blocking tool pause.                  |
| `isPaused()`                          | Check if waiting for a tool result.                  |
| `getPausedTool()`                     | Get paused tool info (`{ callId, toolName, args }`). |
| `getSessionId()`                      | Get the session ID.                                  |
| `abort()`                             | Cancel the current stream.                           |

### Stream Events

All events share a `meta` object with `executionId`, `sequence`, and `agentId`
(the ID of the agent that produced the event — changes after handoffs).

| Event Type        | Description                        | Data                                                              |
| ----------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `text_delta`      | Text chunk from the agent          | `string`                                                          |
| `reasoning_delta` | Chain-of-thought reasoning chunk   | `{ delta: string, index: number }`                                |
| `tool_call_start` | A tool execution started           | `{ callId, toolName, toolType, inputs?, serverName?, paused? }`   |
| `tool_call_end`   | A tool execution completed         | `{ callId, toolName, toolType, result?, error?, executionTime? }` |
| `agent_handoff`   | Control transferred to a sub-agent | `{ agentName: string }`                                           |

### Tool Types

```ts
type ToolType = "flow" | "node" | "mcp" | "client" | "builtin" | "agent";
```

---

# React (`@buildship-ai/agent/react`)

The React module provides hooks, context providers, and components for building
chat UIs with full session management, client tool support, and debug panels.

## Setup

Wrap your app (or the chat area) with `AgentContextProvider`:

```tsx
import { AgentContextProvider } from "@buildship-ai/agent/react";

function App() {
  return (
    <AgentContextProvider>
      <ChatPage />
    </AgentContextProvider>
  );
}
```

## `useAgent` Hook

The main hook for interacting with an agent. Manages messages, streaming,
and sessions.

```tsx
import { useAgent } from "@buildship-ai/agent/react";

function ChatPage() {
  const {
    messages, // Message[] — full conversation history
    inProgress, // boolean — true while streaming
    handleSend, // (input, options?) => Promise — send a message
    resumeTool, // (callId, result) => Promise — resume a paused tool
    abort, // () => void — cancel the current stream
    sessionId, // string — current session ID
    sessions, // Session[] — all sessions for this agent
    switchSession, // (sessionId?) => void — switch to a session (or create new)
    deleteSession, // (sessionId) => void — delete a session
    addOptimisticMessage, // (input) => void — add a user message immediately
  } = useAgent(
    "agent-id",
    "https://your-project.buildship.run/executeAgent/AGENT_ID",
    "access-key",
  );

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i} className={msg.role}>
          {msg.content}
        </div>
      ))}

      <button onClick={() => handleSend("Hello!")} disabled={inProgress}>
        Send
      </button>
    </div>
  );
}
```

### `handleSend` Options

```ts
handleSend(input: AgentInput, options?: {
  context?: Record<string, unknown>;  // Additional context passed to the agent
  skipUserMessage?: boolean;          // Don't add a user message to the conversation
});
```

`AgentInput` is `string | ContentPart[]` — see
[Multimodal Input](#multimodal-input).

### Text Modifiers

`useAgent` accepts optional modifier functions that transform streamed text
before it is stored in messages. This is useful for stripping thinking tags,
converting markup, or applying any real-time post-processing.

#### `textDeltaModifier`

Runs on **each incoming text chunk** before it is appended. Receives the raw
delta, the full text accumulated so far, and event metadata.

```tsx
const agent = useAgent(myAgent, {
  textDeltaModifier: (delta, fullText, meta) => {
    // Example: strip <think>…</think> tags from each chunk
    return delta.replace(/<\/?think>/g, "");
  },
});
```

#### `fullTextModifier`

Runs on the **accumulated full text** after every delta is appended. The return
value becomes the displayed text, while the unmodified accumulation is preserved
internally as `_rawText`.

```tsx
const agent = useAgent(myAgent, {
  fullTextModifier: (fullText, meta) => {
    // Example: render LaTeX-style math as Unicode
    return convertLatex(fullText);
  },
});
```

#### Using both together

When both modifiers are provided they **chain** in order:

```
raw delta → textDeltaModifier(delta) → accumulated text → fullTextModifier(accumulated) → display
```

`textDeltaModifier` acts as a per-chunk preprocessor; `fullTextModifier` acts as
a post-accumulation formatter on top of the already-modified text.

> **Note:** Both modifiers receive `meta.agentId`, which identifies the agent
> that produced the current event. In multi-agent setups, `fullTextModifier`
> only accumulates text from the **same agent's** trailing text group — text
> from earlier agents (before a handoff) is not included. If
> `textDeltaModifier` strips or transforms content, `fullTextModifier` will
> only see the already-modified accumulation — the original unmodified stream
> text is not preserved.

## `useAgentContext` Hook

An alternative to `useAgent` for multi-agent setups. Initializes agents
declaratively and shares state through context.

```tsx
import { useAgentContext } from "@buildship-ai/agent/react";

function ChatPage() {
  const agent = useAgentContext(
    "agent-id",
    "https://your-project.buildship.run/executeAgent/AGENT_ID",
    "access-key",
  );

  // Same return shape as useAgent
  const { messages, handleSend, inProgress, sessions, ... } = agent;
}
```

## Client Tools (React)

### `useClientTool` — Headless Tools

Register a tool that runs code without rendering any UI:

```tsx
import { useClientTool } from "@buildship-ai/agent/react";
import { z } from "@buildship-ai/agent/core";

function ChatPage() {
  // Fire-and-forget — runs handler, result is discarded
  useClientTool("agent-id", {
    name: "show_notification",
    description: "Display a notification to the user",
    parameters: z.object({
      title: z.string(),
      message: z.string(),
    }),
    handler: (inputs) => {
      toast(inputs.title, inputs.message);
    },
  });

  // Blocking tool — agent pauses, handler result is sent back
  useClientTool("agent-id", {
    name: "get_location",
    description: "Get the user's current GPS location",
    parameters: z.object({}),
    await: true,
    handler: async () => {
      const pos = await getCurrentPosition();
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    },
  });

  // ...
}
```

### `useClientTool` — Scoping to Specific Agents

Use `targetAgentIds` to restrict a tool to specific server-side agents or
subagents. The first parameter (`agentId`) controls which client-side agent
instance owns the registration; `targetAgentIds` controls which server-side
agents can actually call the tool.

```tsx
// This tool is registered on the "agent-id" client instance,
// but only the "support-agent" subagent on the server can use it.
useClientTool("agent-id", {
  name: "escalate_ticket",
  description: "Escalate a support ticket to a human",
  parameters: z.object({
    ticketId: z.string(),
    reason: z.string(),
  }),
  await: true,
  handler: async (inputs) => {
    return await escalateTicket(inputs.ticketId, inputs.reason);
  },
  targetAgentIds: ["support-agent-id"],
});
```

### `useClientTool` — Widget Tools

Register a tool that renders interactive UI inline in the conversation:

```tsx
import { useClientTool, ToolRenderer } from "@buildship-ai/agent/react";
import { z } from "@buildship-ai/agent/core";

function ChatPage() {
  const { messages } = useAgent("agent-id", agentUrl);

  // Register a widget tool with a render function
  useClientTool("agent-id", {
    name: "feedback_form",
    description: "Collects user feedback",
    parameters: z.object({
      question: z.string().describe("The feedback question"),
    }),
    await: true, // Agent pauses until user submits
    render: ({ inputs, submit, status, result }) => (
      <div>
        <p>{inputs.question}</p>
        {status === "pending" ? (
          <button onClick={() => submit({ answer: "Great!" })}>Submit</button>
        ) : (
          <p>✅ Submitted: {JSON.stringify(result)}</p>
        )}
      </div>
    ),
  });

  // Render messages with embedded widgets
  return (
    <div>
      {messages.map((msg) =>
        msg.parts?.map((part) => {
          if (part.type === "text") {
            return <p key={part.firstSequence}>{part.text}</p>;
          }
          if (part.type === "widget") {
            return (
              <ToolRenderer key={part.callId} agentId="agent-id" part={part} />
            );
          }
          return null;
        }),
      )}
    </div>
  );
}
```

### `useClientTool` — Combo Tools (Handler + Render)

When both `handler` and `render` are provided, the tool acts as a **widget that auto-executes**:

1. The widget renders immediately with `status: "pending"`
2. The handler runs automatically in the background
3. When the handler resolves, the widget updates to `status: "submitted"` with the `result`
4. If the handler throws, the widget updates to `status: "error"` with the `error` message
5. The agent auto-resumes with the handler's return value

This is ideal for async operations where you want to show progress and results
inline — e.g. cloning a project, running a migration, processing data.

```tsx
useClientTool("agent-id", {
  name: "run_migration",
  description: "Runs a database migration",
  parameters: z.object({
    migrationName: z.string(),
  }),
  await: true,
  handler: async (inputs) => {
    const result = await runMigration(inputs.migrationName);
    return { rowsAffected: result.count, duration: result.ms };
  },
  render: ({ inputs, status, result, error }) => (
    <div>
      <strong>{inputs.migrationName}</strong>
      {status === "pending" && <Spinner />}
      {status === "submitted" && (
        <p>✅ Done — {result.rowsAffected} rows in {result.duration}ms</p>
      )}
      {status === "error" && <p style={{ color: "red" }}>❌ {error}</p>}
    </div>
  ),
});
```

> **Note:** With combo tools, the `submit` callback in render props is a no-op
> since the handler provides the result automatically. The widget is purely
> for display.

### `ClientToolConfig`

```ts
interface ClientToolConfig {
  name: string; // Must match the tool name the agent knows
  description: string; // Description of what the tool does
  parameters: ZodSchema | Record<string, any>; // Zod schema or raw JSON Schema
  await?: boolean; // If true, agent pauses until result
  handler?: (inputs: any) => any | Promise<any>; // For headless tools or combo tools
  render?: (props: ClientToolRenderProps) => any; // For widget tools or combo tools
  targetAgentIds?: string[]; // If set, tool is only available to these agents/subagents
}
```

> **Tip:** You can provide both `handler` and `render` — see
> [Combo Tools](#useclienttool--combo-tools-handler--render) below.

### `ClientToolRenderProps`

```ts
interface ClientToolRenderProps<T = any> {
  inputs: T; // Parsed inputs from the agent
  submit: (result: any) => void; // Submit a result (only for await: true tools)
  status: "pending" | "submitted" | "error"; // Widget status
  result?: any; // Persisted result after submission
  error?: string; // Error message (only when status is "error")
}
```

## Messages & Parts

Messages can contain rich, interleaved content via `parts`:

```ts
type Message = {
  role: "user" | "agent";
  content: string; // Full text content
  parts?: MessagePart[]; // Rich content (text, widgets, tool calls, reasoning, etc.)
  executionId?: string; // Execution ID for this turn
  attachments?: Array<ImagePart | FilePart>; // Multimodal user message attachments
};

type MessagePart = {
  agentId?: string; // The agent that produced this part (changes after handoffs)
} & (
  | { type: "text"; text: string; firstSequence: number; lastSequence: number }
  | {
      type: "widget";
      toolName: string;
      callId: string;
      inputs: any;
      paused?: boolean;
      status?: "pending" | "submitted" | "error";
      result?: any;
      error?: string;
    }
  | {
      type: "tool_call";
      toolName: string;
      callId: string;
      toolType: ToolType;
      status: "progress" | "complete" | "error";
      inputs?: unknown;
      output?: unknown;
      error?: string;
      serverName?: string; // MCP server name
    }
  | { type: "reasoning"; reasoning: string; index?: number }
  | { type: "handoff"; agentName: string }
  | { type: "run_error"; message: string; code?: string }
);
```

Every part carries an optional `agentId` identifying which agent produced it.
In multi-agent (handoff) scenarios, parts within the same message may have
different `agentId` values — use this to group or label content by agent.

> **Tip:** When rendering messages, iterate over `msg.parts` instead of
> `msg.content` to get text, widgets, tool calls, reasoning, handoffs, and
> errors interleaved in chronological order.

## Sessions

Sessions are automatically persisted to local storage and synced across tabs.

```tsx
const { sessions, switchSession, deleteSession, sessionId } = useAgent(...);

// List all sessions
sessions.map((s) => (
  <button key={s.id} onClick={() => switchSession(s.id)}>
    {s.name} ({s.messages.length} messages)
  </button>
));

// Create a new session
switchSession(); // No argument = new session

// Delete a session
deleteSession(sessionId);
```

### Session Type

```ts
type Session = {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  name?: string;
};
```

## Inline Debug Info

Tool calls, reasoning, agent handoffs, and errors are all embedded directly in
the agent message's `parts` array — no separate debug state. Filter by `type`
to render them:

```tsx
const { messages } = useAgent(...);

// Get debug parts from an agent message
const debugParts = message.parts?.filter(
  (p) =>
    p.type === "tool_call" ||
    p.type === "reasoning" ||
    p.type === "handoff" ||
    p.type === "run_error",
);
```

See the [Message Parts](#message-parts) section above for the full type
definitions of each part.

## React API Reference

### Hooks

| Hook                                       | Description                                      |
| ------------------------------------------ | ------------------------------------------------ |
| `useAgent(agentId, agentUrl, accessKey?)`  | Main hook — messages, streaming, sessions        |
| `useAgentContext(agentId, agentUrl, key?)` | Context-based alternative for multi-agent setups |
| `useClientTool(agentId, config)`           | Register a client tool (headless or widget)      |

### Components

| Component                                   | Description                                        |
| ------------------------------------------- | -------------------------------------------------- |
| `<AgentContextProvider>`                    | Provides shared agent state (sessions)             |
| `<ToolRenderer agentId={id} part={part} />` | Renders a widget tool from a message part          |

### Utilities

| Export                                | Description                                                          |
| ------------------------------------- | -------------------------------------------------------------------- |
| `tryParseJSON(value)`                 | Safely parse a JSON string, returns parsed object or original string |
| `updateAgentMessageParts(msg, event)` | Append/merge parts into an agent message                             |

## Full Example

```tsx
import {
  AgentContextProvider,
  useAgent,
  useClientTool,
  ToolRenderer,
} from "@buildship-ai/agent/react";
import { z } from "@buildship-ai/agent/core";

const AGENT_ID = "my-agent";
const AGENT_URL = "https://my-project.buildship.run/executeAgent/my-agent";

function App() {
  return (
    <AgentContextProvider>
      <Chat />
    </AgentContextProvider>
  );
}

function Chat() {
  const { messages, handleSend, inProgress, resumeTool, abort } =
    useAgent(AGENT_ID, AGENT_URL);
  const [input, setInput] = useState("");

  // Register a widget tool
  useClientTool(AGENT_ID, {
    name: "poll",
    description: "Ask the user to vote on options",
    parameters: z.object({
      question: z.string(),
      options: z.array(z.string()),
    }),
    await: true,
    render: ({ inputs, submit, status }) => (
      <div>
        <p>{inputs.question}</p>
        {status === "pending" ? (
          inputs.options.map((opt) => (
            <button key={opt} onClick={() => submit({ vote: opt })}>
              {opt}
            </button>
          ))
        ) : (
          <p>✅ Vote recorded</p>
        )}
      </div>
    ),
  });

  const send = () => {
    if (!input.trim()) return;
    handleSend(input);
    setInput("");
  };

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i}>
          <strong>{msg.role}:</strong>
          {msg.parts?.map((part, j) => {
            if (part.type === "text") {
              return <span key={j}>{part.text}</span>;
            }
            if (part.type === "widget") {
              return <ToolRenderer key={j} agentId={AGENT_ID} part={part} />;
            }
            if (part.type === "tool_call") {
              return (
                <div key={j} style={{ opacity: 0.7, fontSize: "0.85em" }}>
                  🔧 {part.toolName}{" "}
                  {part.status === "progress"
                    ? "running..."
                    : part.status === "error"
                      ? `failed: ${part.error}`
                      : "✓"}
                </div>
              );
            }
            if (part.type === "reasoning") {
              return (
                <div key={j} style={{ fontStyle: "italic", opacity: 0.6 }}>
                  💭 {part.reasoning}
                </div>
              );
            }
            if (part.type === "handoff") {
              return (
                <div key={j}>→ Handed off to {part.agentName}</div>
              );
            }
            if (part.type === "run_error") {
              return (
                <div key={j} style={{ color: "red" }}>
                  ⚠️ {part.message}
                </div>
              );
            }
            return null;
          }) ?? msg.content}
        </div>
      ))}

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
      />
      <button onClick={send} disabled={inProgress}>
        Send
      </button>
      {inProgress && <button onClick={abort}>Stop</button>}
    </div>
  );
}
```

## License

MIT
