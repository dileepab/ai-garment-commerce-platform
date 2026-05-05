# AGENTS.md

## Token-saving rules
- This is a large repository. Do not scan the whole repo.
- First inspect only files directly related to the task.
- Use search or grep before opening full files.
- Do not open generated files, build output, logs, lockfiles, or large data files.
- Ask before reading very large files unless absolutely necessary.
- Make minimal patches.

## Next.js rules
- This project uses Next.js 15.
- Do not assume old Next.js behavior.
- For routing, `params` and `searchParams` may be async and should be awaited where required.
- Prefer existing project patterns over generic Next.js examples.
- Only read Next.js docs when the task is specifically about a Next.js API or breaking change.

## Project workflow
- Before editing, summarize:
  1. likely relevant files
  2. planned change
  3. smallest test/build command to run
- Do not run full test/build unless needed.
