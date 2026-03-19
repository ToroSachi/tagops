# Contributing to tagops

Thank you for your interest in contributing! Here's how you can help.

## Getting Started

```bash
git clone https://github.com/gtm-auto/gtm-auto.git
cd gtm-auto
npm install
npm test
```

## Development Workflow

1. **Fork** the repository
2. Create a **feature branch**: `git checkout -b feat/my-feature`
3. Make your changes
4. **Run tests**: `npm test`
5. **Run type checks**: `npm run typecheck`
6. Submit a **Pull Request**

## Code Style

- TypeScript strict mode
- Use the existing naming conventions (see `src/lib/architecture.ts`)
- All new tools go in `src/tools/` and must export pure functions
- All new commands must support `--json` output for scripting

## Adding a Template

Templates live in `src/templates/registry.ts`. Each template needs:

1. A unique `id` (kebab-case, e.g. `my-vendor`)
2. `requiredInputs` array (can be empty for templates that need no config)
3. One or more `tags` with HTML that uses `${inputs.pixelId}` template literals
4. A test case in `src/__tests__/templates.test.ts`

## Adding a Tool

1. Create `src/tools/my-tool.ts` with exported functions
2. Add the CLI command in `src/cli.ts`
3. Add tests in `src/__tests__/my-tool.test.ts`
4. Update `README.md`

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
