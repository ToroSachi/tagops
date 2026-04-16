# Contributing to tagops

The single highest-impact contribution is **a new vendor template.** Each template makes the CLI more useful to exactly the users we're trying to reach.

## Getting started

```bash
git clone https://github.com/ToroSachi/tagops.git
cd tagops
npm install
npm test       # 318 tests
npm run build
npm run dev -- --help
```

## Workflow

1. Fork the repo
2. Branch: `git checkout -b feat/my-vendor-template`
3. Make your changes
4. `npm test` and `npm run typecheck` must both pass
5. Open a PR

## Code style

- TypeScript strict mode
- Tools in `src/tools/` export pure functions
- Commands in `src/commands/` register Commander subcommands and call tools
- All commands support `--json` output for scripting

## Adding a vendor template

Templates live in `src/templates/vendors/`. Each exports a single `IntegrationTemplate` constant.

1. Create `src/templates/vendors/my-vendor.ts`. Use `meta-pixel.ts` as the reference.
2. Export a const with:
   - A unique `id` (kebab-case, e.g. `my-vendor`)
   - `requiredInputs` (can be empty)
   - One or more `tags` with HTML using `jsStringLiteral(inputs.x)` for safe interpolation
   - Consent types, trigger events, and data layer variables
3. Re-export from `src/templates/vendors/index.ts`
4. Add a test in `src/__tests__/templates.test.ts`

## Adding a command

1. Add the handler in the appropriate `src/commands/*.ts` (or create a new module and wire it into `src/cli.ts`)
2. Put the business logic in `src/tools/` as a pure function
3. Add a test in `src/__tests__/`
4. Update `README.md` only if the command is user-facing

## Tests

We use [Vitest](https://vitest.dev/). All tests must pass before merging:

```bash
npm test           # Run once
npm run test:watch # Watch mode
```

## Reporting Issues

Please include:

- Node.js version (`node -v`)
- `tagops` version (`tagops --version`)
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
