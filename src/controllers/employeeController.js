'use strict';

/**
 * Employee Management controller (Module 2).
 * -------------------------------------------------------------
 * Unified profile engine for active & inactive workforce. Exposes the
 * tabbed profile data (personal, emergency contacts, status history,
 * identity document metadata). Sensitive identity numbers are stored &
 * returned only as masked structural strings (e.g. 784-XXXX-XXXXXXX-X).
 */

const db = require('../config/db');
const { ok, created, AppError } = require('../utils/response');
const { validate, maskEmiratesId } = require('../utils/validators');
const audit = require('../services/auditService');

/** GET /api/employees?status=&q=&department=&branch=&page=&limit= */
async function list(req, res) {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const status = req.query.status || null; // 'active','inactive', specific enum, or null=all
  const department = req.query.department ? parseInt(req.query.department, 10) : null;
  const branch = req.query.branch ? parseInt(req.query.branch, 10) : null;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 200);
  const offset = (page - 1) * limit;

  const where = ['e.company_id = :company'];
  const params = { company: req.user.companyId, q, department, branch, limit, offset };

  if (status === 'active') where.push("e.employment_status NOT IN ('inactive','terminated')");
  else if (status === 'inactive') where.push("e.employment_status IN ('inactive','terminated')");
  else if (status) where.push('e.employment_status = :status'), (params.status = status);
  if (q) where.push('(e.first_name LIKE :q OR e.last_name LIKE :q OR e.employee_code LIKE :q OR e.work_email LIKE :q)');
  if (department) where.push('e.department_id = :department');
  if (branch) where.push('e.branch_id = :branch');

  const whereSql = where.join(' AND ');
  const rows = await db.query(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.work_email, e.mobile,
            e.employment_status, e.date_of_joining, e.profile_image_path,
            d.name AS department_name, b.name AS branch_name, dg.title AS designation
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN branches b ON b.id = e.branch_id
       LEFT JOIN designations dg ON dg.id = e.designation_id
      WHERE ${whereSql}
      ORDER BY e.last_name, e.first_name
      LIMIT :limit OFFSET :offset`,
    params
  );
  const countRow = await db.queryOne(`SELECT COUNT(*) AS total FROM employees e WHERE ${whereSql}`, params);
  return ok(res, rows, 'OK', 200, { page, limit, total: countRow.total });
}

/** GET /api/employees/:id — full tabbed profile. */
async function getProfile(req, res) {
  const id = parseInt(req.params.id, 10);
  const employee = await db.queryOne(
    `SELECT e.*, d.name AS department_name, b.name AS branch_name, dg.title AS designation
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN branches b ON b.id = e.branch_id
       LEFT JOIN designations dg ON dg.id = e.designation_id
      WHERE e.id = :id AND e.company_id = :c`,
    { id, c: req.user.companyId }
  );
  if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');

  const [emergencyContacts, statusHistory, documents] = await Promise.all([
    db.query('SELECT * FROM employee_emergency_contacts WHERE employee_id = :id', { id }),
    db.query('SELECT * FROM employee_status_history WHERE employee_id = :id ORDER BY effective_date DESC', { id }),
    db.query('SELECT * FROM employee_identity_documents WHERE employee_id = :id ORDER BY doc_type', { id }),
  ]);

  // Ensure identity refs are presented masked regardless of stored form.
  const identity = documents.map((doc) => ({
    ...doc,
    reference_masked: doc.doc_type === 'emirates_id'
      ? maskEmiratesId(doc.reference_masked || '')
      : doc.reference_masked,
  }));

  return ok(res, {
    profile: employee,
    emergencyContacts,
    statusHistory,
    identityDocuments: identity,
  });
}

/** POST /api/employees */
async function create(req, res) {
  const b = validate(req.body, {
    employee_code: { required: true, type: 'string' },
    first_name: { required: true, type: 'string' },
    last_name: { required: true, type: 'string' },
    gender: { type: 'string', enum: ['male', 'female', 'other'] },
    date_of_birth: { type: 'date' },
    nationality: { type: 'string' },
    work_email: { type: 'email' },
    mobile: { type: 'string' },
    branch_id: { type: 'int' },
    department_id: { type: 'int' },
    designation_id: { type: 'int' },
    employment_status: { type: 'string', default: 'probation' },
    date_of_joining: { type: 'date' },
    bank_name: { type: 'string' },
    iban: { type: 'string' },
    routing_code: { type: 'string' },
  });
  const r = await db.query(
    `INSERT INTO employees
       (company_id, branch_id, department_id, designation_id, employee_code, first_name, last_name,
        gender, date_of_birth, nationality, work_email, mobile, employment_status, date_of_joining,
        bank_name, iban, routing_code)
     VALUES
       (:c, :branch_id, :department_id, :designation_id, :employee_code, :first_name, :last_name,
        :gender, :date_of_birth, :nationality, :work_email, :mobile, :employment_status, :date_of_joining,
        :bank_name, :iban, :routing_code)`,
    { ...b, c: req.user.companyId }
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'CREATE', entityType: 'employee', entityId: r.insertId, after: { code: b.employee_code }, ip: req.ip });
  return created(res, { id: r.insertId });
}

/** PUT /api/employees/:id */
async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const before = await db.queryOne('SELECT * FROM employees WHERE id = :id AND company_id = :c', { id, c: req.user.companyId });
  if (!before) throw new AppError('Employee not found', 404, 'NOT_FOUND');
  const b = validate(req.body, {
    first_name: { required: true, type: 'string', default: before.first_name },
    last_name: { required: true, type: 'string', default: before.last_name },
    work_email: { type: 'email', default: before.work_email },
    mobile: { type: 'string', default: before.mobile },
    branch_id: { type: 'int', default: before.branch_id },
    department_id: { type: 'int', default: before.department_id },
    designation_id: { type: 'int', default: before.designation_id },
    bank_name: { type: 'string', default: before.bank_name },
    iban: { type: 'string', default: before.iban },
    routing_code: { type: 'string', default: before.routing_code },
  });
  await db.query(
    `UPDATE employees SET first_name=:first_name, last_name=:last_name, work_email=:work_email,
        mobile=:mobile, branch_id=:branch_id, department_id=:department_id, designation_id=:designation_id,
        bank_name=:bank_name, iban=:iban, routing_code=:routing_code WHERE id=:id`,
    { ...b, id }
  );
  await audit.recordAudit({ actorUserId: req.user.id, action: 'UPDATE', entityType: 'employee', entityId: id, before, after: b, ip: req.ip });
  return ok(res, null, 'Employee updated');
}

/** POST /api/employees/:id/status — change employment status (ledgered). */
async function changeStatus(req, res) {
  const id = parseInt(req.params.id, 10);
  const b = validate(req.body, {
    new_status: { required: true, type: 'string', enum: ['active', 'probation', 'on_leave', 'suspended', 'inactive', 'terminated'] },
    effective_date: { required: true, type: 'date' },
    reason: { type: 'string' },
  });
  const emp = await db.queryOne('SELECT employment_status FROM employees WHERE id=:id AND company_id=:c', { id, c: req.user.companyId });
  if (!emp) throw new AppError('Employee not found', 404, 'NOT_FOUND');

  await db.transaction(async (tx) => {
    await tx.query('UPDATE employees SET employment_status = :s WHERE id = :id', { s: b.new_status, id });
    await tx.query(
      `INSERT INTO employee_status_history (employee_id, previous_status, new_status, effective_date, reason, changed_by)
       VALUES (:id, :prev, :ns, :eff, :reason, :by)`,
      { id, prev: emp.employment_status, ns: b.new_status, eff: b.effective_date, reason: b.reason, by: req.user.id }
    );
    await audit.recordAudit(
      { actorUserId: req.user.id, action: 'UPDATE', entityType: 'employee_status', entityId: id, before: { status: emp.employment_status }, after: { status: b.new_status }, ip: req.ip },
      tx
    );
  });
  return ok(res, null, 'Status updated');
}

/** POST /api/employees/:id/emergency-contact */
async function addEmergencyContact(req, res) {
  const id = parseInt(req.params.id, 10);
  const b = validate(req.body, {
    contact_name: { required: true, type: 'string' },
    relationship: { type: 'string' },
    phone: { required: true, type: 'string' },
    alt_phone: { type: 'string' },
    address: { type: 'string' },
  });
  const r = await db.query(
    `INSERT INTO employee_emergency_contacts (employee_id, contact_name, relationship, phone, alt_phone, address)
     VALUES (:id, :contact_name, :relationship, :phone, :alt_phone, :address)`,
    { ...b, id }
  );
  return created(res, { id: r.insertId });
}

/**
 * PUT /api/employees/:id/identity-document
 * Upserts identity-document metadata. Numbers must be supplied already
 * masked (structural); the server re-masks Emirates ID for safety.
 */
async function upsertIdentityDocument(req, res) {
  const id = parseInt(req.params.id, 10);
  const b = validate(req.body, {
    doc_type: { required: true, type: 'string', enum: ['passport', 'emirates_id', 'visa', 'contract', 'labour_card'] },
    reference_masked: { type: 'string' },
    issuing_country: { type: 'string' },
    issue_date: { type: 'date' },
    expiry_date: { type: 'date' },
    visa_type: { type: 'string' },
    sponsor_name: { type: 'string' },
    contract_type: { type: 'string', enum: ['limited', 'unlimited'] },
    contract_start: { type: 'date' },
    contract_end: { type: 'date' },
    probation_months: { type: 'int' },
  });
  if (b.doc_type === 'emirates_id' && b.reference_masked) {
    b.reference_masked = maskEmiratesId(b.reference_masked);
  }
  // One metadata row per (employee, doc_type): delete then insert for simplicity.
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM employee_identity_documents WHERE employee_id=:id AND doc_type=:t', { id, t: b.doc_type });
    await tx.query(
      `INSERT INTO employee_identity_documents
         (employee_id, doc_type, reference_masked, issuing_country, issue_date, expiry_date,
          visa_type, sponsor_name, contract_type, contract_start, contract_end, probation_months)
       VALUES
         (:id, :doc_type, :reference_masked, :issuing_country, :issue_date, :expiry_date,
          :visa_type, :sponsor_name, :contract_type, :contract_start, :contract_end, :probation_months)`,
      { ...b, id }
    );
  });
  await audit.recordAudit({ actorUserId: req.user.id, action: 'UPDATE', entityType: 'employee_document', entityId: `${id}:${b.doc_type}`, ip: req.ip });
  return ok(res, null, 'Identity document saved');
}

module.exports = {
  list, getProfile, create, update, changeStatus, addEmergencyContact, upsertIdentityDocument,
};
