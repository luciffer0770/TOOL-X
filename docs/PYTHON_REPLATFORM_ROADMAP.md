# ATLAS Python Replatform Roadmap (From Current Tool)

## Objective

Rebuild ATLAS as an organization-standard, Python-first platform while preserving business behavior and enabling controlled migration from the legacy implementation.

## Current Delivery in This Commit

- New greenfield Python platform scaffold under `atlas_py/`.
- Core domain/API modules:
  - authentication
  - project CRUD
  - activity CRUD (role-aware patch restrictions)
  - baselines (create/restore)
  - actions
  - scenarios
  - portfolio metrics endpoint
- Test suite + lint/type/security toolchain baseline.

## Migration Strategy

### Phase A: Platform Foundation (complete in this baseline)
- Security baseline, typed contracts, persistence model.
- CI quality gates.
- Seed data and development runtime.

### Phase B: Data and domain parity
- Port legacy analytics logic fully into Python service layer.
- Add deterministic migration pipeline for existing state data.
- Add DB migrations (Alembic) and environment promotion controls.

### Phase C: UI migration
- Build server-driven UI/API boundary as Python-native product surface.
- Migrate each legacy feature area:
  1. Dashboard KPIs
  2. Activity Master workflows
  3. Gantt + dependency logic
  4. Calendar/network/materials/intelligence/risk/anomaly
- Keep compatibility adapters while modules are cut over.

### Phase D: Operations hardening
- Full observability (structured logs, metrics, tracing).
- Backup/restore workflow with signed artifacts and recovery drills.
- Security monitoring and release governance.

## Definition of Done for Full Replatform

- Legacy implementation no longer required for runtime features.
- Python platform reaches feature parity and passes acceptance tests.
- Security and quality gates are enforced in CI/CD.
- Operational runbooks and support documentation are finalized.
