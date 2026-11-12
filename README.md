# course-standards-mcp

An MCP server that checks course material against learning objectives written in English with a Bloom level, and against a German/English term base for Scrum.

_Built in November 2026 with Claude Code as co-developer._

## Problem

Course descriptions, mapping documents and facilitation plans have to meet learning objectives that are written in English and pitched at a Bloom level, while the material itself is often written in German and translated back and forth. Checking by hand whether an _Apply_ objective is really practised, or only lectured, and whether the German text uses the official Scrum terms, is slow and inconsistent.

## What it does

The server reads a document and reports, per learning objective, what it can establish for certain: which block cites the objective, which kind of activity it is, how far that activity plausibly reaches on Bloom's scale, and how much time it gets. Where that is not enough, it asks the question the model has to answer, with the criteria from a rubric. It never decides "met" itself.

| Tool                       | What it does                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_learning_objectives` | Objectives of a course (id, English text, Bloom level); optionally with a lint of their wording. Without a course id: the available courses.                                                                                                                                   |
| `check_alignment`          | A facilitation plan, mapping document or course description (German or English) against a course's objectives: status `covered` / `partial` / `unclear` / `missing`, evidence with line numbers, findings such as `passive_only`, minutes, and `needs_judgment` per objective. |
| `check_terms`              | A text against the term base: deprecated terms ("Development Team"), core terms that must stay English ("Produktverantwortliche" → Product Owner:in), unofficial German forms, and `ß` in Swiss German texts.                                                                  |
| `lookup_term`              | One term: official German form, accepted variants, deprecated and wrong forms, source.                                                                                                                                                                                         |

| Resource                                   | Content                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `course://{course_id}/learning-objectives` | the catalog of one course                                                                                                     |
| `rubric://bloom`                           | per Bloom level: what participants observably do, verbs (EN/DE), activity types and their level ceilings; met / weak / missed |
| `termbase://en-de`                         | the term base, with sources (data licence CC BY-SA 4.0)                                                                       |

| Prompt                     | Arguments                                            | Does                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate_course_material` | `course_id`, `document`, `document_type`, `language` | walks the model through objectives → rubric → `check_alignment` → judgment of every open objective → `check_terms` → a report table (objective · status · reason · location · suggestion) |

All tools are read-only. The server needs no API key.

## Where judgment lives

Whether a plan meets an objective at level _Apply_ is a judgment, not a string comparison. This server splits the work:

- **Deterministic findings in the server.** References such as `LO 3` or `LO 3.1–3.5`, minutes, activity types from cue words (_Übung_, _Vortrag_, _case study_ …), the highest Bloom level such an activity plausibly reaches, time share. Same input, same output; plain unit tests.
- **Judgment in the model.** Each objective comes with a `needs_judgment` question and a priority, and the result lists the rubric criteria for each target level once. The model in Claude Code or Claude Desktop answers the questions, cites the evidence and decides _met_, _weak_ or _missed_, where the user can see and challenge it.
- **The rubric as a resource.** `rubric://bloom` is generated from the same file the server uses to classify activities, so what the server computes and what the model reads cannot drift apart.

The alternatives were a model call inside the server (needs a key, costs extra, not reproducible) and MCP sampling (deprecated in the 2026-07-28 specification). The reasoning is in [docs/design.md](docs/design.md), section 4.

The server says what it could not decide: evidence found only by keywords has `confidence: low`, untyped blocks make an objective `unclear`, and every result lists the heuristics it applied under `limits`.

## Quick start

Requires Node.js 22.18 or later.

```bash
git clone --recurse-submodules <this repository>
cd course-standards-mcp
npm install
npm run build
npm test
```

