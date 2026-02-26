# Contributing to PayClaw MCP Server

Thanks for your interest in contributing! Here's how to get involved.

## Getting Started

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests: `npm test`
5. Commit with a clear message: `git commit -m "Add: description of change"`
6. Push and open a Pull Request

## Development Setup

```bash
git clone https://github.com/payclaw/mcp-server.git
cd mcp-server
npm install
```

You'll need a PayClaw test API key to run locally. Sign up at [payclaw.com](https://payclaw.com) and use a test key (`pk_test_...`).

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Add tests for new functionality
- Don't break existing tests

## Code Style

- TypeScript strict mode
- Prettier for formatting (`npm run format`)
- ESLint for linting (`npm run lint`)

## Reporting Issues

Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, MCP client)

## Security

If you discover a security vulnerability, **do not open a public issue.** Email security@payclaw.com instead. We'll respond within 48 hours.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
