# Euro-Trousers HRMS & Payroll — Euro-Trousers

A production-structured **Enterprise HRMS & Payroll Management System** for **Euro-Trousers**, optimised for **UAE / Dubai** corporate compliance. Built on a clean **Node.js 20+ / Express (MVC)** backend, **MySQL 8** (fully normalised, ACID transactions), and a dependency-light **glassmorphism single-page frontend** (vanilla ES6 + Chart.js).

> Premium corporate theme: crisp white, vivid crimson accents, light-gray structural surfaces, sleek charcoal text — with glassmorphism panels, dark mode, and English/Arabic (RTL) localisation.

---

## ✨ Implemented modules (all 15)

| # | Module | Highlights |
|---|--------|-----------|
| 1 | Super Admin | Multi-tenant companies/branches/departments, RBAC (roles + granular permissions), system settings, **audit / security / login** logs |
| 2 | Employee Management | Tabbed profiles (personal, emergency contacts, status history), identity-document metadata (passport / Emirates ID / visa / contract) with **masked** references |
| 3 | Attendance | Daily grid, late/early/overtime engine, **biometric & Anviz CrossChex** ingestion wrappers, missing-attendance alerts, corrections pipeline |
| 4 | Leave | Annual/Sick/Emergency/Maternity, multi-tier workflow (pending → manager → HR → disbursed), live balances, team calendar |
| 5 | Payroll | Basic + housing/transport/food allowances, overtime processor (normal / Sunday / public-holiday), advances, loans, bonuses/incentives |
| 6 | Salary Processing | Individual + **bulk batch** runs, approval workflow, **Payroll Lock**, salary register, revision-history ledger |
| 7 | Salary Slip | Server-side **PDF** slips with logo, **QR verification hash**, acknowledgment + authorization blocks, email dispatch |
| 8 | Employee Self Service | Identity-safe dashboard, attendance/leave/payslip views, leave submission, announcements |
| 9 | Finance Reports | Payroll summary, department cost centers, overtime cost, outstanding advances, **bank-transfer CSV export** |
| 10 | Dashboard Analytics | Real-time counters + financial cards, interactive charts (workforce, payroll trend, cost centers) |
| 11 | UAE Compliance | **WPS SIF** file generation (SCR/SDR), MOL/MOHRE validation, document-expiry early warnings |
| 12 | Notifications | In-app + email transport, leave/payroll/birthday/expiry alerts |
| 13 | Security Gateways | bcrypt hashing, JWT + session, optional 2FA hook, RBAC guards, CSRF, input sanitisation, rate limiting |
| 14 | Document Management | UUID-keyed isolated storage, category repository, brokered downloads |
| 15 | Globalization | Multi-company / multi-branch / multi-currency, EN/AR i18n + RTL, dark mode, system backup |

---

## 🏗️ Architecture

```
Payroll-Euro-Trousers/
├── server.js                  # process entrypoint (graceful shutdown, health check)
├── src/
│   ├── app.js                 # Express app factory (helmet, CORS, sessions, routes)
│   ├── config/                # env, db pool + ACID transactions, i18n dictionary
│   ├── middleware/             # auth/RBAC, security (CSRF/sanitise), rate limit, upload, errors
│   ├── models/                 # data-access (parameterised SQL)
│   ├── controllers/            # one per module (MVC controllers)
│   ├── services/               # payroll & overtime engine, attendance engine, PDF, QR,
│   │                           #   WPS SIF, expiry monitor, notifications, backup, audit
│   └── routes/                 # express routers, aggregated in routes/index.js
├── database/
│   ├── migrations/             # 001 core, 002 operations, 003 audit (MySQL 8)
│   ├── seeds/seed.sql          # compliant mock data (masked identity references)
│   └── migrate.js              # up | fresh | seed runner (bcrypt user creation)
├── public/                     # glassmorphism SPA (index.html, css, js)
└── scripts/syntax-check.js     # dependency-free `npm run check`
```

**Money math** is performed in integer minor units (`src/utils/money.js`) — never raw floats — for precise net-salary aggregation. **All SQL** flows through parameterised helpers in `src/config/db.js`.

---

## 🚀 Getting started

### Prerequisites
- Node.js **20+**
- MySQL **8.0+**

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# edit .env with your MySQL credentials and secrets
```

### 3. Create schema + seed data
```bash
npm run setup        # = migrate:fresh + seed
# or individually:
npm run migrate      # apply migrations
npm run seed         # load mock data + default users
```

### 4. Run
```bash
npm start            # http://localhost:3000
# or: npm run dev    (nodemon)
```

### 5. Validate sources (no DB/deps needed)
```bash
npm run check        # syntax-checks every .js file
```

---

## 🔐 Default demo accounts

All seeded users share the password **`Admin@123`** (override with `SEED_DEFAULT_PASSWORD`).

| Username | Role | Scope |
|----------|------|-------|
| `superadmin` | Super Admin | Everything |
| `hr.manager` | HR Manager | Employees, leave, documents |
| `payroll` | Payroll Officer | Payroll, payslips, finance, WPS |
| `manager.imran` | Manager | Team leave approvals |
| `arun.kumar` | Employee | Self-service portal |

---

## 🛡️ Privacy & compliance notes

- Sensitive identity numbers (Emirates ID, passport) are stored and rendered **only as masked structural placeholders** (e.g. `784-XXXX-XXXXXXX-X`). No real credentials are embedded anywhere in code or seed data.
- WPS routing/employer identifiers come from configuration (`env.wps`) and default to structural placeholders.
- Salary slips include a QR code that links to a server-side **verification endpoint** validating an HMAC hash of the slip's immutable fields.

---

## 🌐 Deployment

Stateless and cluster-ready (suitable for **Hostinger Application Manager**): no in-process state beyond the shared DB pool, configurable via environment variables, with graceful shutdown handling. Place a reverse proxy in front and set `COOKIE_SECURE=true` + strong `JWT_SECRET` / `SESSION_SECRET` in production.

---

_Generated for Euro-Trousers. Internal use only._
