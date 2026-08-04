# Cantarella Implementation Plan

> Historical strategy notes appear first. The **Canonical Release Plan** later in
> this file defines the current V1/V1.5/V2/V3 boundaries and supersedes any older
> version placement that conflicts with it.

## Goal

Build Cantarella in layers:

1. Make V1 trustworthy
2. Complete the real MVP loop
3. Add the "alive" layer
4. Add agency carefully

The most important principle is that memory policy matters more than new surface features. A personal assistant that remembers badly will feel worse than one that remembers less.

---

## Layer 1: Make V1 Trustworthy

### 1. Lock the chat pipeline

- Keep the recent-window plus long-term-memory split.
- Allow only one active send per user.
- Save user message, generate reply, save assistant reply, then sync memory.
- Keep proactive systems separate from normal chat turns.

### 2. Stabilize the model layer

- Use `deepseek/deepseek-v4-flash` with the tested adapter prompt.
- Move model config into env:
  - `MODEL_ID`
  - `MODEL_TEMPERATURE`
  - `MODEL_MAX_TOKENS`
- Keep `SOUL` separate from the model-specific adapter prompt.

### 3. Fix memory architecture first

Create explicit memory types instead of treating everything as one vector note pool.

Suggested types:

- `profile`
  Stable facts: preferences, relationships, traits, habits
- `state`
  Temporary context: stressed, sleep-deprived, exam week
- `situation`
  Ongoing arcs: conflict, manager issue, job hunt, current project
- `goal`
  Long-running goals and commitments
- `event`
  Important past events worth remembering

Each memory should eventually have:

- `id`
- `user_id`
- `type`
- `content`
- `source_message_id`
- `importance_score`
- `confidence_score`
- `last_reinforced_at`
- `expires_at` for temporary/state items
- `status` such as `active`, `superseded`, `archived`

### 4. Replace raw semantic memory with memory policy

Implement these rules:

- Only write memory if it is stable, repeated, emotionally important, or operationally useful.
- Do not store filler chatter.
- Prefer updating existing memory over creating near-duplicates.
- Corrections should override old memory instead of sitting beside it.
- Temporary state should expire automatically.

### 5. Improve retrieval

Current retrieval is too similarity-only.

Use ranking based on:

- semantic similarity
- importance score
- recency or reinforcement
- memory type priority

Suggested retrieval order:

- `state`
- `situation`
- `goal`
- `profile`
- `event`

Keep retrieval tight:

- `3-8` items max into prompt
- short compressed snippets, not raw memory dumps

---

## Layer 2: Build the Real V1 Product Loop

### 6. Finalize conversation memory

- Keep the last `50` messages for now.
- Add a later compression trigger for older history.
- Do not keep replaying huge history forever.

### 7. Reminders and cron jobs

Implement reminders next because they are deterministic and useful.

- natural-language reminder creation
- parsed schedule storage
- scheduler job for due reminders
- reminders routed through Cantarella voice
- suppression if user is actively chatting

### 8. Heartbeat and proactive messages

Only after reminders work.

Heartbeat needs:

- min and max interval
- quiet hours
- suppression during active chat
- suppression if an unread proactive exists
- separate proactive message type in DB

Inputs for proactive generation should use:

- current state memories
- inactivity
- goals or reminders if relevant
- not random check-ins

### 9. Reply detection

- Mark proactive messages as replied or unreplied.
- Suppress future nudges until state changes.
- Distinguish between:
  - reply to proactive
  - unrelated new message

### 10. Daily digest

Add after reminders and heartbeat.

Input sources:

- reminders due today
- tasks or goals
- current state
- calendar later in V3

Output:

- short morning digest in Cantarella voice

---

## Layer 3: Build the V2 "Alive" Layer

### 11. Mood and context state

This should be structured state, not generic vector memory.

Examples:

- stress high
- exam week
- sleep bad
- socially withdrawn
- focused mode

State should be:

- inferred
- manually settable later
- expiring or refreshable

### 12. Intent classifier

Keep it lightweight.

Suggested classes:

- vent
- task
- question
- casual
- vulnerable
- self-destructive
- planning

Use it to shape:

- retrieval priority
- response length
- tone intensity
- proactive suppression

### 13. Conversation summarizer

This is one of the highest-value additions.

Background job should:

- summarize older turns into memory candidates
- detect corrections
- detect repeated patterns
- separate ongoing situations from stable facts

### 14. Self-improving memory

When the user corrects the assistant:

- mark prior memory as wrong or superseded
- increase priority of correction memory
- optionally log assistant failure reason

### 15. Per-user SOUL

Do not clone the entire soul prompt for each user.

Use structured persona config:

- preferred name
- tolerated sharpness
- warmth level
- humor level
- frequency of endearments
- phrase boundaries

### 16. Smart notification learning

Track:

- when proactive messages are opened
- when replied to
- when ignored

Use that to adapt:

- heartbeat windows
- preferred times
- suppression logic

