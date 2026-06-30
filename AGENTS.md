# Repository Guidelines

## Project Structure & Module Organization

The project root contains all source code, configuration, and documentation. The general layout follows this convention:

- `public/` — frontend static assets (HTML, CSS, JavaScript)
- `public/css/` — stylesheets
- `public/js/` — frontend JavaScript modules
- `data/` — persistent data files (not tracked in Git)
- `test/` — test files
- Root level — Node.js backend files (`server.js`, `package.json`)

## Project Documentation

The following documents define the project specification and design. Agents should read the relevant document(s) before starting work on a related task.

| Document | Path | When to Read |
|----------|------|-------------|
| 需求分析文档 (Requirements) | [需求分析文档.md](/C:/Users/18792/Documents/dongdong/需求分析文档.md) | Before any implementation work — defines what to build |
| 架构设计文档 (Architecture) | [架构设计文档.md](/C:/Users/18792/Documents/dongdong/架构设计文档.md) | Before backend or deployment changes — system structure, API contracts, data flow |
| 详细设计文档 (Detailed Design) | [详细设计文档.md](/C:/Users/18792/Documents/dongdong/详细设计文档.md) | Before any code implementation — component design, data models, integration details |
| 工作进度文档 (Progress) | [工作进度文档.md](/C:/Users/18792/Documents/dongdong/工作进度文档.md) | Before and during implementation — track completed steps |

## Project Constraints & Conventions

The following rules apply to all implementation work in this project:

### Code Style
- **Code comments must be written in Chinese**. All inline comments, JSDoc, and documentation comments should use Chinese.
- Frontend uses **pure HTML/CSS/JS only** — no Vue, React, or other frameworks.
- Backend uses **Node.js + Express** — keep dependencies minimal.
- CSS uses **CSS Variables** for theming and follows a dark financial theme.
- Indentation: **2 spaces** for all files.

### Implementation Rules
- Each feature must include **corresponding tests** before being considered complete.
- The price refresh mechanism must use **polling (not WebSocket)** — 10-15 second intervals.
- Price data must be fetched server-side; the frontend only calls the backend API.
- Admin differentials must be **persisted to disk** (JSON file) so they survive server restarts.
- The admin password must be configured via **environment variable** (`ADMIN_PASSWORD`), never hardcoded.
- Recycling price formula: `回收价 = 国内实时价 − 管理员差价`.

### Naming Conventions
- Files and directories: `kebab-case`
- JavaScript variables and functions: `camelCase`
- CSS classes: `kebab-case`
- API routes: lowercase with kebab-case path segments

### Testing
- Use **Mocha + Chai + Supertest** for backend API tests.
- Tests go in the `test/` directory, mirroring the source structure with `.test.js` suffix.
- Run tests with `npm test` before marking any feature complete.

## Build, Test, and Development Commands

- `npm start` — start the production server
- `npm run dev` — start the development server with auto-restart
- `npm test` — run the full test suite

## Coding Style & Naming Conventions

- **Indentation**: 2 spaces per level.
- **Naming**:
  - Files and directories: `kebab-case`
  - Variables and functions: `camelCase`
  - Constants: `SCREAMING_SNAKE_CASE`
  - CSS classes: `kebab-case`
- **Comments**: All code comments in Chinese.

## Testing Guidelines

- **Framework**: Mocha + Chai + Supertest.
- **Coverage**: Aim for 80%+ coverage on new code.
- **Test naming**: Use descriptive names — `describe("feature") / it("should behave")` pattern.
- **Running tests**: `npm test` runs the full suite.

## Commit & Pull Request Guidelines

- **Commit messages**: Follow Conventional Commits: `type(scope): short description`. Keep under 72 characters.
- **Pull requests**:
  - Title matches the commit convention.
  - Description includes motivation, approach, and breaking changes.
  - One logical change per PR.

## Agent-Specific Instructions

This file (`AGENTS.md`) is the canonical reference for AI coding agents contributing here. Agents should:
1. Read this file first to locate project documentation and understand constraints.
2. Read the relevant specification documents before implementing changes.
3. Update [工作进度文档.md](/C:/Users/18792/Documents/dongdong/工作进度文档.md) after completing each implementation step.
4. Run `npm test` before concluding a task.
5. Write all code comments in Chinese.
