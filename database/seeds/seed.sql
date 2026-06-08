-- ============================================================================
-- Euro-Trousers HRMS & Payroll  ::  seed.sql
-- ----------------------------------------------------------------------------
-- Compliant MOCK dataset for Euro-Trousers. Sensitive identity numbers use
-- MASKED structural placeholders only (e.g. '784-XXXX-XXXXXXX-X'). No real
-- credentials are embedded. User accounts + bcrypt password hashes are created
-- separately by the Node seed step (database/migrate.js seed) so passwords are
-- never stored in plaintext SQL.
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---- Currencies (Module 15 multi-currency) ----
INSERT INTO currencies (code, name, symbol, rate_to_base, is_active) VALUES
  ('AED', 'UAE Dirham',     'د.إ', 1.000000, 1),
  ('USD', 'US Dollar',      '$',   3.672500, 1),
  ('EUR', 'Euro',           '€',   3.980000, 1),
  ('INR', 'Indian Rupee',   '₹',   0.044000, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---- Company ----
INSERT INTO companies (id, name, legal_name, trade_license, tax_trn, base_currency, default_locale, address, is_active)
VALUES (1, 'Euro-Trousers', 'Euro-Trousers Garments LLC', 'CN-1234567', '100XXXXXXXXXXXX3', 'AED', 'en', 'Dubai, United Arab Emirates', 1)
ON DUPLICATE KEY UPDATE legal_name = VALUES(legal_name);

-- ---- Branches (multi-branch) ----
INSERT INTO branches (id, company_id, name, code, emirate, address, phone, is_active) VALUES
  (1, 1, 'Dubai Head Office',    'DXB-HQ',  'Dubai',     'Business Bay, Dubai',        '+971-4-0000000', 1),
  (2, 1, 'Jebel Ali Factory',    'JAF-01',  'Dubai',     'Jebel Ali Free Zone, Dubai', '+971-4-0000001', 1),
  (3, 1, 'Abu Dhabi Branch',     'AUH-01',  'Abu Dhabi', 'Mussafah, Abu Dhabi',        '+971-2-0000000', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---- Departments (cost centers) ----
INSERT INTO departments (id, company_id, branch_id, name, code, cost_center, is_active) VALUES
  (1, 1, 1, 'Administration', 'ADM', 'CC-100', 1),
  (2, 1, 1, 'Human Resources','HR',  'CC-110', 1),
  (3, 1, 1, 'Finance',        'FIN', 'CC-120', 1),
  (4, 1, 2, 'Production',     'PRD', 'CC-200', 1),
  (5, 1, 2, 'Logistics',      'LOG', 'CC-210', 1),
  (6, 1, 3, 'Sales',          'SLS', 'CC-300', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---- Designations ----
INSERT INTO designations (id, company_id, title, grade) VALUES
  (1, 1, 'General Manager',        'G1'),
  (2, 1, 'HR Manager',             'G2'),
  (3, 1, 'Payroll Officer',        'G3'),
  (4, 1, 'Accountant',             'G3'),
  (5, 1, 'Production Supervisor',  'G3'),
  (6, 1, 'Machine Operator',       'G5'),
  (7, 1, 'Sales Executive',        'G4'),
  (8, 1, 'Logistics Coordinator',  'G4')
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- ---- Roles (RBAC) ----
INSERT INTO roles (id, company_id, name, description, is_system) VALUES
  (1, NULL, 'SUPER_ADMIN',      'Full multi-tenant system access', 1),
  (2, 1,    'HR_MANAGER',       'Manages employees, leave, documents', 0),
  (3, 1,    'PAYROLL_OFFICER',  'Processes payroll and salary slips', 0),
  (4, 1,    'MANAGER',          'Approves leave for their team', 0),
  (5, 1,    'EMPLOYEE',         'Employee self-service portal', 0)
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- ---- Permissions (granular RBAC keys) ----
INSERT INTO permissions (perm_key, module, description) VALUES
  ('admin.manage',        'admin',      'Manage companies, branches, settings'),
  ('user.manage',         'admin',      'Manage users, roles, permissions'),
  ('audit.read',          'admin',      'View audit and security logs'),
  ('employee.read',       'employee',   'View employee records'),
  ('employee.write',      'employee',   'Create/update employee records'),
  ('attendance.read',     'attendance', 'View attendance'),
  ('attendance.write',    'attendance', 'Record/correct attendance'),
  ('leave.read',          'leave',      'View leave'),
  ('leave.apply',         'leave',      'Apply for leave'),
  ('leave.approve',       'leave',      'Approve/reject leave'),
  ('payroll.read',        'payroll',    'View payroll'),
  ('payroll.process',     'payroll',    'Process and approve payroll'),
  ('payroll.lock',        'payroll',    'Lock payroll runs'),
  ('payslip.read',        'payslip',    'View/generate payslips'),
  ('finance.read',        'finance',    'View finance reports'),
  ('finance.export',      'finance',    'Export bank/WPS files'),
  ('compliance.read',     'compliance', 'View compliance dashboards'),
  ('document.read',       'document',   'View documents'),
  ('document.write',      'document',   'Upload/manage documents'),
  ('notification.read',   'notification','View notifications')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- ---- Role -> Permission mappings ----
-- HR_MANAGER (role 2): employee, attendance, leave (incl approve), documents, notifications, compliance read
INSERT INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions WHERE perm_key IN
  ('employee.read','employee.write','attendance.read','attendance.write',
   'leave.read','leave.approve','document.read','document.write',
   'compliance.read','notification.read','payslip.read')
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);

-- PAYROLL_OFFICER (role 3): payroll, payslip, finance, employee read
INSERT INTO role_permissions (role_id, permission_id)
SELECT 3, id FROM permissions WHERE perm_key IN
  ('employee.read','payroll.read','payroll.process','payroll.lock',
   'payslip.read','finance.read','finance.export','attendance.read','notification.read')
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);

-- MANAGER (role 4): team leave approval + read
INSERT INTO role_permissions (role_id, permission_id)
SELECT 4, id FROM permissions WHERE perm_key IN
  ('employee.read','attendance.read','leave.read','leave.approve','notification.read')
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);