---

## Layer 4: Build V3 Agency Carefully

### 17. Calendar sync

Use calendar as structured context, not freeform memory.

Calendar should feed:

- morning digest
- focus mode
- reminder planning
- proactive suggestions

### 18. Exam or focus mode

Trigger by:

- manual toggle
- calendar events
- repeated inferred signals

It should change:

- tone
- proactive frequency
- what gets suppressed

### 19. Goal tracking

Goals should be structured objects:

- title
- why it matters
- target date
- status
- check-in cadence
- next suggested step

Do not bury goals in generic vector memory.

### 20. Web search

Add only after core memory is strong.

Use for:

- up-to-date facts
- user-requested research
- external information

Do not make it a crutch for ordinary chat.

### 21. Proactive task suggestions

Should depend on:

- goals
- reminders
- calendar
- current state
- recent inactivity

### 22. Dynamic morning briefing

This is synthesis, not just another reminder.

Sources:

- calendar
- reminders
- goals
- unresolved situations
- current mood or state

---

## Concrete Build Order

If building from today, use this order:

1. Clean up model config and stabilize `deepseek-v4-flash`
2. Refactor memory schema into typed memories with scores and expiry
3. Rebuild memory write and update logic with dedupe and correction handling
4. Rebuild retrieval ranking using similarity plus importance plus type
5. Add conversation summarizer job
6. Finish reminders and scheduler
7. Add proactive heartbeat with suppression rules
8. Add reply detection
9. Add daily digest
10. Add mood and context state
11. Add intent classifier
12. Add self-improving memory
13. Add per-user SOUL config
14. Add smart notification learning
15. Add calendar sync
16. Add focus mode
17. Add goal tracking
18. Add proactive task suggestions
19. Add dynamic morning briefing
20. Add web search last

---

## Suggested Backend Domain Split

Split backend responsibilities into:

- `chat`
  send message, recent history, model response
- `memory`
  memory types, write policy, retrieval, correction, summarizer
- `proactive`
  heartbeat, reply detection, digests, suppression
- `scheduling`
  reminders, cron jobs, later calendar logic
- `state`
  mood/context state, user preferences, per-user persona
- `agency`
  goals, calendar, search, suggestions

---

## What Not To Do Yet

- Do not add more "smart" features before fixing memory policy.
- Do not store everything as vector memory.
- Do not let proactive messages become generic engagement bait.
- Do not overbuild tool use before memory is trustworthy.
- Do not merge persona, state, goals, and factual memory into one blob.

---

## Best Immediate Next Task

The highest-impact next task is:

- implement typed memory plus memory policy plus better retrieval

That is the backbone for almost everything in V2 and V3.

---

## Integration Strategy

The app should not require users to connect everything on day one.

Core principle:

- useful with zero integrations
- better with one or two integrations
- richer over time if the user chooses deeper access

### Default mode

No external connections required.

Sources of context:

- chat history
- long-term memory
- reminders
- internal app usage
- mood/state inference from app behavior

The assistant should already feel useful here.

### Enhanced mode

Opt-in context sources for better awareness.

Examples:

- calendar
- email
- one messaging source such as Telegram
- tasks or notes

Purpose:

- better summaries
- better prioritization
- better morning/night context
- better awareness of real obligations

### Life-aware mode

Broader context access, still not "full autonomous agent."

Examples:

- multiple messaging sources
- calendar
- email
- tasks
- notes
- selected social or communication channels if the user wants them

Purpose:

- "what happened while I was away?"
- "what matters today?"
- "who messaged me while I was asleep?"
- awareness of ongoing pressure from real life systems

This should remain optional.

---

## Agency Ladder

Agency should be explicit, user-triggered, and clearly explained.

The assistant should have four levels the user can choose from.

### Level 1: Chat + Memory

What it can do:

- chat
- remember
- summarize
- plan
- remind

What it cannot do:

- read external systems
- modify external systems

This is the safest default.

### Level 2: Awareness

What it can do:

- read selected external systems
- summarize messages, schedule, tasks, or events
- answer awareness questions like:
  - who messaged me?
  - what changed today?
  - what should I care about?

What it cannot do:

- send
- edit
- delete
- modify third-party data

This is read-only mode.

### Level 3: Draft + Bounded Actions

What it can do:

- draft replies
- create reminders
- create tasks
- create notes
- suggest calendar items
- take narrow low-risk actions

What it should still not do freely:

- delete data
- bulk modify things
- send high-risk outbound actions without approval

This is "agentic enough to help" mode.

### Level 4: Full Agentic

What it can do:

- send
- edit
- archive
- make broader changes across connected systems

Rules for this level:

- must be explicitly enabled by user
- must be visibly explained
- should still require approval for destructive or high-risk actions
- all actions should be logged
- reversible actions are preferred

This is the highest-trust mode and should come last.

---

## Permission Model

Permissions should be separated by risk, not just by connector.

### Read-only