[learning-objective-lint](https://github.com/andreasschliep/learning-objective-lint) is a git submodule in `vendor/`, pinned to one commit, and npm links it from there. If you cloned without `--recurse-submodules`, run `git submodule update --init` before `npm install`.

Try it without a client, with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector --cli node dist/server.js --method tools/list
```

### Claude Code

```bash
claude mcp add --transport stdio --scope local course-standards -- node /absolute/path/to/course-standards-mcp/dist/server.js
```

Then, in an interactive session:

```text
/course-standards:validate_course_material ADB adb-facilitation-plan-de.md facilitation_plan de
```

or simply ask: "Check `adb-facilitation-plan-de.md` against the objectives of course ADB."

### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "course-standards": {
      "command": "node",
      "args": ["/absolute/path/to/course-standards-mcp/dist/server.js"]
    }
  }
}
```

## Example (fictional course)

`data/courses/ADB.yaml` describes _Agentic Development Basics_, an invented 90-minute workshop with six objectives. `examples/adb-facilitation-plan-de.md` is a German plan with two deliberate gaps; `adb-facilitation-plan-de-fixed.md` closes them.

`check_alignment` on the plan with gaps:

| Objective | Level      | Status  | Best evidence                                              | Findings       |
| --------- | ---------- | ------- | ---------------------------------------------------------- | -------------- |
| ADB-1     | Understand | covered | 2.1 Wie ein Agent arbeitet (lines 24-28, Understand)       | –              |
| ADB-2     | Apply      | covered | 2.2 Aufträge für Agenten (lines 30-34, Apply)              | –              |
| ADB-3     | Apply      | partial | 2.3 Agenten-Output prüfen (lines 36-40, lecture only)      | `passive_only` |
| ADB-4     | Analyse    | covered | 3.1 Agent oder Mensch? (lines 46-50, Analyse)              | –              |
| ADB-5     | Evaluate   | missing | 3.2 Grün heißt nicht fertig (keyword candidate "Testlauf") | –              |
| ADB-6     | Create     | covered | 4.1 Unsere Arbeitsvereinbarung (lines 60-64, Create)       | –              |

`check_terms` finds "Development Team" (deprecated since the 2020 Scrum Guide) and "Produktverantwortliche" (the accountability stays English). With the prompt template, Claude judged ADB-3 and ADB-5 as _weak_ and proposed a pair exercise and an evaluation exercise; the fixed plan comes out clean. The full run is in [docs/verification.md](docs/verification.md). **All example data is fictional.**

## Your own data

The server reads its data from folders you configure, so real catalogs and documents never need to be in this repository.

| Variable                    | Default                    | Purpose                                                                 |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `COURSE_STANDARDS_COURSES`  | `data/courses`             | catalog folders, separated by `:`; a later folder overrides a course id |
| `COURSE_STANDARDS_DOCS`     | `examples`                 | folders from which `document.path` may be read, separated by `:`        |
| `COURSE_STANDARDS_TERMBASE` | `data/termbase/en-de.yaml` | term base file                                                          |

A catalog is the [learning-objective-lint](https://github.com/andreasschliep/learning-objective-lint) objectives format (`modules[].objectives[]` with `id`, `level`, `text`) plus two optional keys:

```yaml
metadata:
  id: ADB
  references:
    prefixes: [LO, Lernziel]
    id_template: 'ADB-{n}' # "LO 3" in a document means ADB-3
modules:
  - id: M2
    objectives:
      - id: ADB-3
        level: Apply
        text: Apply a five-point checklist to an agent-generated change before merging it.
        keywords: { de: [Checkliste, Änderung, mergen] } # for passages that do not cite the id
```

Pass the variables with `claude mcp add --env KEY=value …` or in the Claude Desktop config. `.gitignore` excludes `local/` and `*.local.yaml`.

## Limits

An activity label is not what participants do; cue words in material lists can lift a block's ceiling; keyword matches across languages are weak; a block that serves three objectives counts its minutes for each; a plan is not the training. The server reports these as `unclear`, low confidence or `limits` instead of claiming a verdict. Details: [docs/design.md](docs/design.md), section 11.

## How this was built

What existed before: a lint for learning-objective wording (Bloom verbs, eight anti-patterns) in my private training tooling. In November 2026 I published it as [learning-objective-lint](https://github.com/andreasschliep/learning-objective-lint) and added a coverage check for structured agendas and an optional model review.

What is new here: the MCP server, the extraction of activities, times and references from Markdown and CSV documents, the bilingual activity-type lexicon, the rubric as a resource, the term base with `check_terms` and `lookup_term`, and the prompt template. The server uses the library as a dependency; on the library's own example it returns exactly the same coverage statuses.

Claude Code was co-developer: it drafted much of the code, the tests and the documentation. I defined the problem, decided the design ([docs/design.md](docs/design.md)), reviewed every phase before the next one started, and made the calls on scope, data and licences. The term base was checked against the three German versions of the 2020 Scrum Guide; real course material was used only locally, for one comparison run.

## Licences

- Code: MIT, see [LICENSE](LICENSE).
- `data/termbase/en-de.yaml`: CC BY-SA 4.0. The term pairs come from the [Scrum Guide 2020](https://scrumguides.org) by Ken Schwaber and Jeff Sutherland and its official German translation with the translators' glossary, published under CC BY-SA 4.0.
- Bloom's revised taxonomy: L. W. Anderson & D. R. Krathwohl (Eds.), _A Taxonomy for Learning, Teaching, and Assessing_, 2001.

## Related tools

- [learning-objective-lint](https://github.com/andreasschliep/learning-objective-lint): lint learning objectives against Bloom's taxonomy and check agenda coverage (the library this server builds on)
- [facilitation-planner](https://github.com/andreasschliep/facilitation-planner): plan a session backwards from acceptance sentences
- [miro-board-builder](https://github.com/andreasschliep/miro-board-builder): describe a Miro board in YAML and build it through the REST API
