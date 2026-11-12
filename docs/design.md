# course-standards-mcp: design

Status: approved 11 November 2026 (answers in section 18). Design and decisions: Andreas Schliep. Drafted with Claude Code.

**In two sentences:** The server checks course material (facilitation plan, mapping document, course description) against learning objectives written in English with a Bloom level, and against a term base. It reports deterministic findings with evidence locations; the model in the client makes the final call (met, weak, missed) using a rubric the server provides.

Explainability comes before features. Every part of this design should be explainable in two sentences.

## 1. Goal and non-goals

**Goal.** An agent (Claude Code, Claude Desktop, any MCP client) can ask: "Does this German facilitation plan meet the English learning objectives of course X, and does it use the right terms?" It then gets, per objective, what the server could establish for certain, where the evidence is, and which question still needs judgment.

**Non-goals.**

- **No translation.** DeepL already offers translation with glossaries as an MCP server. This server checks against knowledge DeepL does not have: objectives, Bloom levels, Scrum terminology, DE/CH rules.
- **No final verdict from the server.** The server never says "met" (section 4).
- **No writing.** All tools are read-only, and the server changes no file.
- **No real course data in the repository.** Only fictional objectives and examples are committed (section 10).

## 2. Context

| Item              | Version checked on 11 Nov 2026                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP specification | **2026-07-28**. Stateless (no `initialize`, `server/discover`, per-request `_meta`). **Sampling, Roots and Logging deprecated** (SEP-2577). Server-initiated requests replaced by multi round-trip requests (MRTR) |
| TypeScript SDK    | **`@modelcontextprotocol/server` 2.4.0** (v2, stable since 27 Jul 2026, speaks 2026-07-28 and falls back to older revisions). `@modelcontextprotocol/sdk` 1.32.2 is the maintenance line                           |
| MCP Inspector     | 2.14.0                                                                                                                                                                                                             |
| Claude Code       | 2.1.309 locally. The v2 MCP runtime speaks 2026-07-28. The MCP docs list tools, resources (`@server:uri`), prompts (`/server:prompt`) and elicitation. **Sampling is not mentioned**                               |
| Checker           | `learning-objective-lint` 1.0.0, commit `6a1c603`, CommonJS, Node >= 20.6, MIT, public                                                                                                                             |

### What existed before, what is new

| Existed before this server                                                                                                                                                                                    | New in this repository                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Lint of objective wording** (8 rules, verb lists, Bloom level check). It was in the private training infrastructure before November 2026 and has been public as `learning-objective-lint` since 11 Nov 2026 | The MCP server: tools, resources, prompt template, error shaping, configuration                                          |
| **Coverage of a structured agenda** (`coverage`) and an **optional model review** (`review`). Both were added to `learning-objective-lint` on 11 Nov 2026, during the public extraction                       | **Extraction** of activities, times and objective references from Markdown and CSV documents                             |
| Prompt-based coverage analysis as Claude Code skills and agents in the private course repository                                                                                                              | A bilingual (DE/EN) **activity-type lexicon** that maps an activity type to the highest Bloom level it plausibly reaches |
|                                                                                                                                                                                                               | **Term base** with `check_terms` and `lookup_term`, including DE/CH rules                                                |
|                                                                                                                                                                                                               | **Rubric** as a resource, and `needs_judgment` questions per objective                                                   |

## 3. Architecture

```
 Human ── reads, challenges ──> Client (Claude Code / Claude Desktop)
                                  │  the client's model judges, using rubric://bloom
                                  │  JSON-RPC over stdio (stdout = protocol only)
                                  ▼
                       course-standards-mcp (this server, read-only)
                       ├─ tools:     list_learning_objectives, check_alignment,
                       │             check_terms, lookup_term
                       ├─ resources: course://{course_id}/learning-objectives,
                       │             rubric://bloom, termbase://en-de
                       ├─ prompt:    validate_course_material
                       ├─ extract/:  Markdown and CSV → activities (new)
                       └─ data:      catalogs, rubric, term base (YAML, configurable folders)
                                  │  library calls (no CLI, no stdout)
                                  ▼
                       learning-objective-lint
                       (parseObjectives, lintObjective, computeCoverage, Bloom helpers)
```

The server holds no state between calls. It reads its data files on every call (they are small), so an edited catalog takes effect without a restart.

## 4. Where the semantic judgment lives

Whether a facilitation plan meets an objective at level _Apply_ is a judgment, not a string comparison. There are three places it could be made.