- read messages
- read calendar
- read tasks
- read notes

### Draft-only

- draft replies
- draft reminders
- draft plans

### Safe writes

- create reminder
- create task
- create note
- add draft calendar item

### Medium-risk writes

- send message or email
- mark task complete
- archive message

### High-risk actions

- delete messages
- delete notes/tasks/events
- bulk modification
- account-level changes

Recommendation:

- Levels 1-2 should avoid write access
- Level 3 should allow only narrow safe writes
- Level 4 can allow broader action, but destructive actions should still need explicit approval

---

## Product Philosophy

The goal is not "connect your whole life first."

The goal is:

- useful first
- trusted next
- integrated later

This should feel like progressive intimacy:

1. useful with chat alone
2. more helpful with a little context
3. deeply aware if the user chooses
4. more agentic only when trust has already been earned


# Canonical Release Plan

If V1 were designed from scratch, I would keep it focused on one complete loop:

> Ian opens the messaging app, talks to Cantarella, she responds through DeepSeek Thought → Aion Voice, remembers the right things, and reliably reminds him later.

Everything in V1 should support that loop. No heartbeat, calendar, goals, digest, BYOK, or native integrations yet.

## V1 architecture

```text
Capacitor/Web chat UI
        ↓
REST API for commands and history
        +
SSE connection for typing, bubbles, and status updates
        ↓
Conversation service
        ↓
Context builder
        ↓
DeepSeek Thought JSON
        ↓
Optional reminder command
        ↓
Aion Voice
        ↓
Individual Cantarella message bubbles
        ↓
Durable memory/summarization jobs
```

## Standard API format

Successful response:

```json
{
  "data": {}
}
```

Failed response:

```json
{
  "error": {
    "code": "TURN_FAILED",
    "message": "Cantarella couldn't respond.",
    "retryable": true
  }
}
```

Use UUIDs or ULIDs instead of auto-incremented public IDs.

# 1. Authentication and user bootstrap

### API

```http
GET /api/v1/me
```

Response:

```json
{
  "data": {
    "id": "usr_123",
    "name": "Ian",
    "email": "ian@example.com",
    "timezone": "Asia/Bangkok",
    "conversationId": "con_123",
    "onboardingComplete": true
  }
}
```

### Flow

1. Capacitor/web app sends Auth0 JWT.
2. Backend validates it.
3. Backend finds the user by unique Auth0 subject.
4. If new, it atomically creates:
   - User
   - Default settings
   - Default Cantarella persona
   - Primary conversation
5. Backend returns the user and permanent conversation ID.

There should be one primary Cantarella conversation—not a “new chat” system.

# 2. User settings

### API

```http
GET /api/v1/me/settings
PATCH /api/v1/me/settings
```

Request:

```json
{
  "timezone": "Asia/Bangkok",
  "quietHoursStart": "02:00",
  "quietHoursEnd": "08:00",
  "notificationsEnabled": true
}
```

Response:

```json
{
  "data": {
    "timezone": "Asia/Bangkok",
    "quietHoursStart": "02:00",
    "quietHoursEnd": "08:00",
    "notificationsEnabled": true,
    "updatedAt": "2026-08-01T12:00:00Z"
  }
}
```

### Flow

1. Validate timezone and time format.
2. Update settings.
3. Invalidate cached user context.
4. Scheduler immediately uses the updated timezone/quiet hours.

Timezone belongs to the user. It must never be hardcoded in model code.

# 3. Per-user Cantarella personality

### API

```http
GET /api/v1/me/persona
PATCH /api/v1/me/persona
```

Request:

```json
{
  "name": "Cantarella",
  "customStyle": "blunt, teasing, protective, lightly mommy-like, occasionally seductive",
  "preferredUserName": "Ian",
  "endearmentPreference": "rare",
  "boundaries": [
    "never use emojis",
    "don't act like a therapist"
  ]
}
```

Response:

```json
{
  "data": {
    "name": "Cantarella",
    "customStyle": "blunt, teasing, protective, lightly mommy-like, occasionally seductive",
    "preferredUserName": "Ian",
    "endearmentPreference": "rare",
    "boundaries": [
      "never use emojis",
      "don't act like a therapist"
    ],
    "version": 3
  }
}
```

### Flow

1. User configures Cantarella outside the conversation.
2. Backend validates field lengths and prohibited prompt-control content.
3. Persona receives a new version.
4. Every later Aion request uses:
   - Base Cantarella identity
   - Current user persona
   - Current Thought JSON
5. Old messages remain unchanged.

Allow a freeform style field. Don’t lock users into a small enum.

# 4. Primary conversation

### API

```http
GET /api/v1/conversations/primary
```

Response:

```json
{
  "data": {
    "id": "con_123",
    "title": "Cantarella",
    "lastMessageAt": "2026-08-01T12:00:00Z",
    "unreadCount": 0
  }
}
```

This gives the app a stable thread to open every time.

# 5. Message history

### API

