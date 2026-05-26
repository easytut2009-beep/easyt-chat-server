# Search Regression Guards

This file defines non-negotiable behavior for catalog retrieval and card rendering.
Any change in `src/brain/` must preserve these points unless explicitly approved.

## Title-First Queries

- For short/direct course-name queries (for example: "`كورس <topic>`"), when title/structured matches exist:
  - Prefer title/structured results.
  - Do not rely on lesson/chunk enrichment for expanding unrelated courses.
  - Avoid LLM title-prune side effects that collapse multiple explicit title hits into one card.

## Context-Specific Queries

- For compound intent (topic + use case), avoid broad AI-only matches.
- If intent declares specific technical terms via intent JSON (`terms_en` / `tools`), course relevance should respect that context and not pass generic-only matches.

## Description Highlighting

- If a search term appears in course description, render it highlighted in yellow in the description block.
- Highlighting must not alter title rendering.
- Highlight rendering must remain HTML-safe (escaped output).

## Regression Safety

- `npm test` must include checks for description highlighting behavior.
- Before shipping search/card changes, run a burn-in stability check:
  - `npm run test:burnin30`
  - Must pass all 30 consecutive runs with zero failures.
- Any PR touching catalog search or card rendering should verify:
  - Direct-title query still returns all explicit matches.
  - Compound context query does not degrade into generic unrelated AI courses.
