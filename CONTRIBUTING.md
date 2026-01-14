# Contributing to Drug Safety MCP

Thank you for your interest in contributing to the Drug Safety MCP server!

## Development Setup

1. Clone the repository:
```bash
git clone https://github.com/sine-ai/drug-safety-mcp.git
cd drug-safety-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build:
```bash
npm run build
```

4. Run tests:
```bash
npm test
```

## Code Standards

### TypeScript
- Use strict TypeScript (`strict: true` in tsconfig)
- Prefer explicit types over `any`
- Document public functions with JSDoc comments

### Formatting
- Run `npm run format` before committing
- Follow existing code style
- Use meaningful variable and function names

### Testing
- Add tests for new functionality
- Ensure existing tests pass: `npm test`
- Aim for good coverage of edge cases

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run linting: `npm run lint`
6. Commit with a clear message following conventional commits:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `refactor:` for code refactoring
7. Push and create a Pull Request

## Adding New Tools

When adding a new tool:

1. Add the tool definition in `src/tools/definitions.ts`:
   - Include clear `name` (under 64 characters)
   - Write precise `description` matching actual functionality
   - Define complete `inputSchema` with all parameters
   - Add `annotations` with `readOnlyHint`, `destructiveHint`, `title`

2. Add the handler in `src/tools/handlers.ts`:
   - Validate all inputs with helpful error messages
   - Handle API errors gracefully
   - Include the FAERS disclaimer in responses
   - Add visualization hints where appropriate

3. Update the handler router switch statement

4. Add tests for the new tool

5. Update README.md with the new tool

## Maintenance Standards

Per Anthropic's Software Directory Policy, we maintain:

- **Security**: Regular dependency updates, vulnerability scanning
- **Quality**: Comprehensive error handling, input validation
- **Compatibility**: Compliance with MCP specification
- **Documentation**: Up-to-date README and inline comments

## Reporting Issues

- **Bugs**: Open a GitHub issue with reproduction steps
- **Security**: See [SECURITY.md](SECURITY.md)
- **Features**: Open a GitHub issue for discussion first

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help maintain a welcoming community

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