```http
GET /api/v1/conversations/con_123/messages?before=msg_500&limit=50
```

Response:

```json
{
  "data": {
    "messages": [
      {
        "id": "msg_498",
        "turnId": "turn_200",
        "sender": "user",
        "content": "yo",
        "messageKind": "chat",
        "source": "android",
        "partIndex": 0,
        "status": "sent",
        "replyToMessageId": null,
        "createdAt": "2026-08-01T11:59:00Z"
      },
      {
        "id": "msg_499",
        "turnId": "turn_200",
        "sender": "assistant",
        "content": "hey",
        "messageKind": "chat",
        "source": "system",
        "partIndex": 0,
        "status": "delivered",
        "replyToMessageId": null,
        "createdAt": "2026-08-01T11:59:02Z"
      }
    ],
    "nextCursor": "msg_498",
    "hasMore": true
  }
}
```

### Flow

1. App requests the newest page.
2. Backend returns messages in chronological display order.
3. Scrolling upward requests older pages.
4. The database stores the complete history.
5. Model context uses a separate token-budgeted selection—not the pagination limit.

# 6. Send message and generate reply

### API

```http
POST /api/v1/conversations/con_123/messages
```

Request:

```json
{
  "clientMessageId": "019123-client-generated-uuid",
  "content": "i'm avoiding the portfolio thing again",
  "source": "android",
  "replyToMessageId": null
}
```

Immediate `202 Accepted` response:

```json
{
  "data": {
    "turn": {
      "id": "turn_201",
      "status": "queued"
    },
    "message": {
      "id": "msg_500",
      "clientMessageId": "019123-client-generated-uuid",
      "sender": "user",
      "content": "i'm avoiding the portfolio thing again",
      "status": "sent",
      "createdAt": "2026-08-01T12:00:00Z"
    }
  }
}
```

### Flow

1. UI immediately renders an optimistic user bubble.
2. Backend validates:
   - Authentication
   - Conversation ownership
   - Content length
   - `clientMessageId`
3. Unique `clientMessageId` prevents duplicate messages after retries.
4. Backend creates:
   - User message
   - Turn with `queued` status
   - Durable generation job
5. API returns immediately.
6. Worker marks turn `thinking`.
7. UI receives a typing event.
8. Context builder loads persona, history, summary, memories, and local time.
9. DeepSeek produces Thought JSON.
10. Aion produces newline-separated text.
11. Every non-empty line becomes an individual assistant message.
12. Assistant bubbles are persisted with the same `turnId` and ordered using `partIndex`.
13. Turn becomes `completed`.
14. Memory processing is queued separately.

The API should not wait synchronously for both models.

# 7. Real-time conversation events

Use Server-Sent Events initially. It is simpler than full WebSockets and supports the required server-to-client updates.

### API

```http
GET /api/v1/conversations/con_123/events
Accept: text/event-stream
```

Events:

```text
event: turn.status
data: {"turnId":"turn_201","status":"thinking"}

event: typing.started
data: {"conversationId":"con_123","sender":"assistant"}

event: message.created
data: {"message":{"id":"msg_501","sender":"assistant","content":"yeah","partIndex":0}}

event: message.created
data: {"message":{"id":"msg_502","sender":"assistant","content":"you know which one you're avoiding","partIndex":1}}

event: typing.stopped
data: {"conversationId":"con_123","sender":"assistant"}

event: turn.completed
data: {"turnId":"turn_201"}
```

### Flow

1. App opens one authenticated SSE connection.
2. Backend publishes typing and message events.
3. Each Aion newline becomes a persisted message and an event.
4. Reconnecting clients fetch missed history through REST.
5. SSE is not the source of truth; the database is.

# 8. DeepSeek Thought pass

This is internal and has no public endpoint.

Expected result:

```json
{
  "intent": "task",
  "emotionalState": "avoidant but self-aware",
  "knownFacts": [
    "the user is avoiding portfolio work"
  ],
  "unknowns": [
    "whether anything else is time-sensitive"
  ],
  "decision": "directly identify the avoided work",
  "requiredMeaning": [
    "acknowledge that the user already sees the pattern",
    "identify the portfolio work as the priority",
    "avoid shaming"
  ],
  "voiceDirection": {
    "energy": "low",
    "warmth": "medium",
    "directness": "high",
    "length": "short"
  },
  "questionRequired": false,
  "memorySignals": [],
  "toolRequest": null
}
```

### Inputs

- Current user message
- Recent token-budgeted history
- Conversation summary
- Retrieved memories
- Current time in the user’s timezone
- Available V1 tools
- Core behavioral judgment rules

### Requirements

- Strict schema validation
- No near-final prose
- Unknowns must be explicit
- Required meaning cannot be omitted
- Intent classification happens here
- Suggested length is guidance, not a hard word limit

# 9. Aion Voice pass

Internal only.

### Inputs

- Base Cantarella identity
- User persona
- DeepSeek Thought JSON
- Relevant recent conversation
- Exact user message