|                 | (a) Server calls a model                                                       | (b) MCP sampling                                               | (c) Deterministic findings, client model judges with a server rubric                                    |
| --------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| How             | Like `lo-lint review`: one Anthropic API call per objective–activity pair      | The server asks the client's model for an answer               | The server returns findings, evidence and a rubric question; the model in the conversation answers it   |
| Cost            | API cost per check, on top of the client's model (two models for one task)     | No extra cost                                                  | No extra cost                                                                                           |
| Keys            | `ANTHROPIC_API_KEY` in the server's environment, for every trainer             | None                                                           | None                                                                                                    |
| Reproducibility | Low: same input, possibly a different verdict                                  | Low                                                            | **The server part is fully reproducible.** Only the judgment step varies, and it happens in plain sight |
| Testability     | Needs mocks or recorded responses                                              | Needs a client that supports sampling                          | Plain unit tests on fixed inputs                                                                        |
| Client support  | Every client                                                                   | **Deprecated** in 2026-07-28 and not documented in Claude Code | Every client that supports tools                                                                        |
| Data flow       | Course material goes from the server to a second API, a second path to explain | Stays in the client                                            | Stays in the client                                                                                     |
| Weakness        | Key management, cost, flaky tests                                              | Likely to disappear                                            | The judgment depends on the client's model, and the server cannot force it to follow the rubric         |

**Decision: (c).** It runs without a key, it is reproducible and testable, and it works with every client. The judgment happens where the user can see and challenge it.

**How the existing checker is split under (c):**

- `lint` and `coverage` are deterministic and are called in-process by the server.
- `review` (variant a) is **not** used by the server. Its system prompt and verdict scheme become the rubric: the criteria in `rubric://bloom` and the `needs_judgment` questions. The client model applies the same criteria that `review` sends to the API.
- `review` stays in the CLI for batch runs outside a conversation, for example in CI. There, (a) is the better choice because no client model is present.

**Two vocabularies, so you can see who decided:**

- The **server** reports an _evidence status_: `covered`, `partial`, `unclear`, `missing`.
- The **model** gives the _verdict_: `met`, `weak`, `missed` (in German reports: _erfüllt_, _schwach_, _verfehlt_).

## 5. Inputs

### 5.1 Learning-objective catalogs

The format is the one `learning-objective-lint` reads, which is also the format of the existing private catalogs. Real catalogs therefore work unchanged. The server adds optional keys that the library ignores:

```yaml
# FICTIONAL EXAMPLE DATA
metadata:
  id: ADB
  title: Agentic Development Basics (fictional)
  version: '0.1'
  language: en
  audience_level: introductory # used by the library's Bloom profile check
  references: # new, optional: how documents cite objectives
    prefixes: ['LO', 'Lernziel', 'Learning objective']
    id_template: 'ADB-{n}' # "LO 3" → ADB-3
modules:
  - id: M1
    title: Working with a coding agent
    objectives:
      - id: ADB-3
        level: Apply
        text: Review an agent-generated change with a five-point checklist before merging it.
        keywords: { de: [Review, Checkliste, Änderung prüfen] } # new, optional
```

- **Validation:** The server validates with `parseObjectives` from the library and reads `references` and `keywords` itself.
- **Shared objectives:** A catalog may include shared objectives through `composition.shared.file`, the convention the existing catalogs use. The path must stay inside the catalog folder.

### 5.2 Documents

| `document_type`      | Typical form                                      | What the extractor produces                                                                          |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `facilitation_plan`  | Markdown with one heading per block               | one activity per block: title, line range, minutes, phase, objective references, activity types      |
| `mapping_document`   | table (Markdown or CSV, e.g. exported from Excel) | one activity per row: objective (by ID, or by exact objective text), description, minutes if present |
| `course_description` | prose                                             | no activities, only candidate passages per objective (section 11)                                    |

The document arrives as `text`, or as a `path` inside a configured root (decision D7). Formats are `markdown` (default), `csv`, and `agenda_yaml`. The last one is the library's own agenda format: it is passed straight to `computeCoverage`, which lets us compare the server with the old checker one-to-one (section 17).

### 5.3 Extraction rules (new, deterministic)

- **Blocks.** Every Markdown heading starts a block, which runs until the next heading. A block with no time, no reference and no activity type is treated as structure (for example "Preparation") and is not reported.
- **Minutes.** Taken in this order, first from the heading, then from the block's first line:
  1. `45 min`, `30 Min.`, `30 Minuten`
  2. a time range `09:00–09:30`

  If a block has no time, `minutes` is `null`. There is no guessing.

- **Objective references.** A prefix (`LO 3`, `Lernziel 3`) followed by a list or a range: `LO 1.4, 2.1`, `LO 3.1–3.5`, `LO 1-6`.
  - A range is expanded only if every ID it produces exists in the catalog.
  - A note in brackets or parentheses after an item does not end the list (`LO 1.5–1.7 [see note], 2.4–2.8`); numbers inside the note are ignored.
  - References that cannot be resolved are reported as `unknown_references`.
- **Phase.** `C1` to `C4`, or the names _Connections_, _Concepts_, _Concrete Practice_, _Conclusions_.
- **Activity types.** Keywords from the lexicon in `rubric://bloom` (DE and EN), searched in the heading and the block text. The highest level among the recognised types is the block's **level ceiling**.

