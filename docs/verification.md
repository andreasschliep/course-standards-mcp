# Verification (phase 3)

Run on 12 November 2026 against commit `3ad7f56`. Everything in this file uses the fictional course ADB. The run with real material happened locally; only numbers are reported here (section 4).

## 1. Tests

`npm run check`: TypeScript, ESLint, Prettier and **47 tests, all passing**, including 10 that start the server as a child process and talk to it over stdio with the official MCP client.

| Case                                      | Test                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Fully covered mapping document            | `alignment.test.ts`: "a fully covered mapping document"                                           |
| Missing objective                         | demo plan: ADB-5 `missing` with one keyword candidate                                             |
| Apply objective covered only by a lecture | demo plan: ADB-3 `partial` + `passive_only`                                                       |
| German plan against English objectives    | demo plan (`adb-facilitation-plan-de.md`)                                                         |
| Empty document                            | `empty_document` (alignment and terms)                                                            |
| Unknown course                            | `unknown_course` with the available ids as hint; as a resource: JSON-RPC error                    |
| Deprecated term                           | "Development Team" → Developer:innen                                                              |
| `ß` with `de-CH`                          | "heißt" → "heisst" (error)                                                                        |
| Translated role name                      | "Produktverantwortliche" → Product Owner:in                                                       |
| Same answer as the existing checker       | `agenda_yaml` on learning-objective-lint's own example equals `lo-lint coverage` status by status |
| Output budget                             | 30 objectives stay under 8,000 tokens (first run: about 8,300; fixed by `criteria_by_level`)      |
| stdout hygiene                            | every protocol test fails if a non-JSON-RPC byte reaches stdout                                   |

## 2. MCP Inspector

`npx @modelcontextprotocol/inspector@2.14.0 --cli node dist/server.js …`

| Method                                       | Result                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `tools/list`                                 | 4 tools, all `readOnlyHint`, all with `outputSchema`                                                                          |
| `resources/list`, `resources/templates/list` | `rubric://bloom`, `termbase://en-de`, `course://ADB/learning-objectives`; template `course://{course_id}/learning-objectives` |
| `prompts/list`, `prompts/get`                | `validate_course_material` with `course_id`, `document`, `document_type`, `language`                                          |
| `tools/call` × 4                             | each tool answers with text and `structuredContent`                                                                           |
| `tools/call` with an unknown course          | `isError: true`, `unknown_course: …` plus hint, no `structuredContent`                                                        |
| `resources/read` × 3                         | JSON, Markdown, JSON (the term base without the local file path)                                                              |

## 3. Claude Code

`claude mcp add --transport stdio --scope local course-standards -- node <repo>/dist/server.js` → ✔ Connected.

**End-to-end run with the prompt template** (`claude -p` with the template text, Claude Opus 5.5, 9 turns, 45 s): the model called `list_learning_objectives` → `rubric://bloom` → `check_alignment` → `check_terms`, read the plan, and reported in German:

| Objective        | Verdict     | Reason (shortened)                                                                                                                   |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ADB-1 Understand | erfüllt     | participants explain the loop to each other on their own example (lines 24–28)                                                       |
| ADB-2 Apply      | erfüllt     | pairs write a brief with the template and run the agent (30–34)                                                                      |
| ADB-3 Apply      | **schwach** | only a lecture; nobody applies the checklist (36–40); proposal: 10 minutes pair exercise on the change from 2.2                      |
| ADB-4 Analyse    | erfüllt     | groups sort unseen task cards and compare reasons (46–50)                                                                            |
| ADB-5 Evaluate   | **schwach** | keyword candidate only; story and plenary, no criteria, no own judgment (52–56); the model said it hesitated between weak and missed |
| ADB-6 Create     | erfüllt     | groups design the working agreement, every draft gets feedback (60–64)                                                               |

Term findings: "Development Team" (line 40) and "Produktverantwortliche" (line 64). The "what the server could not decide" section named the keyword-only evidence for ADB-5 and the upper-bound minutes.

**Finding:** in print mode (`claude -p "/course-standards:validate_course_material …"`) the MCP prompt was not available as a slash command; the model rebuilt the workflow from the tools but reported in English. The run above passes the template text that `prompts/get` returns. Interactive Claude Code lists MCP prompts as `/server:prompt`; check this before a demo.

## 4. Real material (local only)

One real German facilitator guide (two days, 20 blocks) of an advanced Scrum Master course, checked with a catalog derived locally from the guide's own objective cross-check: ids and domains only, because the official objective texts and Bloom levels in this numbering were not available locally. Guide, catalog and protocols stay outside this repository.

|                                                                            | Result                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objectives cited by at least one block                                     | 40 of 42                                                                                                                                                                                 |
| Differences between block headers and the guide's own cross-check appendix | 19 objectives (e.g. a block header cites five objectives, the appendix assigns it one)                                                                                                   |
| Range the author had marked as a numbering anomaly                         | reported as unknown reference, not guessed                                                                                                                                               |
| Blocks without a recognised activity type                                  | 2                                                                                                                                                                                        |
| Term findings                                                              | 0                                                                                                                                                                                        |
| End-to-end run                                                             | the model judged the two uncited objectives as provisionally weak, explained the header/appendix mismatch, and gave no final verdicts for the rest because texts and levels were missing |

**Compared with the existing checkers:**

- _learning-objective-lint coverage_: same statuses on structured agendas (equivalence test); it cannot read Markdown guides, which is what this server adds.
- _The guide's own cross-check_ (made with the earlier prompt-based workflow): 23 of 42 objectives map to the same blocks, 19 differ. The deterministic check makes the drift between headers and appendix visible.
- _The objective list in the course's review-agent prompt_ uses a different numbering. Checked against that list, 37 objectives come out "covered" by id although the ids mean different objectives: id matching cannot detect a wrong catalog. This is why the catalog is data with a source and why the verdict needs judgment.

**Fixed because of the real run:** the reference parser stopped at a note in brackets (`LO 1.5–1.7 [see note], 2.4–2.8`) and missed the rest of the list (commit `4ac1583`).

## 5. Leak checks

| Check                                                                                      | Result   |
| ------------------------------------------------------------------------------------------ | -------- |
| `gitleaks detect` on the git history                                                       | no leaks |
| `gitleaks detect --no-git -s .`                                                            | no leaks |
| Denylist of client, company and confidential terms over tracked files and the full history | 0 hits   |
| Names of the real course or its files in tracked files                                     | 0 hits   |
