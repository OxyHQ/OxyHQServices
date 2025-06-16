# Contributing to OxyHQServices

Thank you for your interest in contributing to OxyHQServices! This document provides guidelines for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Code Style](#code-style)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

By participating in this project, you agree to maintain a welcoming and inclusive environment for all contributors.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a new branch for your feature or bug fix
4. Make your changes
5. Submit a pull request

## Development Setup

### Prerequisites

- Node.js 16+ 
- npm or yarn
- React 16.8+ (for UI components)
- React Native 0.60+ (for mobile components)
- TypeScript 4.0+ (recommended)

### Installation

```bash
# Clone the repository
git clone https://github.com/oxyhq/oxyhqservices.git
cd oxyhqservices

# Install dependencies
npm install --legacy-peer-deps

# Build the project
npm run build

# Run tests
npm test
```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-new-component`
- `fix/authentication-bug`
- `docs/update-readme`

### Commit Messages

Follow conventional commit format:
- `feat: add new authentication method`
- `fix: resolve token refresh issue`
- `docs: update API documentation`
- `test: add unit tests for user service`

## Submitting Changes

1. **Create an Issue**: For significant changes, create an issue first to discuss the proposed changes
2. **Fork and Clone**: Fork the repository and clone it locally
3. **Create Branch**: Create a new branch from `main`
4. **Make Changes**: Implement your changes with appropriate tests
5. **Test**: Ensure all tests pass and add new tests if needed
6. **Document**: Update documentation if your changes affect the API
7. **Submit PR**: Create a pull request with a clear description

### Pull Request Guidelines

- Provide a clear description of the changes
- Include the issue number if applicable
- Ensure all tests pass
- Update documentation as needed
- Keep the PR focused on a single feature or fix

## Code Style

### TypeScript

- Use TypeScript for all new code
- Follow existing code style and patterns
- Use proper type annotations
- Avoid `any` types when possible

### Formatting

The project uses Biome for linting and formatting:

```bash
# Lint code
npm run lint

# Type check
npm run typescript
```

### File Structure

- Place React components in `src/ui/components/`
- Place core services in `src/core/`
- Place types in `src/types/`
- Place tests alongside their corresponding files

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch
```

### Writing Tests

- Write unit tests for all new functionality
- Use Jest and React Testing Library
- Place test files alongside the code they test
- Use descriptive test names

### Test Guidelines

- Test the public API, not implementation details
- Mock external dependencies
- Use factories for test data
- Test error conditions and edge cases

## Documentation

### API Documentation

- Document all public methods and properties
- Use JSDoc comments for TypeScript functions
- Include usage examples
- Update the appropriate `.md` files in the `docs/` directory

### README Updates

When adding new features:
- Update the main README.md if needed
- Add examples to the quick start guide
- Update the documentation index

### Documentation Structure

```
docs/
├── README.md              # Main documentation index
├── quick-start.md         # Getting started guide
├── core-api.md           # Core API reference
├── ui-components.md      # UI components guide
├── installation.md       # Installation guide
├── troubleshooting.md    # Common issues
└── examples/            # Code examples
```

## Release Process

Releases are handled by maintainers:

1. Version bump using semantic versioning
2. Update CHANGELOG.md
3. Create release notes
4. Publish to npm

## Getting Help

- **Issues**: Check existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions
- **Documentation**: Check the docs/ directory
- **Examples**: Look at the examples/ directory

## Recognition

Contributors are recognized in:
- Release notes
- Contributors section (if added)
- Special acknowledgments for significant contributions

Thank you for contributing to OxyHQServices! 🚀