| Type            | DE cues (examples)                       | EN cues (examples)              | Level ceiling                   |
| --------------- | ---------------------------------------- | ------------------------------- | ------------------------------- |
| `break`         | Pause, Mittagspause                      | break, lunch                    | ignored                         |
| `quiz`          | Quiz, Wissensabfrage                     | quiz, knowledge check           | Remember                        |
| `lecture`       | Vortrag, Input, Impuls                   | lecture, input, talk            | Understand                      |
| `demo`          | Demo, Vorführung                         | demo, walkthrough               | Understand                      |
| `story`         | Geschichte, Erzählung                    | story                           | Understand                      |
| `discussion`    | Diskussion, Austausch, Plenum            | discussion, plenary             | Understand                      |
| `exercise`      | Übung, Praxisübung, ausprobieren         | exercise, practice, hands-on    | Apply                           |
| `simulation`    | Rollenspiel, Simulation                  | role play, simulation           | Apply                           |
| `case_analysis` | Fallstudie, Ursachenanalyse, vergleichen | case study, root cause, compare | Analyse                         |
| `critique`      | Peer-Review, begutachten, bewerten       | peer review, critique, assess   | Evaluate                        |
| `design`        | entwerfen, gestalten, erstellen          | design, build, create           | Create                          |
| `ambiguous`     | Reflexion, Präsentation, präsentieren    | reflection, debrief, present    | none, so the block is `unclear` |

**From extraction to coverage.** The server builds the library's agenda structure from the extracted blocks. Each reference becomes a link with the block's level ceiling. It then calls `computeCoverage`. Links from blocks without a recognised type do not go to the library. They still appear as evidence (`confidence: medium`). If an objective has _only_ such links, the server marks it `unclear` itself; if it also has typed links, the library's status stands and `needs_judgment` gets high priority.

### 5.4 German documents against English objectives

Four signals, from strong to weak:

1. **IDs are language-neutral.** `LO 3` in a German plan resolves to `ADB-3`.
2. **The activity-type lexicon is bilingual.** _Übung_ and _exercise_ both lead to Apply.
3. **Keywords.** Term-base terms in the English objective are mapped to their German forms (`Sprint Goal` → `Sprint-Ziel`; `Product Backlog` stays English), together with the optional `keywords.de` of the catalog. Keywords form groups, one per concept: the variants of one term count as one hit, and a term inside a longer matched term ("Sprint" in "Sprint Goal") is dropped. Blocks with hits in at least two groups (or in the only group) become _candidates_.
4. **Bloom verbs DE/EN** in the rubric help the model judge what participants actually do.

Signals 3 and 4 never produce `covered`. They only produce candidates for judgment.

## 6. Tools

All four tools are read-only (`readOnlyHint`, `idempotentHint`, not `openWorldHint`). Each returns a short Markdown summary and the serialized JSON as `text` content, plus `structuredContent` that matches a declared `outputSchema`; the specification recommends the JSON text block for backwards compatibility. Input and output schemas are zod v4 objects, which the SDK turns into JSON Schema.

| Tool                       | Purpose                                                                                                                                         | Side effect                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `list_learning_objectives` | Objectives of a course with ID, text (EN) and Bloom level; optionally with the wording lint. Without `course_id`: the list of available courses | none                                          |
| `check_alignment`          | Check a document against a course's objectives: evidence status, evidence locations, time share and `needs_judgment` per objective              | none (reads a document under an allowed root) |
| `check_terms`              | Check a text against the term base: deprecated terms, terms that must stay English, wrong German equivalents, `ß` for `de-CH`                   | none                                          |
| `lookup_term`              | Look up a term: DE/EN equivalents, category, source, note                                                                                       | none                                          |

### 6.1 `list_learning_objectives`

```ts
input = z.object({
  course_id: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,40}$/)
    .optional(),
  module_id: z.string().optional(),
  include_lint: z.boolean().default(false),
});
output = z.object({
  courses: z.array(z.object({ id, title, version, objectives: z.number() })).optional(), // no course_id
  course: z.object({ id, title, version, audience_level }).optional(),
  objectives: z.array(z.object({ id, module_id, level, text })).optional(),
  lint: z
    .array(z.object({ id, worst_status, findings: z.array(z.object({ rule, status, message })) }))
    .optional(),
});
```