### Expected raw result

```text
yeah you see it
the portfolio thing is still the one you're trying not to touch
start there
```

### Flow

1. Validate that the Thought result exists.
2. Send Thought JSON and persona to Aion.
3. Aion returns plain text only.
4. Split on newline.
5. Trim and discard empty lines.
6. Persist each line as a separate message.
7. Preserve the original raw model result in `model_runs` for debugging.
8. Do not expose model details in the normal chat UI.

# 10. Failed turn and retry

### API

```http
POST /api/v1/turns/turn_201/retry
```

Response:

```json
{
  "data": {
    "turnId": "turn_202",
    "retryOfTurnId": "turn_201",
    "status": "queued"
  }
}
```

Failure SSE event:

```text
event: turn.failed
data: {
  "turnId": "turn_201",
  "code": "VOICE_MODEL_TIMEOUT",
  "retryable": true
}
```

### Flow

1. Mark the original turn failed.
2. Keep the user’s message.
3. UI shows a normal failed-send/retry state.
4. Retry creates a new generation attempt without duplicating the user message.
5. Store model/provider failure details internally.

# 11. Long-term memory

### API

```http
GET /api/v1/memories?type=profile&status=active
```

Response:

```json
{
  "data": {
    "memories": [
      {
        "id": "mem_123",
        "type": "profile",
        "content": "Ian prefers blunt feedback over reassurance.",
        "importance": 85,
        "confidence": 95,
        "sourceMessageId": "msg_400",
        "userConfirmed": false,
        "status": "active",
        "expiresAt": null,
        "updatedAt": "2026-08-01T10:00:00Z"
      }
    ]
  }
}
```

### Background flow

1. Completed conversation turn creates a durable memory job.
2. Memory policy examines user-authored evidence.
3. It proposes:
   - None
   - Add
   - Reinforce
   - Update
   - Supersede
4. Validate the proposal using a strict schema.
5. Search existing memories for duplicates or contradictions.
6. Write relational record and vector in one durable process.
7. Never treat Cantarella’s own statement as proof of a user fact.
8. Temporary state memories receive expiry.
9. Every memory retains source provenance.

Use one relational/vector store if possible so memory writes do not become a cross-service consistency problem.

# 12. Memory correction and deletion

### APIs

```http
PATCH /api/v1/memories/mem_123
DELETE /api/v1/memories/mem_123
```

Correction request:

```json
{
  "content": "Ian likes direct feedback but not when he is exhausted.",
  "type": "profile",
  "userConfirmed": true
}
```

Response:

```json
{
  "data": {
    "memory": {
      "id": "mem_123",
      "content": "Ian likes direct feedback but not when he is exhausted.",
      "type": "profile",
      "userConfirmed": true,
      "status": "active"
    }
  }
}
```

### Flow

1. User edits or removes a memory from settings.
2. User-authored correction overrides model confidence.
3. Recompute the embedding.
4. Record a revision/audit entry.
5. Invalidate memory-context cache.
6. Deleted or superseded memories stop being retrieved immediately.

# 13. Conversation summarization

No public creation endpoint. It is a background job.

### Trigger

- Unsummarized conversation exceeds a token threshold.
- A sufficient number of turns has accumulated.
- A meaningful conversation segment appears complete.

### Stored result

```json
{
  "conversationId": "con_123",
  "fromMessageId": "msg_100",
  "toMessageId": "msg_250",
  "summary": "Ian was preparing his portfolio while avoiding the case-study write-up...",
  "openSituations": [
    "portfolio case study remains unfinished"
  ],
  "createdAt": "2026-08-01T12:00:00Z"
}
```

### Flow

1. Background worker claims a summary range.
2. Summarizer compresses events without imitating Cantarella’s voice.
3. Summary is stored separately from memories.
4. Memory candidates go through the normal memory-policy process.
5. Context builder uses:
   - Recent messages
   - Latest relevant summary
   - Retrieved long-term memories

# 14. Reminders

Reminders can be created directly through the settings UI or conversationally.

### Direct APIs

```http
POST /api/v1/reminders
GET /api/v1/reminders
PATCH /api/v1/reminders/rem_123
DELETE /api/v1/reminders/rem_123
```

Request:

```json
{
  "title": "Send the client update",
  "scheduledFor": "2026-08-02T09:00:00+07:00",
  "timezone": "Asia/Bangkok",
  "recurrence": null
}
```

Response:

```json
{
  "data": {
    "reminder": {
      "id": "rem_123",
      "title": "Send the client update",
      "scheduledFor": "2026-08-02T02:00:00Z",
      "timezone": "Asia/Bangkok",
      "status": "scheduled",
      "recurrence": null
    }
  }
}
```

### Conversational flow

User:

> remind me tomorrow morning to send the client update

DeepSeek Thought:

