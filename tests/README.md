# Eco-Ride Testing Commands

All commands assume you are in the **project root** (`Eco-Ride/`) unless a specific `cd` path is noted.

---

## Run All E2E Tests (Turbo)

```bash
pnpm test:e2e
```

Runs E2E tests across **web**, **server**, and **simulator** in parallel via Turborepo.

---

## Server (`apps/backend/server`)

```bash
cd apps/backend/server
```

### Unit Tests (controllers / middleware / utils)

| Command | Scope |
|---------|-------|
| `pnpm test` | All unit + integration tests |
| `pnpm test:auth` | Auth controller |
| `pnpm test:user` | User controller |
| `pnpm test:ride` | Ride controller |
| `pnpm test:fare` | Fare + Payment controllers |
| `pnpm test:rating` | Rating controller |
| `pnpm test:admin` | Admin + Saved‑locations controllers |

### Integration Tests

```bash
pnpm vitest run tests/integration/
```

### E2E Tests

| Command | Scope |
|---------|-------|
| `pnpm test:e2e` | All 3 E2E suites (40 tests) |
| `pnpm test:e2e:lifecycle` | Ride lifecycle flow |
| `pnpm test:e2e:onboarding` | User onboarding flow |
| `pnpm test:e2e:pooling` | Pooling + prediction flow |

### Utility

| Command | Description |
|---------|-------------|
| `pnpm test:coverage` | Run with coverage report |
| `pnpm test:watch` | Watch mode |
| `pnpm test:ui` | Vitest UI |

---

## Simulator (`apps/backend/simulator`)

```bash
cd apps/backend/simulator
```

### Unit Tests

```bash
pnpm test
```

### E2E Tests

| Command | Scope |
|---------|-------|
| `pnpm test:e2e` | All E2E (40 tests) |
| `pnpm test:e2e:agent` | Driver agent lifecycle |
| `pnpm test:e2e:engine` | Simulation engine lifecycle |

### Utility

| Command | Description |
|---------|-------------|
| `pnpm test:coverage` | Run with coverage report |
| `pnpm test:watch` | Watch mode |

---

## Web (`apps/web`)

```bash
cd apps/web
```

### E2E Tests (Playwright – 87 tests)

| Command | Description |
|---------|-------------|
| `pnpm test:e2e` | Headless (auto-starts dev server) |
| `pnpm test:e2e:headed` | With visible browser |
| `pnpm test:e2e:ui` | Playwright UI mode |

---

## Test Stack Summary

| Layer | Tool | Location |
|-------|------|----------|
| Unit | Vitest | `server/tests/controllers/`, `server/tests/middleware/`, `server/tests/utils/`, `simulator/tests/services/` |
| Integration | Vitest + Supertest | `server/tests/integration/` |
| E2E (backend) | Vitest + Supertest | `server/tests/e2e/`, `simulator/tests/e2e/` |
| E2E (web) | Playwright | `web/e2e/` |
