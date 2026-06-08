-- ============================================================================
-- Euro-Trousers HRMS & Payroll  ::  002_operations_schema.sql
-- ----------------------------------------------------------------------------
-- Operational tables: Attendance (3), Leave (4), Payroll (5),
-- Salary Processing (6), Salary Slips (7), Documents (14),
-- Notifications (12), Announcements (8).
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+04:00';
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
-- MODULE 3: Attendance
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NOT NULL,
  name            VARCHAR(80)  NOT NULL,
  start_time      TIME         NOT NULL,
  end_time        TIME         NOT NULL,
  grace_minutes   SMALLINT UNSIGNED NOT NULL DEFAULT 10,   -- late grace
  break_minutes   SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  is_night_shift  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shift_company_name (company_id, name),
  CONSTRAINT fk_shift_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id     INT UNSIGNED NOT NULL,
  shift_id        INT UNSIGNED NULL,
  work_date       DATE         NOT NULL,
  check_in        DATETIME     NULL,
  check_out       DATETIME     NULL,
  worked_minutes  INT UNSIGNED NULL,
  late_minutes    INT UNSIGNED NOT NULL DEFAULT 0,
  early_exit_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  overtime_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  status          ENUM('present','absent','late','half_day','on_leave','holiday','weekend','missing')
                    NOT NULL DEFAULT 'absent',
  source          ENUM('manual','biometric','crosschex','api','import') NOT NULL DEFAULT 'manual',
  source_ref      VARCHAR(80)  NULL,                -- external device/log id
  is_corrected    TINYINT(1)   NOT NULL DEFAULT 0,
  remarks         VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_emp_date (employee_id, work_date),
  KEY idx_att_date (work_date),
  KEY idx_att_status (status),
  CONSTRAINT fk_att_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_att_shift FOREIGN KEY (shift_id) REFERENCES shifts (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit ledger of manual attendance corrections (Module 3 corrections pipeline)
CREATE TABLE IF NOT EXISTS attendance_corrections (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  attendance_id   BIGINT UNSIGNED NOT NULL,
  field_changed   VARCHAR(40)  NOT NULL,
  old_value       VARCHAR(60)  NULL,
  new_value       VARCHAR(60)  NULL,
  reason          VARCHAR(255) NULL,
  corrected_by    INT UNSIGNED NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_attc_attendance (attendance_id),
  CONSTRAINT fk_attc_attendance FOREIGN KEY (attendance_id) REFERENCES attendance (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_holidays (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NOT NULL,
  holiday_date    DATE         NOT NULL,
  name            VARCHAR(120) NOT NULL,
  is_paid         TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_holiday_company_date (company_id, holiday_date),
  CONSTRAINT fk_holiday_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 4: Leave Management
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_types (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NOT NULL,
  name            VARCHAR(60)  NOT NULL,             -- Annual, Sick, Emergency, Maternity
  code            VARCHAR(20)  NOT NULL,
  default_days    DECIMAL(5,1) NOT NULL DEFAULT 0,   -- annual entitlement
  is_paid         TINYINT(1)   NOT NULL DEFAULT 1,
  carry_forward   TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leavetype_company_code (company_id, code),
  CONSTRAINT fk_lt_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_balances (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id     INT UNSIGNED NOT NULL,
  leave_type_id   INT UNSIGNED NOT NULL,
  year            SMALLINT UNSIGNED NOT NULL,
  entitled_days   DECIMAL(5,1) NOT NULL DEFAULT 0,
  used_days       DECIMAL(5,1) NOT NULL DEFAULT 0,
  pending_days    DECIMAL(5,1) NOT NULL DEFAULT 0,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_balance_emp_type_year (employee_id, leave_type_id, year),
  KEY idx_lb_employee (employee_id),
  CONSTRAINT fk_lb_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_lb_type FOREIGN KEY (leave_type_id) REFERENCES leave_types (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_applications (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id     INT UNSIGNED NOT NULL,
  leave_type_id   INT UNSIGNED NOT NULL,
  start_date      DATE         NOT NULL,
  end_date        DATE         NOT NULL,
  total_days      DECIMAL(5,1) NOT NULL,
  reason          VARCHAR(255) NULL,
  -- Multi-tier workflow: pending -> manager_reviewed -> hr_approved -> disbursed/rejected
  status          ENUM('pending','manager_reviewed','hr_approved','disbursed','rejected','cancelled')
                    NOT NULL DEFAULT 'pending',
  manager_id      INT UNSIGNED NULL,
  manager_action_at DATETIME   NULL,
  hr_id           INT UNSIGNED NULL,
  hr_action_at    DATETIME     NULL,
  rejection_reason VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_la_employee (employee_id),
  KEY idx_la_status (status),
  KEY idx_la_dates (start_date, end_date),
  CONSTRAINT fk_la_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_la_type FOREIGN KEY (leave_type_id) REFERENCES leave_types (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_workflow_steps (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id  INT UNSIGNED NOT NULL,
  step            ENUM('submitted','manager_reviewed','hr_approved','disbursed','rejected','cancelled') NOT NULL,
  actor_user_id   INT UNSIGNED NULL,
  note            VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lws_application (application_id),
  CONSTRAINT fk_lws_application FOREIGN KEY (application_id) REFERENCES leave_applications (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 5: Payroll - salary structures & variable modifiers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salary_structures (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id         INT UNSIGNED NOT NULL,
  effective_from      DATE         NOT NULL,
  basic_salary        DECIMAL(14,2) NOT NULL DEFAULT 0,
  housing_allowance   DECIMAL(14,2) NOT NULL DEFAULT 0,
  transport_allowance DECIMAL(14,2) NOT NULL DEFAULT 0,
  food_allowance      DECIMAL(14,2) NOT NULL DEFAULT 0,
  other_allowance     DECIMAL(14,2) NOT NULL DEFAULT 0,
  currency            CHAR(3)       NOT NULL DEFAULT 'AED',
  is_current          TINYINT(1)    NOT NULL DEFAULT 1,
  created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ss_employee (employee_id),
  KEY idx_ss_current (employee_id, is_current),
  CONSTRAINT fk_ss_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_ss_currency FOREIGN KEY (currency) REFERENCES currencies (code)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_advances (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id     INT UNSIGNED NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  request_date    DATE         NOT NULL,
  status          ENUM('pending','approved','recovered','rejected') NOT NULL DEFAULT 'pending',
  recovered_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  notes           VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_adv_employee (employee_id),
  CONSTRAINT fk_adv_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loans (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id         INT UNSIGNED NOT NULL,
  principal_amount    DECIMAL(14,2) NOT NULL,
  monthly_installment DECIMAL(14,2) NOT NULL,
  outstanding_amount  DECIMAL(14,2) NOT NULL,
  start_date          DATE         NOT NULL,
  status              ENUM('active','closed','defaulted') NOT NULL DEFAULT 'active',
  notes               VARCHAR(255) NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_loan_employee (employee_id),
  CONSTRAINT fk_loan_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-off bonuses / incentives applied in a specific period
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id     INT UNSIGNED NOT NULL,
  adj_type        ENUM('bonus','incentive','deduction','other') NOT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  period_year     SMALLINT UNSIGNED NOT NULL,
  period_month    TINYINT UNSIGNED NOT NULL,
  description     VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_adj_emp_period (employee_id, period_year, period_month),
  CONSTRAINT fk_adj_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 6: Salary Processing - payroll runs & payslip lines
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_runs (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NOT NULL,
  branch_id       INT UNSIGNED NULL,
  period_year     SMALLINT UNSIGNED NOT NULL,
  period_month    TINYINT UNSIGNED NOT NULL,
  status          ENUM('draft','processed','approved','locked','paid') NOT NULL DEFAULT 'draft',
  total_gross     DECIMAL(16,2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(16,2) NOT NULL DEFAULT 0,
  total_net       DECIMAL(16,2) NOT NULL DEFAULT 0,
  employee_count  INT UNSIGNED NOT NULL DEFAULT 0,
  processed_by    INT UNSIGNED NULL,
  approved_by     INT UNSIGNED NULL,
  locked_by       INT UNSIGNED NULL,
  locked_at       DATETIME     NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_run_scope_period (company_id, branch_id, period_year, period_month),
  KEY idx_run_status (status),
  CONSTRAINT fk_run_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_run_branch FOREIGN KEY (branch_id) REFERENCES branches (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payslips (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payroll_run_id      INT UNSIGNED NOT NULL,
  employee_id         INT UNSIGNED NOT NULL,
  -- Earnings
  basic_salary        DECIMAL(14,2) NOT NULL DEFAULT 0,
  housing_allowance   DECIMAL(14,2) NOT NULL DEFAULT 0,
  transport_allowance DECIMAL(14,2) NOT NULL DEFAULT 0,
  food_allowance      DECIMAL(14,2) NOT NULL DEFAULT 0,
  other_allowance     DECIMAL(14,2) NOT NULL DEFAULT 0,
  overtime_normal     DECIMAL(14,2) NOT NULL DEFAULT 0,
  overtime_sunday     DECIMAL(14,2) NOT NULL DEFAULT 0,
  overtime_holiday    DECIMAL(14,2) NOT NULL DEFAULT 0,
  bonus               DECIMAL(14,2) NOT NULL DEFAULT 0,
  incentive           DECIMAL(14,2) NOT NULL DEFAULT 0,
  gross_salary        DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- Deductions
  advance_deduction   DECIMAL(14,2) NOT NULL DEFAULT 0,
  loan_deduction      DECIMAL(14,2) NOT NULL DEFAULT 0,
  other_deduction     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_deductions    DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_salary          DECIMAL(14,2) NOT NULL DEFAULT 0,
  currency            CHAR(3)       NOT NULL DEFAULT 'AED',
  -- Worked metrics snapshot
  worked_days         DECIMAL(5,1)  NOT NULL DEFAULT 0,
  overtime_hours      DECIMAL(7,2)  NOT NULL DEFAULT 0,
  -- Slip artefacts
  slip_pdf_path       VARCHAR(255) NULL,
  qr_hash             VARCHAR(128) NULL,            -- verification hash
  employee_ack_at     DATETIME     NULL,           -- acknowledgment signature
  manager_auth_by     INT UNSIGNED NULL,           -- manager authorization
  manager_auth_at     DATETIME     NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payslip_run_emp (payroll_run_id, employee_id),
  KEY idx_payslip_employee (employee_id),
  KEY idx_payslip_qr (qr_hash),
  CONSTRAINT fk_payslip_run FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_payslip_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Permanent ledger of salary revisions (Module 6 revision history)
CREATE TABLE IF NOT EXISTS salary_revision_history (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id     INT UNSIGNED NOT NULL,
  old_structure   JSON         NULL,
  new_structure   JSON         NULL,
  reason          VARCHAR(255) NULL,
  revised_by      INT UNSIGNED NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_srh_employee (employee_id),
  CONSTRAINT fk_srh_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 14: Secure Document Repository
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)     NOT NULL,            -- opaque storage key
  employee_id     INT UNSIGNED NULL,
  category        ENUM('passport_copy','visa_page','emirates_id_scan','contract','certificate','photo','other')
                    NOT NULL DEFAULT 'other',
  original_name   VARCHAR(255) NOT NULL,
  stored_name     VARCHAR(255) NOT NULL,           -- uuid-based filename on disk
  mime_type       VARCHAR(100) NOT NULL,
  size_bytes      INT UNSIGNED NOT NULL DEFAULT 0,
  uploaded_by     INT UNSIGNED NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_documents_uuid (uuid),
  KEY idx_doc_employee (employee_id),
  KEY idx_doc_category (category),
  CONSTRAINT fk_doc_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- MODULE 8/12: Announcements & Notifications
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED NOT NULL,
  title           VARCHAR(150) NOT NULL,
  body            TEXT         NOT NULL,
  published_at    DATETIME     NULL,
  is_published    TINYINT(1)   NOT NULL DEFAULT 0,
  created_by      INT UNSIGNED NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ann_company (company_id),
  CONSTRAINT fk_ann_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NULL,                -- recipient (NULL = broadcast)
  channel         ENUM('in_app','email') NOT NULL DEFAULT 'in_app',
  type            VARCHAR(60)  NOT NULL,            -- leave_approved, payroll_done, doc_expiry, birthday...
  title           VARCHAR(150) NOT NULL,
  message         TEXT         NULL,
  payload         JSON         NULL,
  is_read         TINYINT(1)   NOT NULL DEFAULT 0,
  sent_status     ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_user (user_id),
  KEY idx_notif_type (type),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