-- EMPLOYEE (role 5): self-service
INSERT INTO role_permissions (role_id, permission_id)
SELECT 5, id FROM permissions WHERE perm_key IN
  ('leave.apply','leave.read','payslip.read','document.read','notification.read')
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id);

-- ---- Shifts ----
INSERT INTO shifts (id, company_id, name, start_time, end_time, grace_minutes, break_minutes, is_night_shift) VALUES
  (1, 1, 'General Day', '09:00:00', '18:00:00', 10, 60, 0),
  (2, 1, 'Factory A',   '07:00:00', '16:00:00', 10, 60, 0),
  (3, 1, 'Factory B',   '16:00:00', '01:00:00', 10, 60, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---- Leave types (UAE labour law aligned defaults) ----
INSERT INTO leave_types (id, company_id, name, code, default_days, is_paid, carry_forward) VALUES
  (1, 1, 'Annual Leave',    'ANNUAL',    30.0, 1, 1),
  (2, 1, 'Sick Leave',      'SICK',      15.0, 1, 0),
  (3, 1, 'Emergency Leave', 'EMERGENCY',  5.0, 1, 0),
  (4, 1, 'Maternity Leave', 'MATERNITY', 60.0, 1, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---- Public holidays (sample) ----
INSERT INTO public_holidays (company_id, holiday_date, name, is_paid) VALUES
  (1, '2026-01-01', 'New Year''s Day', 1),
  (1, '2026-12-02', 'UAE National Day', 1),
  (1, '2026-12-03', 'UAE National Day Holiday', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---- Employees (mock workforce; masked identity references) ----
INSERT INTO employees
  (id, company_id, branch_id, department_id, designation_id, employee_code, first_name, last_name,
   gender, date_of_birth, nationality, marital_status, work_email, mobile, employment_status,
   date_of_joining, bank_name, iban, routing_code, labour_card_no, is_active)
VALUES
  (1, 1, 1, 1, 1, 'ET-0001', 'Rashid',  'Al Marri',  'male',   '1980-04-12', 'UAE',        'married', 'rashid.almarri@euro-trousers.example', '+971-50-0000001', 'active',    '2015-06-01', 'Emirates NBD',  'AE000000000000000000001', '302620122', 'LMC-0001', 1),
  (2, 1, 1, 2, 2, 'ET-0002', 'Aisha',   'Al-Mansoori','female', '1988-09-22', 'UAE',        'married', 'aisha@euro-trousers.com',              '+971-50-0000002', 'active',    '2017-02-15', 'Emirates NBD',  'AE000000000000000000002', '302620122', 'LMC-0002', 1),
  (3, 1, 1, 3, 3, 'ET-0003', 'Suresh',  'Nair',      'male',   '1990-01-30', 'India',      'single',  'suresh.nair@euro-trousers.example',    '+971-50-0000003', 'active',    '2019-08-10', 'ADCB',          'AE000000000000000000003', '101010101', 'LMC-0003', 1),
  (4, 1, 1, 3, 4, 'ET-0004', 'Mariam',  'Hassan',    'female', '1992-11-05', 'Egypt',      'single',  'mariam.hassan@euro-trousers.example',  '+971-50-0000004', 'active',    '2020-03-01', 'ADCB',          'AE000000000000000000004', '101010101', 'LMC-0004', 1),
  (5, 1, 2, 4, 5, 'ET-0005', 'Imran',   'Khan',      'male',   '1985-07-19', 'Pakistan',   'married', 'imran.khan@euro-trousers.example',     '+971-50-0000005', 'active',    '2016-05-20', 'Mashreq',       'AE000000000000000000005', '203040506', 'LMC-0005', 1),
  (6, 1, 2, 4, 6, 'ET-0006', 'Arun',    'Kumar',     'male',   '1995-03-14', 'India',      'single',  'arun.kumar@euro-trousers.example',     '+971-50-0000006', 'active',    '2021-09-01', 'Mashreq',       'AE000000000000000000006', '203040506', 'LMC-0006', 1),
  (7, 1, 2, 4, 6, 'ET-0007', 'Bilal',   'Ahmed',     'male',   '1996-12-25', 'Bangladesh', 'single',  'bilal.ahmed@euro-trousers.example',    '+971-50-0000007', 'probation', '2026-03-01', 'Mashreq',       'AE000000000000000000007', '203040506', 'LMC-0007', 1),
  (8, 1, 2, 5, 8, 'ET-0008', 'Joseph',  'Mathew',    'male',   '1989-06-08', 'India',      'married', 'joseph.mathew@euro-trousers.example',  '+971-50-0000008', 'active',    '2018-11-12', 'FAB',           'AE000000000000000000008', '405060708', 'LMC-0008', 1),
  (9, 1, 3, 6, 7, 'ET-0009', 'Layla',   'Ibrahim',   'female', '1993-02-17', 'Lebanon',    'single',  'layla.ibrahim@euro-trousers.example',  '+971-50-0000009', 'active',    '2022-01-10', 'FAB',           'AE000000000000000000009', '405060708', 'LMC-0009', 1),
  (10,1, 3, 6, 7, 'ET-0010', 'Omar',    'Saleh',     'male',   '1991-10-03', 'Jordan',     'married', 'omar.saleh@euro-trousers.example',     '+971-50-0000010', 'inactive',  '2017-07-01', 'FAB',           'AE000000000000000000010', '405060708', 'LMC-0010', 1)
ON DUPLICATE KEY UPDATE first_name = VALUES(first_name);

-- ---- Emergency contacts (sample) ----
INSERT INTO employee_emergency_contacts (employee_id, contact_name, relationship, phone) VALUES
  (2, 'Khalid Al-Mansoori', 'Spouse',  '+971-50-1111111'),
  (3, 'Priya Nair',  'Sister',  '+971-50-2222222'),
  (5, 'Ayesha Khan', 'Spouse',  '+971-50-3333333')
ON DUPLICATE KEY UPDATE contact_name = VALUES(contact_name);

-- ---- Identity documents (masked refs; some near-expiry for alert demos) ----
-- Emirates ID stored only as masked structural string '784-XXXX-XXXXXXX-X'.
INSERT INTO employee_identity_documents
  (employee_id, doc_type, reference_masked, issuing_country, issue_date, expiry_date,
   visa_type, sponsor_name, contract_type, contract_start, contract_end, probation_months)
VALUES
  (1, 'emirates_id', '784-XXXX-XXXXXXX-X', NULL,  '2022-05-01', '2027-05-01', NULL, NULL, NULL, NULL, NULL, NULL),
  (1, 'passport',    'XXXXXXXX',           'UAE', '2021-01-01', '2031-01-01', NULL, NULL, NULL, NULL, NULL, NULL),
  (1, 'visa',        'XXXXXXXXXX',         NULL,  '2022-06-01', '2026-06-25', 'employment', 'Euro-Trousers Garments LLC', NULL, NULL, NULL, NULL),
  (1, 'contract',    NULL,                 NULL,  NULL,         NULL,         NULL, NULL, 'unlimited', '2015-06-01', NULL, 6),
  (2, 'emirates_id', '784-XXXX-XXXXXXX-X', NULL,  '2023-02-15', '2026-06-30', NULL, NULL, NULL, NULL, NULL, NULL),
  (2, 'passport',    'XXXXXXXX',           'India','2020-02-15','2030-02-15', NULL, NULL, NULL, NULL, NULL, NULL),
  (2, 'visa',        'XXXXXXXXXX',         NULL,  '2023-02-15', '2027-02-15', 'employment', 'Euro-Trousers Garments LLC', NULL, NULL, NULL, NULL),
  (2, 'contract',    NULL,                 NULL,  NULL,         NULL,         NULL, NULL, 'unlimited', '2017-02-15', NULL, 6),
  (5, 'emirates_id', '784-XXXX-XXXXXXX-X', NULL,  '2021-05-20', '2026-06-18', NULL, NULL, NULL, NULL, NULL, NULL),
  (5, 'visa',        'XXXXXXXXXX',         NULL,  '2021-05-20', '2026-06-15', 'employment', 'Euro-Trousers Garments LLC', NULL, NULL, NULL, NULL),
  (7, 'contract',    NULL,                 NULL,  NULL,         NULL,         NULL, NULL, 'limited',   '2026-03-01', '2028-03-01', 6),
  (7, 'visa',        'XXXXXXXXXX',         NULL,  '2026-03-01', '2026-07-05', 'employment', 'Euro-Trousers Garments LLC', NULL, NULL, NULL, NULL)
ON DUPLICATE KEY UPDATE reference_masked = VALUES(reference_masked);

-- ---- Salary structures (current) ----
INSERT INTO salary_structures
  (employee_id, effective_from, basic_salary, housing_allowance, transport_allowance, food_allowance, other_allowance, currency, is_current)
VALUES
  (1, '2024-01-01', 18000.00, 9000.00, 2000.00, 1500.00, 1000.00, 'AED', 1),
  (2, '2024-01-01', 12000.00, 6000.00, 1500.00, 1000.00,  500.00, 'AED', 1),
  (3, '2024-01-01',  9000.00, 4500.00, 1200.00,  800.00,  300.00, 'AED', 1),
  (4, '2024-01-01',  8000.00, 4000.00, 1000.00,  800.00,  200.00, 'AED', 1),
  (5, '2024-01-01',  7000.00, 3500.00, 1000.00,  800.00,  200.00, 'AED', 1),
  (6, '2024-01-01',  3000.00, 1500.00,  500.00,  500.00,    0.00, 'AED', 1),
  (7, '2026-03-01',  2800.00, 1400.00,  400.00,  500.00,    0.00, 'AED', 1),
  (8, '2024-01-01',  4500.00, 2200.00,  700.00,  600.00,  100.00, 'AED', 1),
  (9, '2024-01-01',  6000.00, 3000.00,  900.00,  700.00,  200.00, 'AED', 1),
  (10,'2024-01-01',  6500.00, 3200.00,  900.00,  700.00,  200.00, 'AED', 1)
ON DUPLICATE KEY UPDATE basic_salary = VALUES(basic_salary);

-- ---- Loans / advances (variable modifiers) ----
INSERT INTO loans (employee_id, principal_amount, monthly_installment, outstanding_amount, start_date, status)
VALUES
  (3, 12000.00, 1000.00, 8000.00, '2025-09-01', 'active'),
  (6,  6000.00,  500.00, 4500.00, '2026-01-01', 'active')
ON DUPLICATE KEY UPDATE outstanding_amount = VALUES(outstanding_amount);

INSERT INTO salary_advances (employee_id, amount, request_date, status, recovered_amount)
VALUES
  (8, 2000.00, '2026-05-10', 'approved', 0.00)
ON DUPLICATE KEY UPDATE amount = VALUES(amount);

-- ---- Announcements ----
INSERT INTO announcements (company_id, title, body, published_at, is_published, created_by)
VALUES
  (1, 'Welcome to Euro-Trousers HRMS', 'The new HRMS & Payroll portal is now live for all Euro-Trousers staff.', NOW(), 1, NULL)
ON DUPLICATE KEY UPDATE title = VALUES(title);

SET FOREIGN_KEY_CHECKS = 1;
