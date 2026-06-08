'use strict';

/**
 * PDF generation service (Module 7).
 * -------------------------------------------------------------
 * Server-side salary-slip compiler built on pdfkit. Renders a corporate
 * slip with the Euro-Trousers header, earnings/deductions breakdown,
 * net pay, a verification QR code, and acknowledgment / authorization
 * blocks. Streams to a file in the configured payslip directory and
 * returns the saved path.
 */

const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const money = require('../utils/money');

// Brand palette (Crisp white / Vivid crimson / Charcoal).
const CRIMSON = '#D6122E';
const CHARCOAL = '#2B2B2B';
const GRAY = '#6B7280';
const LIGHT = '#F3F4F6';

/**
 * Build a salary-slip PDF.
 * @param {object} ctx { payslip, employee, run, qrDataUrl }
 * @returns {Promise<string>} absolute file path of the generated PDF
 */
async function generatePayslip(ctx) {
  // eslint-disable-next-line global-require
  const PDFDocument = require('pdfkit');
  const { payslip, employee, run, qrDataUrl } = ctx;

  const dir = path.resolve(env.storage.payslipDir);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `payslip_${run.period_year}-${String(run.period_month).padStart(2, '0')}_${employee.employee_code}.pdf`;
  const filePath = path.join(dir, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ---- Header band ----
    doc.rect(0, 0, doc.page.width, 90).fill(CRIMSON);
    doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold')
      .text('EURO-TROUSERS', 48, 28);
    doc.fontSize(10).font('Helvetica')
      .text('Divya Moolya HRMS & Payroll', 48, 56)
      .text('Dubai, United Arab Emirates', 48, 70);
    doc.fontSize(16).font('Helvetica-Bold')
      .text('SALARY SLIP', 0, 34, { align: 'right', width: doc.page.width - 48 });
    doc.fontSize(10).font('Helvetica')
      .text(`${run.period_year}-${String(run.period_month).padStart(2, '0')}`, 0, 58, { align: 'right', width: doc.page.width - 48 });

    doc.moveDown(4);
    doc.fillColor(CHARCOAL);

    // ---- Employee block ----
    let y = 110;
    const line = (label, value, x = 48) => {
      doc.fontSize(9).fillColor(GRAY).text(label, x, y);
      doc.fontSize(10).fillColor(CHARCOAL).font('Helvetica-Bold').text(String(value ?? '-'), x, y + 12);
      doc.font('Helvetica');
    };
    line('Employee', `${employee.first_name} ${employee.last_name}`);
    line('Employee Code', employee.employee_code, 230);
    line('Department', employee.department_name || '-', 400);
    y += 36;
    line('Designation', employee.designation || '-');
    line('Worked Days', payslip.worked_days, 230);
    line('Overtime Hours', payslip.overtime_hours, 400);
    y += 44;

    // ---- Earnings / Deductions two-column table ----
    const tableTop = y;
    const colW = (doc.page.width - 96) / 2;
    const drawHeader = (x, title) => {
      doc.rect(x, tableTop, colW - 8, 22).fill(CHARCOAL);
      doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold').text(title, x + 8, tableTop + 6);
      doc.font('Helvetica').fillColor(CHARCOAL);
    };
    drawHeader(48, 'EARNINGS');
    drawHeader(48 + colW, 'DEDUCTIONS');

    const earnings = [
      ['Basic Salary', payslip.basic_salary],
      ['Housing Allowance', payslip.housing_allowance],
      ['Transport Allowance', payslip.transport_allowance],
      ['Food Allowance', payslip.food_allowance],
      ['Other Allowance', payslip.other_allowance],
      ['Overtime (Normal)', payslip.overtime_normal],
      ['Overtime (Sunday)', payslip.overtime_sunday],
      ['Overtime (Holiday)', payslip.overtime_holiday],
      ['Bonus', payslip.bonus],
      ['Incentive', payslip.incentive],
    ];
    const deductions = [
      ['Salary Advance', payslip.advance_deduction],
      ['Loan Installment', payslip.loan_deduction],
      ['Other Deductions', payslip.other_deduction],
    ];

    const rowH = 18;
    let ry = tableTop + 28;
    const renderRows = (rows, x) => {
      let yy = ry;
      rows.forEach((r, i) => {
        if (i % 2 === 0) doc.rect(x, yy - 3, colW - 8, rowH).fill(LIGHT).fillColor(CHARCOAL);
        doc.fillColor(CHARCOAL).fontSize(9).text(r[0], x + 8, yy);
        doc.text(money.format(r[1]), x + 8, yy, { width: colW - 24, align: 'right' });
        yy += rowH;
      });
      return yy;
    };
    const endY1 = renderRows(earnings, 48);
    const endY2 = renderRows(deductions, 48 + colW);
    const tableBottom = Math.max(endY1, endY2) + 6;

    // Totals row
    doc.rect(48, tableBottom, colW - 8, 22).fill(CRIMSON).fillColor('#FFFFFF').font('Helvetica-Bold');
    doc.fontSize(10).text('Gross', 56, tableBottom + 6);
    doc.text(money.format(payslip.gross_salary), 48, tableBottom + 6, { width: colW - 24, align: 'right' });
    doc.rect(48 + colW, tableBottom, colW - 8, 22).fill(CHARCOAL).fillColor('#FFFFFF');
    doc.text('Total Deductions', 56 + colW, tableBottom + 6);
    doc.text(money.format(payslip.total_deductions), 48 + colW, tableBottom + 6, { width: colW - 24, align: 'right' });
    doc.font('Helvetica').fillColor(CHARCOAL);

    // ---- Net pay ----
    const netY = tableBottom + 40;
    doc.rect(48, netY, doc.page.width - 96, 36).fill('#FBE9EC');
    doc.fillColor(CRIMSON).fontSize(14).font('Helvetica-Bold')
      .text('NET SALARY', 60, netY + 10);
    doc.text(money.format(payslip.net_salary, payslip.currency), 48, netY + 9, { width: doc.page.width - 108, align: 'right' });
    doc.font('Helvetica').fillColor(CHARCOAL);

    // ---- QR + signatures ----
    const footY = netY + 70;
    if (qrDataUrl) {
      try {
        const base64 = qrDataUrl.split(',')[1];
        doc.image(Buffer.from(base64, 'base64'), 48, footY, { width: 90, height: 90 });
        doc.fontSize(8).fillColor(GRAY).text('Scan to verify authenticity', 48, footY + 92, { width: 90, align: 'center' });
      } catch (_e) { /* ignore image errors */ }
    }

    doc.fontSize(9).fillColor(CHARCOAL);
    doc.text('_____________________________', 300, footY + 50);
    doc.text('Employee Acknowledgment', 320, footY + 64);
    doc.text('_____________________________', 300, footY + 96);
    doc.text('Authorized Signatory (HR / Finance)', 305, footY + 110);

    doc.fontSize(7).fillColor(GRAY)
      .text('This is a system-generated document from Divya Moolya HRMS & Payroll. Identity numbers are masked for privacy.',
        48, doc.page.height - 60, { width: doc.page.width - 96, align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { generatePayslip };
