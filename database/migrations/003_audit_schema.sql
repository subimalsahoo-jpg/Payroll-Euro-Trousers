-- ============================================================================
-- Divya Moolya HRMS & Payroll  ::  003_audit_schema.sql
-- ----------------------------------------------------------------------------
-- Module 1 (Audit Trails) + Module 13 (Security). These tables back the
-- auditService writers (recordAudit / recordSecurity / recordLogin) and the
-- WPS export ledger for Module 11.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+04:00';

-- Immutable administrative audit trail (who changed what, before/after).
CREATE TABLE IF NOT EXISTS audit_logs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id   INT UNSIGNED NULL,
  action          VARCHAR(40)  NOT NULL,            -- CREATE/UPDATE/DELETE/APPROVE/LOCK...
  entity_type     VARCHAR(60)  NOT NULL,            -- employee, payroll_run, leave_application...
  entity_id       VARCHAR(40)  NULL,
  before_state    JSON         NULL,
  after_state     JSON         NULL,
  ip_address      VARCHAR(64)  NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_actor (actor_user_id),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Security event log (denied access, CSRF, 2FA, suspicious activity).
CREATE TABLE IF NOT EXISTS security_logs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NULL,
  event_type      VARCHAR(60)  NOT NULL,
  severity        ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
  description     VARCHAR(500) NULL,
  ip_address      VARCHAR(64)  NULL,
  user_agent      VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sec_user (user_id),
  KEY idx_sec_type (event_type),
  KEY idx_sec_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Authentication attempts / login history.
CREATE TABLE IF NOT EXISTS login_history (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NULL,
  username_attempt VARCHAR(60) NULL,
  success         TINYINT(1)   NOT NULL DEFAULT 0,
  failure_reason  VARCHAR(120) NULL,
  ip_address      VARCHAR(64)  NULL,
  user_agent      VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_login_user (user_id),
  KEY idx_login_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- WPS SIF export ledger (Module 11): one row per generated .sif file.
CREATE TABLE IF NOT EXISTS wps_exports (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  payroll_run_id  INT UNSIGNED NOT NULL,
  file_name       VARCHAR(120) NOT NULL,
  record_count    INT UNSIGNED NOT NULL DEFAULT 0,
  total_amount    DECIMAL(16,2) NOT NULL DEFAULT 0,
  sif_checksum    VARCHAR(128) NULL,
  generated_by    INT UNSIGNED NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wps_run (payroll_run_id),
  CONSTRAINT fk_wps_run FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tracks applied migrations (used by the lightweight migration runner).
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename    VARCHAR(150) NOT NULL,
  applied_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_migration_filename (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
