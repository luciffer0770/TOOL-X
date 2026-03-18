# ATLAS Python Replatform: Standards Alignment Baseline

This document defines the organizational standards baseline used for the Python rewrite foundation.

## 1) Public Standards Used as Baseline

Because Bosch-internal coding standards are not publicly available, this implementation maps to publicly recognized frameworks commonly required in enterprise and automotive-grade engineering:

- **Automotive SPICE (ASPICE 4.0) process orientation**  
  Focus on requirements traceability, verification, and process maturity expectations (e.g., SWE.1 and SWE.6 discipline).
- **ISO/SAE 21434 secure development lifecycle concepts**  
  Security planning, secure coding guidance, verification, and vulnerability management through lifecycle stages.
- **NIST SP 800-218 (SSDF)**  
  Secure development practices integrated into day-to-day engineering execution.
- **OWASP ASVS (Level 2 target baseline)**  
  Practical application security requirements for web/API systems.
- **OpenSSF Secure Coding Guide for Python**  
  Language-specific secure coding guidance.

## 2) Engineering Baseline Enforced in This Rewrite

### Architecture and maintainability
- Python-first service architecture with clear separation:
  - `core` (security/config/logging)
  - `routers` (API contracts)
  - `services` (domain logic)
  - ORM models and typed schemas
- Strict typing and schema validation via Pydantic.

### Security controls
- Password hashing via bcrypt (`passlib`).
- JWT bearer authentication.
- Role-based authorization guards (planner/management/technician).
- Security static checks in CI via Bandit.

### Quality gates
- Ruff linting.
- MyPy strict typing.
- Pytest coverage-enabled test suite.
- CI pipeline includes lint, type-check, security scan, tests.

### Traceability and audit readiness
- Persistent audit event model included in schema baseline.
- Domain entities designed for project-level lifecycle records:
  - projects, activities, baselines, actions, scenarios.

## 3) Process Mapping (Implementation View)

| Process intent | Implementation in this baseline |
|---|---|
| Requirements and interface clarity | Typed request/response schemas + OpenAPI docs |
| Verification discipline | Automated tests + type checks + lint/security checks |
| Security engineering | AuthN/AuthZ controls + secure hashing + CI security scanning |
| Change control readiness | Structured modules + auditable entities and commits |
| Deployment readiness | Container-friendly app bootstrap + environment-driven settings |

## 4) Governance Model Recommended for Next Iterations

1. Establish architecture decision records (ADRs) for major design choices.
2. Define coding standard profile (lint rules, complexity thresholds, required test coverage).
3. Add threat modeling checklist and security review gates per feature.
4. Add migration scripts and immutable release versioning policy.
5. Add SAST/DAST and dependency vulnerability scanning in CI/CD.

---

If your organization provides internal Bosch-specific templates/checklists, they can be layered directly on top of this baseline without structural redesign.