```json
{
  "toolRequest": {
    "name": "create_reminder",
    "arguments": {
      "title": "Send the client update",
      "scheduledForLocal": "2026-08-02T09:00:00",
      "timezone": "Asia/Bangkok"
    }
  }
}
```

Backend:

1. Validates the requested time.
2. Creates the reminder.
3. Gives the tool result to Aion.
4. Aion replies naturally:

```text
got it
tomorrow at nine
```

If “morning” has no configured meaning, Cantarella asks for a time instead of guessing.

# 15. Reminder delivery

### Internal flow

1. Durable worker finds a due reminder.
2. Atomically marks it as being processed.
3. Generates Cantarella’s wording from a structured reminder event.
4. Stores the resulting message in the primary conversation with:
   - `messageKind: reminder`
   - `source: system`
   - `reminderId`
5. Publishes a message event through SSE.
6. Records delivery success/failure.
7. Reschedules recurring reminders safely.

A due reminder should appear as a normal Cantarella message inside the same conversation.

# Minimum V1 database domains

You need these—not the current pile of loosely connected tables:

- `users`
- `user_settings`
- `personas`
- `conversations`
- `messages`
- `turns`
- `model_runs`
- `conversation_summaries`
- `memories`
- `memory_revisions`
- `reminders`
- `jobs` or job-queue storage

Every table needs proper primary keys, foreign keys, timestamps, indexes, and appropriate unique constraints.

# Explicitly not in V1

- Heartbeat
- Silence detection
- Mood inference
- Goal tracking
- Daily digest
- Weekly recap
- Calendar
- Focus mode
- Web search
- Proactive suggestions
- Smart notification learning
- Capacitor packaging and mobile push notifications
- Message response feedback
- BYOK
- Telegram
- Broad agency
- Android/iOS feature divergence
- Attachments and voice notes

That is the complete from-scratch V1: one reliable messaging conversation, two-pass personality, trustworthy memory, and reminders.

# V1.5: Mobile Enablement

V1.5 has one purpose:

> Take the completed V1 Messenger-style conversation and make it work reliably as an installed Android/iOS app.

It does not add intelligence. DeepSeek Thought, Aion Voice, memory, reminders, and conversation behavior remain exactly as designed in V1.

## V1.5 architecture

```text
Existing web messaging UI
        ↓
Shared Capacitor application
        ↓
Android APK / sideloaded iOS app
        ↓
Existing V1 REST API + SSE
        ↓
Device registration and push delivery
```

There is still:

- One permanent Cantarella conversation
- One shared message history
- One backend
- One frontend codebase
- No separate "mobile Cantarella"
- No native redesign
- No visible AI interface

## 1. Shared Capacitor application

Capacitor wraps the existing web application.

It provides access to:

- Android and iOS builds
- Native app lifecycle events
- Secure authentication storage
- Push notifications
- Deep links
- Network status
- Keyboard and safe-area handling
- Native back-button behavior

The web UI remains the source of truth. Platform-specific code should be limited to a thin native integration layer.

### Startup flow

```text
Application opens
→ Capacitor initializes native plugins
→ restore Auth0 session
→ call GET /api/v1/me
→ obtain permanent conversation ID
→ load recent message history
→ connect to SSE
→ register device and push token
→ show the existing Messenger interface
```

## 2. Device identity

Every installation generates a random persistent `deviceId`.

This identifies an installation—not the human user.

Example:

```json
{
  "deviceId": "dev_01JXYZ",
  "platform": "android",
  "deviceName": "Ian's phone",
  "appVersion": "1.1.0"
}
```

The device ID should survive normal application updates. Reinstalling the app may create a new one.

### API

```http
POST /api/v1/devices
```

Request:

```json
{
  "deviceId": "dev_01JXYZ",
  "platform": "android",
  "deviceName": "Ian's phone",
  "appVersion": "1.1.0"
}
```

Response:

```json
{
  "data": {
    "id": "dev_01JXYZ",
    "platform": "android",
    "registered": true,
    "lastSeenAt": "2026-08-02T12:00:00Z"
  }
}
```

### Flow

1. App creates a device ID during its first launch.
2. App stores it locally.
3. User authenticates.
4. Backend associates the device with that authenticated user.
5. Future launches update `lastSeenAt`, platform, and app version.
6. Creating another device must never create another Cantarella conversation.

## 3. Mobile Auth0 authentication

Mobile authentication must use a browser-based Auth0 flow that redirects back into the installed app.

### Flow

```text
User presses login
→ system browser opens Auth0
→ user authenticates
→ Auth0 redirects to Cantarella app link
→ app validates callback
→ tokens are stored securely
→ app calls GET /api/v1/me
```

### Required behavior

- Login callback reliably returns to the app.
- Session survives closing and reopening the app.
- Access tokens refresh without forcing another login.
- Expired or revoked sessions return to login cleanly.
- Multiple token-refresh requests cannot race.
- Logout clears local authentication data.
- Logout deactivates that installation's push endpoint.
- Provider API keys never appear inside the Capacitor bundle.

