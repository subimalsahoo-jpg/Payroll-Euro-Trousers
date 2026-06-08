-- ============================================================================
-- Euro-Trousers HRMS & Payroll  ::  001_core_schema.sql
-- ----------------------------------------------------------------------------
-- Target: MySQL 8.0+ (InnoDB, utf8mb4). Fully normalised with explicit
-- foreign keys, performance indexes and strict data types. Money stored as
-- DECIMAL(14,2). Times in app TZ (+04:00 Asia/Dubai) via app layer.
--
-- Modules covered: 1 Super Admin, 2 Employee, 15 Globalization (companies,
-- branches, currencies) + shared reference tables.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+04:00';
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
-- MODULE 15: Multi-Tenant / Globalization core
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(150) NOT NULL,
  legal_name      VARCHAR(200) NULL,
  trade_license   VARCHAR(100) NULL,
  tax_trn         VARCHAR(50)  NULL,                 -- UAE TRN (structural)
  base_currency   CHAR(3)      NOT NULL DEFAULT 'AED',
  default_locale  VARCHAR(5)   NOT NULL DEFAULT 'en',
  logo_path       VARCHAR(255) NULL,
  address         VARCHAR(255) NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_companies_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS currencies (
  code            CHAR(3)      NOT NULL,
  name            VARCHAR(60)  NOT NULL,
  symbol          VARCHAR(8)   NOT NULL,
  rate_to_base    DECIMAL(14,6) NOT NULL DEFAULT 1.000000,  -- multi-currency
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS branches (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NOT NULL,
  name            VARCHAR(150) NOT NULL,
  code            VARCHAR(30)  NOT NULL,
  emirate         VARCHAR(60)  NULL,                 -- e.g. Dubai, Abu Dhabi
  address         VARCHAR(255) NULL,
  phone           VARCHAR(40)  NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_branch_company_code (company_id, code),
  KEY idx_branches_company (company_id),
  CONSTRAINT fk_branches_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS departments (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NOT NULL,
  branch_id       INT UNSIGNED NULL,
  name            VARCHAR(120) NOT NULL,
  code            VARCHAR(30)  NOT NULL,
  cost_center     VARCHAR(40)  NULL,                 -- finance cost-center tag
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dept_company_code (company_id, code),
  KEY idx_dept_company (company_id),
  KEY idx_dept_branch (branch_id),
  CONSTRAINT fk_dept_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_dept_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS designations (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NOT NULL,
  title           VARCHAR(120) NOT NULL,
  grade           VARCHAR(30)  NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_desig_company_title (company_id, title),
  CONSTRAINT fk_desig_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 1: RBAC - roles, permissions, users
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NULL,                 -- NULL = global/system role
  name            VARCHAR(60)  NOT NULL,             -- e.g. SUPER_ADMIN, HR_MANAGER
  description     VARCHAR(255) NULL,
  is_system       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_company_name (company_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  perm_key        VARCHAR(80)  NOT NULL,             -- e.g. employee.read
  module          VARCHAR(60)  NOT NULL,
  description     VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_perm_key (perm_key),
  KEY idx_perm_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         INT UNSIGNED NOT NULL,
  permission_id   INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY idx_rp_permission (permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NOT NULL,
  branch_id       INT UNSIGNED NULL,
  role_id         INT UNSIGNED NOT NULL,
  employee_id     INT UNSIGNED NULL,                 -- links a login to an employee (ESS)
  username        VARCHAR(60)  NOT NULL,
  email           VARCHAR(150) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,             -- bcrypt
  full_name       VARCHAR(150) NOT NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  twofa_enabled   TINYINT(1)   NOT NULL DEFAULT 0,
  twofa_secret    VARCHAR(255) NULL,
  last_login_at   TIMESTAMP    NULL,
  failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until    TIMESTAMP    NULL,
  preferred_locale VARCHAR(5)  NOT NULL DEFAULT 'en',
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_company (company_id),
  KEY idx_users_role (role_id),
  KEY idx_users_employee (employee_id),
  CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Global, key/value system configuration (Module 1)
CREATE TABLE IF NOT EXISTS system_settings (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NULL,                 -- NULL = global
  setting_key     VARCHAR(100) NOT NULL,
  setting_value   TEXT NULL,
  value_type      ENUM('string','number','boolean','json') NOT NULL DEFAULT 'string',
  updated_by      INT UNSIGNED NULL,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_setting_scope_key (company_id, setting_key),
  CONSTRAINT fk_settings_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 2: Employee Management
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id          INT UNSIGNED NOT NULL,
  branch_id           INT UNSIGNED NULL,
  department_id       INT UNSIGNED NULL,
  designation_id      INT UNSIGNED NULL,
  employee_code       VARCHAR(30)  NOT NULL,         -- e.g. ET-0001
  first_name          VARCHAR(80)  NOT NULL,
  last_name           VARCHAR(80)  NOT NULL,
  gender              ENUM('male','female','other') NULL,
  date_of_birth       DATE         NULL,
  nationality         VARCHAR(80)  NULL,
  marital_status      ENUM('single','married','divorced','widowed') NULL,
  personal_email      VARCHAR(150) NULL,
  work_email          VARCHAR(150) NULL,
  mobile              VARCHAR(40)  NULL,
  profile_image_path  VARCHAR(255) NULL,
  -- Employment status / history snapshot
  employment_status   ENUM('active','probation','on_leave','suspended','inactive','terminated')
                        NOT NULL DEFAULT 'probation',
  date_of_joining     DATE         NULL,
  date_of_exit        DATE         NULL,
  -- Banking (WPS routing) -- structural placeholders only
  bank_name           VARCHAR(120) NULL,
  iban                VARCHAR(34)  NULL,             -- AE + 21 digits
  routing_code        VARCHAR(20)  NULL,            -- bank/branch routing
  labour_card_no      VARCHAR(40)  NULL,            -- MOL personal/labour code
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_emp_company_code (company_id, employee_code),
  KEY idx_emp_company (company_id),
  KEY idx_emp_branch (branch_id),
  KEY idx_emp_department (department_id),
  KEY idx_emp_status (employment_status),
  KEY idx_emp_name (last_name, first_name),
  CONSTRAINT fk_emp_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_emp_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_emp_department FOREIGN KEY (department_id) REFERENCES departments (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_emp_designation FOREIGN KEY (designation_id) REFERENCES designations (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add the deferred FK from users.employee_id -> employees.id
ALTER TABLE users
  ADD CONSTRAINT fk_users_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS employee_emergency_contacts (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id     INT UNSIGNED NOT NULL,
  contact_name    VARCHAR(120) NOT NULL,
  relationship    VARCHAR(60)  NULL,
  phone           VARCHAR(40)  NOT NULL,
  alt_phone       VARCHAR(40)  NULL,
  address         VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_emc_employee (employee_id),
  CONSTRAINT fk_emc_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Employment status transition history (audit-friendly ledger)
CREATE TABLE IF NOT EXISTS employee_status_history (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id     INT UNSIGNED NOT NULL,
  previous_status VARCHAR(30)  NULL,
  new_status      VARCHAR(30)  NOT NULL,
  effective_date  DATE         NOT NULL,
  reason          VARCHAR(255) NULL,
  changed_by      INT UNSIGNED NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_esh_employee (employee_id),
  CONSTRAINT fk_esh_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Identity documents METADATA. Sensitive numbers are stored as masked
-- structural strings (e.g. '784-XXXX-XXXXXXX-X'); real values are never
-- hardcoded. Only metadata + expiries are tracked for compliance alerts.
CREATE TABLE IF NOT EXISTS employee_identity_documents (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id       INT UNSIGNED NOT NULL,
  doc_type          ENUM('passport','emirates_id','visa','contract','labour_card') NOT NULL,
  -- Generic, masked reference for any doc type
  reference_masked  VARCHAR(60)  NULL,              -- e.g. 784-XXXX-XXXXXXX-X
  issuing_country   VARCHAR(80)  NULL,              -- passport
  issue_date        DATE         NULL,
  expiry_date       DATE         NULL,
  -- Visa specifics
  visa_type         VARCHAR(60)  NULL,              -- employment, residence, etc.
  sponsor_name      VARCHAR(150) NULL,
  -- Contract specifics
  contract_type     ENUM('limited','unlimited') NULL,
  contract_start    DATE         NULL,
  contract_end      DATE         NULL,
  probation_months  TINYINT UNSIGNED NULL,
  notes             VARCHAR(255) NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_eid_employee (employee_id),
  KEY idx_eid_type (doc_type),
  KEY idx_eid_expiry (expiry_date),         -- powers expiry-alert scans
  CONSTRAINT fk_eid_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
