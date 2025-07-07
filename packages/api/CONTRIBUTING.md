# Contributing to Oxy API

Thank you for your interest in contributing to Oxy API! We welcome contributions from the community and are pleased to have you join us.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Code Style](#code-style)
- [Testing](#testing)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started 

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/oxy-api.git
   cd oxy-api
   ```
3. **Add the upstream repository**:
   ```bash
   git remote add upstream https://github.com/OxyHQ/oxy-api.git
   ```

## Development Setup

### Prerequisites

- Node.js 16 or higher
- MongoDB 4.4 or higher
- npm or yarn package manager

### Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start MongoDB** (if running locally):
   ```bash
   # macOS with Homebrew
   brew services start mongodb-community
   
   # Linux with systemd
   sudo systemctl start mongodb
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3001`.

## Making Changes

### Branch Naming

Create a feature branch from `main`:

```bash
git checkout main
git pull upstream main
git checkout -b feature/your-feature-name
```

Use descriptive branch names:
- `feature/add-user-authentication`
- `fix/session-timeout-bug`
- `docs/update-api-documentation`

### Commit Messages

Follow the conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

Examples:
```
feat(auth): add JWT token refresh endpoint
fix(sessions): resolve session timeout issue
docs(readme): update installation instructions
```

## Submitting Changes

### Pull Request Process

1. **Update your branch** with the latest changes:
   ```bash
   git checkout main
   git pull upstream main
   git checkout your-feature-branch
   git rebase main
   ```

2. **Push your changes**:
   ```bash
   git push origin your-feature-branch
   ```

3. **Create a Pull Request** on GitHub with:
   - Clear title describing the change
   - Detailed description of what was changed and why
   - Reference any related issues
   - Screenshots or examples if applicable

### Pull Request Requirements

- [ ] Code follows the project's coding standards
- [ ] Changes are tested locally
- [ ] Documentation is updated if needed
- [ ] Commit messages follow the conventional format
- [ ] No merge conflicts with main branch

## Code Style

### TypeScript Guidelines

- Use TypeScript strict mode
- Provide proper type annotations
- Use interfaces for object structures
- Follow existing naming conventions

### File Organization

```
src/
├── controllers/     # Route handlers
├── middleware/      # Express middleware
├── models/          # Database models
├── routes/          # Route definitions
├── services/        # Business logic
├── types/           # TypeScript type definitions
└── utils/           # Utility functions
```

### API Design

- Follow RESTful conventions
- Use appropriate HTTP status codes
- Provide consistent error responses
- Include proper authentication where needed

### Error Handling

```typescript
// Good: Proper error handling with types
try {
  const user = await User.findById(id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  res.json(user);
} catch (error) {
  console.error('Error fetching user:', error);
  res.status(500).json({ message: 'Internal server error' });
}
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (when available)
npm run test:watch
```

### Writing Tests

- Write tests for new features and bug fixes
- Follow existing test patterns
- Use descriptive test names
- Test both success and error cases

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

1. **Clear description** of the issue
2. **Steps to reproduce** the problem
3. **Expected behavior** vs actual behavior
4. **Environment details** (Node.js version, OS, etc.)
5. **Error messages** or logs if available

### Feature Requests

For feature requests, please provide:

1. **Clear description** of the desired functionality
2. **Use case** or problem it solves
3. **Proposed implementation** (if you have ideas)
4. **Alternatives considered**

### Issue Templates

Use the provided issue templates when creating new issues to ensure all necessary information is included.

## Documentation

### Updating Documentation

- Update relevant documentation when making changes
- Use clear, concise language
- Include examples where helpful
- Follow the existing documentation structure

### Documentation Structure

- `README.md` - Main project overview
- `docs/` - Detailed documentation
  - `installation.md` - Setup and installation
  - `authentication.md` - Auth system details
  - `api-reference.md` - API endpoints
  - `examples/` - Integration examples

## Getting Help

- **Issues**: Search existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions

## Recognition

Contributors will be recognized in the project's documentation and release notes. We appreciate all contributions, whether they're code, documentation, bug reports, or feature suggestions.

Thank you for contributing to Oxy API!