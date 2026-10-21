<p align="center">
  <img src="apps/frontend/public/branding/kaipilot-lockup-light.svg" alt="KaiPilot" width="360" />
</p>

# KaiPilot (开项)

**English** | [简体中文](README.zh-CN.md)

**Start a project with one sentence and let AI draft the whole plan. Professional project managers stay in control, and newcomers can use it too.**

KaiPilot is an open-source, self-hosted AI project management platform, built natively for Simplified Chinese. Describe your project in one sentence and AI drafts a project charter, WBS, tasks and acceptance criteria. The draft becomes a real project only after you review and confirm it item by item. AI only makes suggestions; it never applies changes on its own.

> KaiPilot is the open-source personal edition of **Zhixiang (智项)**. Governance features for corporate IT and management teams are provided by **Zhixiang Enterprise** (see "Enterprise edition" below).

The user interface, help center and AI output are in Chinese (Simplified, with Traditional variants). The other documents in this repository are in Chinese.

## Features

| Area                       | What KaiPilot (this repository) provides                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AI project setup           | One-sentence project drafts, follow-up question cards, rule checks and anti-hallucination checks, human review before saving   |
| Planning and execution     | WBS, Gantt chart (with drag-to-simulate what-if), Kanban, list, calendar, timeline; tasks, milestones and dependencies         |
| Management                 | Risk register, change requests, resources and workload, reports, project health                                                |
| Multiple projects          | PMO decision workbench, portfolios, OKRs, strategy execution cockpit, cross-project dependencies and resources                 |
| AI colleague               | Ask AI questions on any page, preview the changes it proposes (saved only after you confirm), contradiction solving (TRIZ)     |
| Knowledge and documents    | Knowledge base, file library, OCR and document intelligence (bring your own provider)                                          |
| Collaboration              | Organizations, member invitations, 6 roles plus project roles, audit log, two-factor sign-in, Google sign-in (own credentials) |
| Integrations and extension | GitHub / GitLab, Google Calendar, webhooks, Web Push (own credentials); plugins and skills                                     |
| Instance administration    | User management, global audit log, compiler routing; create the instance administrator from the command line                   |

AI features use your own model keys: add an OpenAI-compatible, Anthropic or other provider under **Settings → AI connections** (设置 → AI 连接). Until a connection is available, AI drafts, the AI colleague and contradiction solving show a prompt asking you to add one, and no model is called.

## Quick start (local)

You need **Node.js 26** (`.nvmrc`) and **pnpm 12**. Node 26 no longer ships Corepack, so run `npm install -g corepack@0.36.0` and then `corepack enable` first.

```bash
# 1. Install dependencies
pnpm install

# 2. Prepare the backend environment file
cp apps/backend/.env.example apps/backend/.env
cd apps/backend
node ace generate:key          # writes APP_KEY
# Then replace JWT_ACCESS_SECRET in .env with its own random value, for example:
# node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

# 3. Create the tables (SQLite by default, no database server needed)
pnpm run codegen:indexes        # required once in a fresh checkout
node ace migration:run

# 4. Create the first administrator (you will be asked for a password)
node ace admin:create-super --email you@example.com
cd ../..

# 5. Start the frontend and backend
pnpm dev
```

The product introduction page is at <http://localhost:3000/welcome>. To start using KaiPilot, open <http://localhost:3000>:

1. Sign in with the account you just created;
2. Open **Settings → AI connections** and add your model key;
3. Go back to the home page, describe your project in one sentence, review the AI draft and confirm it as a project.

Inviting colleagues: KaiPilot has no self-service sign-up page. The instance administrator first creates an account by running `node ace user:create --email colleague@example.com --generate-password` in `apps/backend` (the password is shown once; pass it on), then invites that email address under **Settings → Organization**.

Releases do not include sample projects, demo accounts, a database or a local fake model server. On first start, follow the steps above to create your own administrator.

## Deploy with Docker Compose

```bash
cp .env.compose.example .env.compose
# Edit .env.compose as needed, for example the public address:
#   AIPROJ_PUBLIC_ORIGIN=https://pm.example.com
docker compose --env-file .env.compose up -d --build
```

This starts edge, frontend, backend, PostgreSQL and Redis, and exposes a single port (80 by default). Application secrets are generated on first start and kept in a data volume. To use a single-file SQLite stack instead: `docker compose -f compose.sqlite.yaml up -d --build`. Google sign-in is off by default; see `.env.compose.example` to configure it.

More deployment and operations notes are in the in-app help center under "Deployment and operations" (部署与运维).

## License

[AGPL-3.0](LICENSE)

## About `aiproj` in the code

`aiproj` is the project's internal code name. Package names (`@aiproj/*`), the environment variable prefix (`AIPROJ_`), database names and local storage keys keep it so existing deployments are not broken. The product name shown in the interface and documentation is KaiPilot (开项).

## Contributing

Maintainer: **evil9369**.

Issues and pull requests are welcome, and regular contributions do not require a CLA. See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues privately as described in [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Enterprise edition

The following features are provided by **Zhixiang Enterprise** and are not in this repository:

| Enterprise feature                                                  | Description                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Enterprise single sign-on (SAML 2.0 / OIDC) and SCIM directory sync | Connects to your identity system; members join and leave automatically      |
| Data loss prevention (DLP) and export watermarks                    | Detects, handles and traces sensitive data                                  |
| KMS key management, compliance readiness, enhanced enterprise audit | Encryption foundation, compliance evidence and audit evidence packs         |
| Multi-tenant governance console                                     | Governance views for organization isolation, connection pools and workflows |
| AI quality and cost console (with experiments), AI usage panel      | Unified view of model quality, cost and usage                               |
| Release trust center, unified AI call ledger                        | Release gate evidence and AI call auditing                                  |
| Managed service                                                     | SaaS operated by us, with built-in platform AI connections                  |

If you open the address of one of these pages in KaiPilot, you will see a page explaining that it is part of the enterprise edition.