Authentication tokens should use secure native storage, not ordinary browser `localStorage`.

## 4. Application lifecycle recovery

Mobile operating systems frequently suspend network connections. The SSE connection will not remain alive forever.

### Resume flow

```text
App enters background
→ operating system may terminate SSE

App becomes active
→ validate/refresh authentication
→ request recent message history
→ reconcile messages and turn states
→ reconnect to SSE
```

V1.5 does not need an advanced event-sequence synchronization protocol.

The normal V1 history endpoint is sufficient:

```http
GET /api/v1/conversations/:conversationId/messages?limit=50
```

The client compares returned server message IDs against its current local messages and inserts anything missing.

The database remains the source of truth. SSE only delivers live changes while connected.

## 5. Minimal failed-send handling

This is necessary because mobile connections commonly disappear during requests.

### Send flow

```text
User presses send
→ client generates clientMessageId
→ optimistic bubble appears
→ POST existing V1 message endpoint
→ server stores message once
→ response replaces temporary state with server message data
```

Existing V1 request:

```http
POST /api/v1/conversations/:conversationId/messages
```

```json
{
  "clientMessageId": "6e0bb62a-49cc-4a95-b030-4c171df0857e",
  "content": "remind me to send that tomorrow",
  "source": "android",
  "replyToMessageId": null
}
```

### Failure flow

```text
Request fails or times out
→ bubble receives a subtle failed state
→ user taps retry
→ client resends the same clientMessageId
→ backend returns the existing message/turn if it already accepted it
```

The database must enforce:

```text
UNIQUE(user_id, client_message_id)
```

This handles ambiguous failures where the server accepted the message but the phone lost the response.

V1.5 does not include:

- Automatic background retry
- A persistent offline outbox
- Offline message composition across app restarts
- Complex delivery receipts

Those move to V3.

## 6. Push-notification endpoint registration

After receiving push permission and a provider token, the app registers it with the backend.

### APIs

```http
POST /api/v1/notification-endpoints
DELETE /api/v1/notification-endpoints/:deviceId
```

Registration request:

```json
{
  "deviceId": "dev_01JXYZ",
  "platform": "android",
  "pushToken": "provider-issued-token",
  "appVersion": "1.1.0"
}
```

Response:

```json
{
  "data": {
    "id": "push_01JXYZ",
    "deviceId": "dev_01JXYZ",
    "platform": "android",
    "enabled": true
  }
}
```

### Registration flow

```text
User grants notification permission
→ native provider returns push token
→ app sends token and device ID to backend
→ backend creates or updates notification endpoint
→ old token for that device is deactivated
```

A push token is sensitive infrastructure data. It should not appear in logs.

## 7. Durable push delivery

Push delivery must use an outbox. Do not call the notification provider directly inside the chat request.

### Delivery flow

```text
Cantarella message is committed to database
→ notification-outbox row is created
→ background worker claims the row
→ worker sends push through provider
→ provider result is recorded
→ retry temporary failures
→ deactivate permanently invalid tokens
```

Each message and endpoint combination must be unique:

```text
UNIQUE(message_id, notification_endpoint_id)
```

This prevents duplicate notifications during worker retries.

### Important rule

The database message is the real message.

A push notification is only an alert that tells the app to synchronize. If push delivery fails, the message must still appear the next time the application opens.

## 8. Notification payload and privacy

The push payload only needs routing information:

```json
{
  "type": "new_message",
  "conversationId": "con_123",
  "messageId": "msg_501"
}
```

Do not include the entire private message by default.

The application can fetch the real message from the authenticated API after opening.

Optional notification previews are a V3 setting.

## 9. Notification foreground behavior

V1.5 does not need an active-presence backend.

When a notification arrives:

- If the app is closed or backgrounded, show the notification.
- If the conversation is already visible, suppress the system banner.
- The actual message still arrives through SSE or history refresh.

This can be handled by the mobile application's foreground notification callback.

A cross-device presence service is unnecessary until V3.

## 10. Notification deep-linking

Tapping a notification should open the permanent conversation at the referenced message.

### Flow

```text
User taps notification
→ operating system opens Cantarella
→ app restores or requests authentication
→ app reads notification payload
→ loads permanent conversation
→ refreshes message history
→ locates referenced message
→ displays the conversation
```

If the referenced message is not in the latest page, the app can load the page around that message:

```http
GET /api/v1/conversations/:conversationId/messages/:messageId/context
```

Response:

```json
{
  "data": {
    "messages": [],
    "targetMessageId": "msg_501"
  }
}
```

This endpoint is only necessary if opening the latest history cannot reliably locate the notification message.

## 11. Reminder delivery on mobile

V1 already creates reminder messages inside the conversation. V1.5 adds push delivery when the application is closed.

### Flow

```text
V1 reminder becomes due
→ reminder worker creates normal Cantarella message
→ message is committed
→ push-outbox record is committed
→ mobile notification is delivered
→ user taps it
→ same conversation opens
```