- **Logic:** `parseObjectives`, plus `lintObjective` from the library when `include_lint` is set.
- **Domain errors:**
  - `unknown_course` (the hint lists the available IDs)
  - `unknown_module`
  - `invalid_catalog` (the library's `InputError` problems, with file name)

### 6.2 `check_alignment`

```ts
input = z.object({
  course_id: z.string(),
  document: z.union([z.object({ text: z.string().max(500_000) }), z.object({ path: z.string() })]),
  document_type: z.enum(['facilitation_plan', 'mapping_document', 'course_description']),
  format: z.enum(['markdown', 'csv', 'agenda_yaml']).default('markdown'),
  language: z.enum(['en', 'de', 'de-CH']),
  objective_ids: z.array(z.string()).optional(), // limit output to some objectives
  max_evidence: z.number().int().min(1).max(5).default(3),
});
```

The output is the result object below, abbreviated. Every key in it is declared in `outputSchema`.

```jsonc
{
  "course_id": "ADB",
  "document": {
    "type": "facilitation_plan",
    "language": "de",
    "source": "plan-de.md",
    "activities": 9,
    "total_minutes": 90,
  },
  "summary": {
    "objectives": 6,
    "covered": 3,
    "partial": 1,
    "unclear": 1,
    "missing": 1,
    "over_covered": 0,
    "needs_judgment_high": 3,
  },
  "objectives": [
    {
      "id": "ADB-3",
      "level": "Apply",
      "text": "Review an agent-generated change …",
      "status": "partial",
      "evidence": [
        {
          "activity": "2.3 Agenten-Output prüfen",
          "lines": "41-52",
          "via": "id_reference",
          "types": ["lecture"],
          "ceiling": "Understand",
          "minutes": 15,
          "confidence": "high",
          "excerpt": "Input: Wie prüfe ich …",
        },
      ],
      "minutes": { "total": 15, "active": 0, "share_percent": 17 },
      "findings": [
        {
          "code": "passive_only",
          "severity": "warn",
          "message": "Target is Apply, but the only evidence is a lecture.",
        },
      ],
      "needs_judgment": {
        "priority": "high",
        "question": "The evidence for ADB-3 (Apply) stays below the target level: \"2.3 Agenten-Output prüfen\" (lines 37-41). Do participants perform the objective themselves anywhere in the document?",
        "rubric": "rubric://bloom",
      },
    },
  ],
  "hygiene": {
    "unknown_references": [],
    "activities_without_objectives": ["1.1 Check-in"],
    "unclassified_activities": ["2.5 Reflexion"],
  },
  "distribution": {/* from computeCoverage: target vs practised levels, audience profile */},
  "criteria_by_level": {
    "Apply": [
      "Participants perform the behaviour named by the verb themselves",
      "in a context close to the objective",
      "and get feedback on it.",
    ],
  },
  "limits": [
    "activity types are inferred from keywords",
    "minutes of shared blocks count for every objective",
  ],
}
```

**Evidence status (server):**

| Status    | Rule                                                                          | Source                                     |
| --------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| `covered` | referenced by at least one block whose level ceiling reaches the target level | library (`covered`)                        |
| `partial` | referenced, but every typed block stays below the target level                | library (`partial`)                        |
| `unclear` | referenced only by blocks without a recognised type                           | server                                     |
| `missing` | no explicit reference. Keyword candidates may be attached                     | library (`missing`) plus server candidates |

`over_covered` is a flag, not a status (library, threshold 3).

**Findings:**

- `passive_only`: the target is Apply or higher, and all evidence is lecture, demo, story or discussion.
- `objective_wording`: the objective itself fails the lint, which makes the judgment harder.
- `no_time`: every evidence block has `minutes: null`.

**`needs_judgment`** is present for every objective. Its priority:

- **high:** `partial`, `unclear`, `missing` with candidates, or evidence only from keywords.
- **low:** `covered` through an explicit reference from a block whose type matches.

The question is generated from the status and the target level; it names the objective by id, because its text sits next to it. The two or three rubric criteria for each target level that occurs are listed once in `criteria_by_level`, so the model does not have to read the whole rubric, and the result does not repeat them for every objective (phase 3: 30 objectives went from about 8,300 to well under 8,000 tokens).

**Domain errors:**

| Code                      | When                                          | Hint                                                                     |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `unknown_course`          | the course is not in the catalog              | lists available IDs                                                      |
| `empty_document`          | the text is empty or only whitespace          | —                                                                        |
| `document_too_large`      | more than 500 KB                              | —                                                                        |
| `path_not_allowed`        | the path is outside the allowed roots         | names the roots                                                          |
| `file_not_found`          | the file does not exist                       | —                                                                        |
| `unsupported_combination` | e.g. `course_description` together with `csv` | —                                                                        |
| `no_activities_found`     | a plan or mapping yields no blocks or rows    | "Is this a course description? Use `document_type: course_description`." |
| `unknown_objective_ids`   | in `objective_ids`                            | —                                                                        |

### 6.3 `check_terms`

```ts
input = z.object({
  document: z.union([z.object({ text: z.string().max(500_000) }), z.object({ path: z.string() })]),
  language: z.enum(['en', 'de', 'de-CH']),
  categories: z
    .array(z.enum(['deprecated', 'keep_english', 'wrong_translation', 'locale']))
    .optional(),
});
output = z.object({
  language,
  termbase: z.string(),
  summary: z.record(z.number()),
  findings: z.array(
    z.object({
      category,
      severity: z.enum(['error', 'warn', 'info']),
      found: z.string(),
      line: z.number(),
      column: z.number(),
      excerpt: z.string(),
      suggestion: z.string(),
      term_id: z.string().optional(),
      source: z.string().optional(),
    }),
  ),
});
```

**Rules, in this order:**

1. **`deprecated`:** terms the current source replaced. Example: _Development Team_ → _Developers_, the Scrum Guide 2017 term replaced in 2020.
2. **`keep_english`:** a term that must stay English appears translated. Example: _Produktverantwortlicher_ instead of _Product Owner_.
3. **`wrong_translation`:** a known wrong German equivalent.
4. **`locale`:** with `de-CH`, every `ß` → `ss`.

**Matching:** case-insensitive, on word boundaries, longest term first. Matches inside code spans and URLs are ignored. Every term can list `allow_in` contexts: a spelling that is wrong in running text can be correct inside a protected product or certification name, and such names are listed there.

**Domain errors:** `empty_document`, `document_too_large`, `path_not_allowed`, `file_not_found`, `termbase_unavailable`.

### 6.4 `lookup_term`

```ts
input = z.object({ term: z.string().min(1).max(100) });
output = z.object({
  found: z.boolean(),
  entries: z.array(
    z.object({
      id,
      en,
      de,
      keep_english: z.boolean(),
      category,
      deprecated_forms: z.array(z.string()),
      wrong_translations: z.array(z.string()),
      source,
      note: z.string().optional(),
    }),
  ),
  suggestions: z.array(z.string()), // when not found: same prefix or edit distance <= 2
});
```

The tool searches English terms, German equivalents, deprecated forms and wrong translations. A term that is not found is **not an error**: the result is `found: false` with suggestions, because "no entry" is a valid answer.

## 7. Domain errors and protocol errors

A **domain error** means the tool understood the request but cannot do the job with this input: an unknown course, an empty document, a path outside the allowed roots, a plan in which no blocks were found. It comes back as a normal tool result with `isError: true`. The result carries a readable message, a stable `code` and a `hint` on what to change, so the model can correct itself and call again. Since 2025-11-25 the specification also counts input validation errors as tool execution errors.

A **protocol error** means the request itself is broken: an unknown tool, a request that does not match the `CallToolRequest` schema, or a resource URI that does not exist. It comes back as a JSON-RPC error. The model can rarely fix those; the client needs to know that the exchange with the server is the problem.

**What the SDK does (checked in 2.4.0):**

- `McpServer` answers an unknown tool with a JSON-RPC error (`-32602`).
- It turns **every exception thrown inside a tool handler** into an `isError` result. That includes zod input validation errors, and it means even a real crash would show up as a domain error.
- So this server returns domain errors explicitly, with `code` and `hint`. It catches unexpected exceptions itself, logs the stack to stderr, and returns only "internal error, see server log", never internals.
- Resources have no `isError` channel: an unknown course in `course://…` raises `ResourceNotFoundError`, which is JSON-RPC `-32602` since 2026-07-28.

## 8. Resources

| URI                                        | Type               | Content                                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `course://{course_id}/learning-objectives` | `application/json` | the normalized catalog (same shape as the tool output). Resource template with a `list` callback (all courses) and completion for `course_id`                                                                                                  |
| `rubric://bloom`                           | `text/markdown`    | per Bloom level: what participants observably do, verbs EN/DE, activity types with level ceilings, evidence that justifies _met_, typical signs of _weak_; definitions of _met_, _weak_ and _missed_; the judgment questions                   |
| `termbase://en-de`                         | `application/json` | the term base (data licence CC BY-SA 4.0). Only one language pair in version 1, so a fixed URI; with a second pair it becomes the template `termbase://{source}-{target}`. `de-CH` is a locale rule of `check_terms`, not a separate term base |

The rubric is generated from `data/rubric/bloom.yaml`, the same file the extractor uses for its activity types. What the model reads and what the server computes therefore cannot drift apart.

**Verdict definitions in the rubric:**

- _**met:**_ in at least one activity, participants perform the objective's behaviour at or above the target level, and there is a cited location.
- _**weak:**_ the content is right, but the activity stays below the target level, there is too little time, or only part of the behaviour is practised.
- _**missed:**_ no activity addresses the objective, or the evidence is unrelated.

## 9. Prompt template

`validate_course_material` takes four arguments:

- `course_id` (with completion)
- `document`: a path, or the text pasted after the command
- `document_type`
- `language`

In Claude Code it appears as `/course-standards:validate_course_material`. The template tells the model to:

1. call `list_learning_objectives` for the course;
2. read `rubric://bloom`;
3. call `check_alignment`;
4. for every objective with `needs_judgment.priority: high`, and spot-check the low ones:
   - decide _met_, _weak_ or _missed_ by the rubric criteria;
   - quote the evidence location;
   - **never give _met_ without a location**;
5. call `check_terms`;
6. report, in the document's language:
   - a table _Lernziel · Status (erfüllt/schwach/verfehlt) · Begründung · Fundstelle · Vorschlag_;
   - the term findings;
   - a short list "Was der Server nicht entscheiden konnte" (what the server could not decide).

The template is the portable form of the workflow, because any MCP client can show it. A Claude Code skill could do the same, but only in Claude Code (decision D14).

## 10. Data format and real data

```
data/                                   committed, fictional only
  courses/ADB.yaml                      "Agentic Development Basics" (fictional)
  rubric/bloom.yaml                     levels, verbs EN/DE, activity types DE/EN, criteria, questions
  termbase/en-de.yaml                   terms with category, source and note
examples/                               fictional documents
  adb-facilitation-plan-de.md           with deliberate gaps (demo, first run)
  adb-facilitation-plan-de-fixed.md     the same plan, gaps closed (demo, second run)
  adb-mapping.csv
  adb-course-description-de.md
```

A term base entry (verified on 12 November 2026 against the three German versions of the 2020 guide on scrumguides.org and the translators' glossary 3.5):

```yaml
- id: developers
  en: Developers
  de: Developer:innen # standard version (inclusive forms with a colon)
  de_variants: [Developer:in, Developerin, Developerinnen, Developer, Developern] # female and male versions
  keep_english: true # core terms stay English in German texts
  deprecated: [Development Team, Development-Team, Entwicklungsteam] # checked in every text
  wrong_de: [Entwicklerteam, { form: Developers, severity: info }] # checked in German texts
  source: sg2020-de
  note: The 2020 guide replaced the Development Team with Developers inside one Scrum Team.
```

`wrong_en` holds unofficial English forms (e.g. "Daily Standup"); they are checked in every text, because English jargon also appears in German texts. `allow_in` lists phrases in which a flagged form is correct.

**Licence of the term base.** The term pairs come from the Scrum Guide 2020 and its official German translation with the translators' glossary, published under CC BY-SA 4.0. `data/termbase/en-de.yaml` is therefore CC BY-SA 4.0 and says so in its header and in `termbase://en-de`; the code is MIT.

Every file carries `version` and a header comment; fictional files say so in the first line.

**Configuration (environment variables only):**

| Variable                    | Default                           | Purpose                                                                                                                         |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `COURSE_STANDARDS_COURSES`  | `<repo>/data/courses`             | one or more catalog folders (separated by `:`); a later folder overrides a course ID from an earlier one, with a note on stderr |
| `COURSE_STANDARDS_TERMBASE` | `<repo>/data/termbase/en-de.yaml` | term base file                                                                                                                  |
| `COURSE_STANDARDS_DOCS`     | `<repo>/examples`                 | allowed roots for `document.path` (separated by `:`)                                                                            |

The rubric is not configurable. It is the server's method and is versioned with the code.

**Using real data locally without committing it:**

- `claude mcp add` sets the three variables to folders outside the repository. For example, `COURSE_STANDARDS_COURSES=<local catalog folder>:<repo>/data/courses`.
- The existing private catalogs can be read in place, because their format is the library's format.
- Missing `references` settings go into a local side file `<course_id>.references.yaml` in a separate local folder, so the originals stay untouched.
- `.gitignore` excludes `.env`, `local/` and `*.local.yaml`.
- Before every push: `gitleaks detect --no-git -s .` and the portfolio denylist, both with zero hits.

## 11. Limits of the heuristics

What the server cannot decide deterministically, and how it says so:

| Limit                                                 | Example                                                                             | How the server shows it                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| An activity type is a label, not what participants do | "Übung" where the trainer works and the group watches; "Input" with a hands-on part | the ceiling is only a hint; `needs_judgment` for every objective, high priority when it matters |
| Ambiguous words                                       | _präsentieren_ (trainer or participants?), _Reflexion_, _discuss_                   | type `ambiguous` → status `unclear`                                                             |
| Coverage in substance without an ID                   | the plan practises the objective but never cites it                                 | `missing` + candidates with `via: keyword_match`, `confidence: low`, never `covered`            |
| Keyword matching across languages                     | synonyms, inflection, compounds (_Hindernisse_ vs _impediments_)                    | candidates only; the term base and `keywords.de` improve recall, not certainty                  |
| Time attribution                                      | one block serves three objectives; sub-blocks with their own times                  | `minutes.total` counts the whole block for each objective (an upper bound), stated in `limits`  |
| Negation and contrast                                 | "kein Vortrag, sondern Übung"                                                       | both types are detected, ceiling is the higher one; noted in `limits`                           |
| Ranges in tables                                      | "1-6" in a schedule column may not be objective IDs                                 | ranges only after a prefix, only if all IDs exist                                               |
| A plan is not the training                            | the document describes intent, not what happens in the room                         | stated in the rubric and the README                                                             |
| Course descriptions                                   | promises without activities                                                         | candidates only, status `unclear` or `missing`                                                  |
| Wording quality in German                             | the lint knows English verbs only                                                   | out of scope for version 1; `check_terms` does not judge German objective wording               |

Every piece of evidence carries a `confidence`:

- **high:** an explicit ID and a recognised type
- **medium:** an explicit ID with an ambiguous type, or a table row
- **low:** keywords only

The output names the heuristics it applied in `limits`.

## 12. Transport and security

**stdio.** The client starts the server as a local child process: one user, one machine, no key at all. All logging goes to stderr. stdout carries only the JSON-RPC messages, and any other byte there breaks the protocol. This includes stray `console.log` calls in libraries; the server never calls the library's CLI.

**When Streamable HTTP would be better:** when several trainers share one central catalog and term base, for example on a company server.

- Thanks to the stateless 2026-07-28 revision, that would also run behind a load balancer without sticky sessions.
- **Authentication** would come on top, as in the MCP authorization spec:
  - OAuth 2.1, with the server as a resource server;
  - tokens from the company identity provider;
  - Client ID Metadata Documents, since dynamic client registration is deprecated.
- **Further requirements:**
  - scopes per catalog, because licensed objective texts may only reach certified trainers;
  - TLS and Origin checks;
  - rate limits and an audit log;
  - no `path` input, only `text`.

**Threats in the local setup:**

- **Path traversal:** `path` is resolved with `realpath` and must lie under an allowed root. Only `.md`, `.csv`, `.yaml` and `.txt` are accepted, up to 500 KB.
- **Oversized input:** size limits and a limit on extracted blocks (2,000).
- **YAML abuse:** YAML is parsed with the safe default schema, and no includes are read from documents. Catalog includes (`composition.shared.file`) only work inside the catalog folder.
- **Leaking real data:** only fictional data in the repository, plus gitleaks and denylist checks.

## 13. Design decisions

**D1 Where the judgment lives.** Decision: deterministic findings in the server, verdict by the client model with a server rubric (variant c). Alternative: a model call in the server (a) or sampling (b). Reason: no key, reproducible, testable, works with every client; sampling is deprecated in 2026-07-28 and not documented in Claude Code (section 4).

**D2 Transport.** Decision: stdio. Alternative: Streamable HTTP. Reason: one local user and no secrets; HTTP becomes worth it with several trainers on a shared catalog, and then it needs OAuth 2.1, scopes per catalog, TLS and no path input (section 12).

**D3 One server, not two.** Decision: objectives and term base in one server. Alternative: a separate term base server. Reason: alignment needs the term base to map English objectives to German documents; two servers would have to call each other or duplicate the term base.

**D4 Tool cut.** Decision: four tools; one `check_alignment` for all three document types; lint as an option of `list_learning_objectives`; no `list_courses` (omit `course_id` instead). Alternative: one tool per document type, plus separate lint and course-list tools. Reason: one result shape for all document types is easier to judge and to explain; fewer tools means fewer wrong tool choices by the model.

**D5 Reuse, not rewrite.** Decision: `learning-objective-lint` as a dependency, pinned to a commit: a git submodule in `vendor/`, linked by npm as `file:vendor/learning-objective-lint`. Alternative: copy or rewrite the checker; or a git or tarball dependency in `package.json`. Reason: one source of truth for parsing, lint and coverage; its tests keep counting; the server only adds extraction and MCP. npm 12 refuses git and remote-tarball dependencies by default, and the library is not published to the npm registry, so git pins the commit instead of npm.

**D6 Data format.** Decision: versioned YAML files with `source` fields, in configurable folders. Alternative: CSV (spreadsheet-friendly), JSON, SQLite. Reason: the catalogs already exist in this YAML format; comments can mark fictional data; changes are reviewable as diffs. A CSV import for term bases could follow if other trainers maintain them in a spreadsheet.

**D7 Document input.** Decision: `text` or `path` under configured roots. Alternative: text only, or MCP Roots. Reason: otherwise the model has to retype a long document as a tool argument (slow, and it may change the text on the way); Roots are deprecated in 2026-07-28, and the specification recommends server configuration instead.

**D8 Two vocabularies.** Decision: the server reports `covered/partial/unclear/missing`, the model decides `met/weak/missed`. Alternative: one status for both. Reason: the name shows who made the call, so a deterministic finding is never mistaken for a judgment.

**D9 Error handling.** Decision: domain errors as `isError` results with `code` and `hint`; protocol errors as JSON-RPC errors; "term not found" is a normal result. Alternative: exceptions everywhere. Reason: the model can only correct what it sees in the result; "no entry" is a valid answer, not a failure (section 7).

**D10 SDK and language.** Decision: `@modelcontextprotocol/server` 2.4.0, TypeScript strict, zod v4, same tooling as `miro-board-mcp`. Alternative: SDK v1 1.32.2, or plain JavaScript like the library. Reason: v2 is the current stable line for the current specification; types and runtime schemas at the boundary show up in review.

**D11 No cache.** Decision: read data files on every call. Alternative: load once at start. Reason: catalogs are small; edits take effect without restarting the client, and there is no stale state to explain.

**D12 Output budget.** Decision: excerpts of at most 160 characters, at most three evidence items per objective, `objective_ids` filter. The target is under 8,000 tokens for 30 objectives. Alternative: the full extracted document in the result. Reason: Claude Code warns above 10,000 tokens of tool output; the model needs locations, not the whole text.

**D13 No translation.** Decision: the server checks, it never translates. Alternative: integrate DeepL. Reason: DeepL already offers translation with glossaries as an MCP server; this server adds what DeepL does not know.

**D14 Workflow as an MCP prompt.** Decision: `validate_course_material` as an MCP prompt template. Alternative: only a Claude Code skill, or the experimental "Skills over MCP" extension. Reason: a prompt works in every MCP client; a skill only in Claude Code; the extension's client support is unverified.

## 14. Proposed library change (waiting for approval)

Rule: existing code is not changed without approval. The change below would be a new commit in the public `learning-objective-lint` repository, released as 1.1.0. This server would then pin that commit.

|     | Change                                                                            | Why                                                                                 | Size                        |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------- |
| A   | Export `loadVerbs`, `tokenise`, `levelsForVerb`, `levelIndex` from `src/index.js` | the server uses the same Bloom verb lookup without importing `src/util.js` directly | about 5 lines plus one test |

Without approval, the server imports `learning-objective-lint/src/util.js` directly. That works, because the package has no `exports` field, but it depends on the file layout.

`unclear` links are handled in the server (section 5.3), so `computeCoverage` stays unchanged. The private training infrastructure is not touched at all.

## 15. Fictional example course

"Agentic Development Basics" (ADB) is a made-up 90-minute workshop for developers in a Scrum Team (`data/courses/ADB.yaml`, audience level _intermediate_). Its objectives, all of which pass the wording lint:

| ID    | Level      | Objective                                                                                                           | Role in the demo                                  |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| ADB-1 | Understand | Explain the plan-act-check loop of a coding agent using one example task.                                           | covered                                           |
| ADB-2 | Apply      | Use a task brief template to instruct a coding agent so that it completes a small task without follow-up questions. | covered                                           |
| ADB-3 | Apply      | Apply a five-point checklist to an agent-generated change before merging it.                                        | only a lecture → `partial`, `passive_only`        |
| ADB-4 | Analyse    | Distinguish tasks suited for an agent from tasks that need a human decision, giving one reason each.                | covered                                           |
| ADB-5 | Evaluate   | Judge whether an agent's test run is sufficient evidence that a change works.                                       | not referenced → `missing`, one keyword candidate |
| ADB-6 | Create     | Design a working agreement that states when an agent may open a pull request.                                       | covered                                           |

The German plan also contains "Development Team" and "Produktverantwortlicher", so that `check_terms` has something to find. The fixed plan closes all gaps (second demo run: clean).

## 16. Project layout and tooling

```
course-standards-mcp/
  src/server.ts                 wiring: McpServer, stdio transport, registration
  src/config.ts                 environment, allowed roots, limits
  src/data/                     catalogs.ts, termbase.ts, rubric.ts (load and validate YAML)
  src/extract/                  markdown.ts, csv.ts, references.ts, activityTypes.ts
  src/alignment.ts              extraction → library agenda → computeCoverage → status, findings, needs_judgment
  src/terms.ts                  term matching and locale rules
  src/errors.ts                 domain error codes, hints, internal-error guard
  src/tools/  src/resources/  src/prompts/
  src/types/learning-objective-lint.d.ts   typed boundary to the library
  data/  examples/              fictional only
  test/                         node:test
  docs/design.md
```

- **Dependencies:** `@modelcontextprotocol/server` 2.4.0, `zod` ^4.2, `js-yaml` ^4.1, `learning-objective-lint` (pinned commit). The library's `@anthropic-ai/sdk` dependency is installed but never loaded: `review` is not used, and the SDK is required lazily.
- **Development:** TypeScript (`strict`, `NodeNext`), ESLint, Prettier, MCP Inspector through `npx`.
- **Commits:** small, with English messages, made under your personal GitHub identity. The repo-local `user.email` gets set to the noreply address that `learning-objective-lint` uses; the global Git address is the company one.

## 17. Test plan (phase 3)

1. **Unit tests with fictional data:**
   - a fully covered mapping document
   - a missing objective
   - an Apply objective covered only by a lecture
   - a German plan against English objectives
   - an empty document
   - an unknown course
   - term hits: deprecated term, `ß` with `de-CH`, a translated role name
2. **Equivalence with the old checker:** with `format: agenda_yaml`, the server's statuses for the library's own example equal `lo-lint coverage` exactly (a golden test).
3. **Protocol hygiene:**
   - start the server as a child process and check that every stdout line is valid JSON-RPC;
   - check error paths: unknown tool → JSON-RPC error; unknown course → `isError` with `code` and `hint`.
4. **Output budget:** `check_alignment` on a 30-objective catalog stays under 8,000 tokens (estimated as characters / 4).
5. **MCP Inspector:** all tools, resources and the prompt visible and callable.
6. **Claude Code:** `claude mcp add`, then an end-to-end run with the prompt template on the fictional plan. Also check whether Claude Code passes `structuredContent` or only the text to the model.
7. **One run with real material, local only.** Compare it with the existing prompt-based analysis (skill or agent) and with `lo-lint coverage`, and explain the differences.
8. **Leak checks:** `gitleaks detect --no-git -s .` and the portfolio denylist, both with zero hits.

## 18. Answered questions (11 November 2026)

1. **Library change A (section 14):** approved. It is committed locally in `learning-objective-lint`; the push to the public repository happens together with the first push of this server (phase 4), after your go.
2. **Real run in phase 3:** one of your German facilitator guides that cites objectives as `LO 1.4` and `LO 3.1–3.5`, against a local catalog derived from the course's mapping workbook. Both stay outside the repository.
3. **German term forms:** official forms. scrumguides.org publishes the 2020 guide in German in three versions (the standard version, a female version and a male version). The term base takes the standard version as its default and records the other two versions' forms as accepted variants, so `check_terms` does not flag them. Every form is verified against the PDFs in phase 2b.
4. **DE/CH rules:** only `ß` → `ss`.
5. **Fictional course (section 15):** confirmed.
6. **`path` input (D7):** confirmed.