The push notification must never create another reminder message. It only points to the one already stored.

Explicitly requested reminders should fire at their requested time. Later V2 proactive messages can obey stricter quiet-hour and suppression policies.

## 12. Android APK

Android is the first complete mobile target.

### Required behavior

- APK installs directly.
- Auth0 redirects return to the application.
- Session survives restart.
- Existing conversation loads.
- Sending and live replies work.
- Background/resume recovery works.
- Keyboard does not cover the composer.
- Android back button behaves normally.
- Push notifications arrive.
- Notification taps open the conversation.
- Updating the APK preserves the same account and conversation.

### Android acceptance flow

```text
Install APK
→ log in
→ send message
→ receive Cantarella bubbles
→ background app
→ trigger reminder
→ receive push
→ tap push
→ return to stored reminder message
```

## 13. iOS sideloaded application

The iOS app uses the same Capacitor project and web interface.

### Required behavior

- Auth0 redirect returns to the app.
- Session survives restart.
- Safe areas account for the notch and home indicator.
- Keyboard does not cover the composer.
- Background/resume synchronization works.
- Notification deep links are wired where supported.

Remote push capabilities depend on the chosen Apple signing and distribution method. They must be verified during implementation.

If the initial sideloaded build cannot receive remote push:

- The conversation still synchronizes when opened.
- Android can provide the complete push experience first.
- Full iOS remote push moves to the paid Apple developer/TestFlight step.

The app should not pretend iOS push works if the signing method cannot provide the entitlement.

## 14. V1.5 database additions

### `devices`

Stores:

- `id`
- `user_id`
- `platform`
- `device_name`
- `app_version`
- `last_seen_at`
- `created_at`
- `updated_at`

Constraint:

```text
UNIQUE(user_id, id)
```

### `notification_endpoints`

Stores:

- `id`
- `user_id`
- `device_id`
- `provider`
- `push_token`
- `enabled`
- `failure_count`
- `last_success_at`
- `created_at`
- `updated_at`

Constraints:

```text
UNIQUE(provider, push_token)
UNIQUE(device_id, provider)
```

### `notification_outbox`

Stores:

- `id`
- `message_id`
- `notification_endpoint_id`
- `status`
- `attempt_count`
- `next_attempt_at`
- `provider_message_id`
- `last_error_code`
- `created_at`
- `delivered_at`

Constraint:

```text
UNIQUE(message_id, notification_endpoint_id)
```

All three tables require primary keys, foreign keys, timestamps, and appropriate indexes.

## Explicitly not in V1.5

These are optional Messenger polish and remain in V3:

- Reply and quote
- Unread divider
- Synchronized read position
- Advanced multi-device synchronization
- Persistent offline outbox
- Automatic background message retry
- Detailed delivery and generation indicators
- Exact scroll restoration
- Active-device presence API
- Per-device notification controls
- Notification previews
- Device-management screen
- Sequence-based event synchronization
- Attachments
- Voice notes
- Reactions
- Search
- Edit, delete, or pin message
- Response-rating interface

These intelligence features also do not belong in V1.5:

- Heartbeats
- Mood or state inference
- Goals
- Calendar
- Focus mode
- Digests
- Silence detection
- Proactive behavior
- Smart notification learning
- Web search
- BYOK
- Broad agency
- Telegram

## V1.5 definition of done

V1.5 is finished when:

- The existing interface runs through one shared Capacitor project.
- Android can be installed and used as the main client.
- iOS can be sideloaded and used within its signing limitations.
- Mobile Auth0 login and token refresh are dependable.
- Restarting or resuming the app restores the conversation.
- SSE reconnects after resume.
- Failed sends can be retried without duplicating messages.
- Android receives background notifications.
- Notification taps open the correct stored message.
- Push failure cannot lose a conversation message.
- No optional Messenger polish delays completion.

That is the complete V1.5: **mobile packaging, mobile authentication, connection recovery, minimal send safety, and push delivery—nothing else.**

# V3: Optional Messenger QoL

These features are intentionally deferred. They are useful, but none should delay
the core intelligence, memory, reminders, mobile packaging, or V2 "alive" layer.

- Reply and quoted-message previews
- Unread divider and synchronized read cursor
- Advanced real-time multi-device synchronization
- Persistent offline message outbox
- Detailed delivery and generation indicators
- Exact scroll-position restoration
- Active-device presence API
- Notification preview, sound, and per-device controls
- Device-management screen
- Sequence-based missed-event synchronization
- Attachments and voice notes
- Reactions
- Conversation search
- Edit, delete, and pin-message controls

## Optional response feedback

Response feedback belongs in V3 or in a private development evaluator, not in the
V1 product interface.

```http
POST /api/v3/messages/:messageId/feedback
```

Feedback may reference the message, model versions, prompt versions, and persona
version. It must never automatically rewrite the user's persona, SOUL, or memory.
