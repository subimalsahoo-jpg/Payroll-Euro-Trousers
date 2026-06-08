'use strict';

/**
 * Internationalisation (i18n) dictionary + helpers.
 * -------------------------------------------------------------
 * Module 15 (Globalization). Provides server-side label translation
 * for English ("en") and Arabic ("ar"). Arabic locale drives RTL
 * layout on the frontend. The same JSON is also served to the SPA
 * via /api/i18n/:locale so the client and server stay in sync.
 */

const env = require('./env');

const dictionaries = {
  en: {
    direction: 'ltr',
    app_name: 'Divya Moolya HRMS & Payroll',
    company: 'Euro-Trousers',
    dashboard: 'Dashboard',
    employees: 'Employees',
    attendance: 'Attendance',
    leave: 'Leave',
    payroll: 'Payroll',
    salary_processing: 'Salary Processing',
    salary_slips: 'Salary Slips',
    self_service: 'Self Service',
    finance: 'Finance Reports',
    compliance: 'UAE Compliance',
    notifications: 'Notifications',
    documents: 'Documents',
    administration: 'Administration',
    total_workforce: 'Total Workforce',
    present_today: 'Present Today',
    absent_today: 'Absent Today',
    on_leave: 'On Leave',
    monthly_payroll: 'Monthly Payroll Liability',
    overtime_expense: 'Overtime Expenditure',
    login: 'Sign In',
    logout: 'Sign Out',
    welcome: 'Welcome',
    save: 'Save',
    cancel: 'Cancel',
    approve: 'Approve',
    reject: 'Reject',
    net_salary: 'Net Salary',
    basic_salary: 'Basic Salary',
    allowances: 'Allowances',
    deductions: 'Deductions',
  },
  ar: {
    direction: 'rtl',
    app_name: 'ديفيا موليا للموارد البشرية والرواتب',
    company: 'يورو تراوزرز',
    dashboard: 'لوحة التحكم',
    employees: 'الموظفون',
    attendance: 'الحضور',
    leave: 'الإجازات',
    payroll: 'الرواتب',
    salary_processing: 'معالجة الرواتب',
    salary_slips: 'قسائم الرواتب',
    self_service: 'الخدمة الذاتية',
    finance: 'التقارير المالية',
    compliance: 'الامتثال الإماراتي',
    notifications: 'الإشعارات',
    documents: 'المستندات',
    administration: 'الإدارة',
    total_workforce: 'إجمالي الموظفين',
    present_today: 'الحاضرون اليوم',
    absent_today: 'الغائبون اليوم',
    on_leave: 'في إجازة',
    monthly_payroll: 'التزام الرواتب الشهري',
    overtime_expense: 'مصاريف العمل الإضافي',
    login: 'تسجيل الدخول',
    logout: 'تسجيل الخروج',
    welcome: 'مرحباً',
    save: 'حفظ',
    cancel: 'إلغاء',
    approve: 'موافقة',
    reject: 'رفض',
    net_salary: 'صافي الراتب',
    basic_salary: 'الراتب الأساسي',
    allowances: 'البدلات',
    deductions: 'الاستقطاعات',
  },
};

/** Resolve a supported locale, falling back to the default. */
function resolveLocale(locale) {
  if (locale && env.i18n.supportedLocales.includes(locale)) return locale;
  return env.i18n.defaultLocale;
}

/** Translate a single key for a locale. */
function t(key, locale) {
  const dict = dictionaries[resolveLocale(locale)] || dictionaries.en;
  return dict[key] || dictionaries.en[key] || key;
}

/** Return the full dictionary for a locale (served to the SPA). */
function getDictionary(locale) {
  return dictionaries[resolveLocale(locale)] || dictionaries.en;
}

/** Layout direction (ltr/rtl) for a locale. */
function direction(locale) {
  return getDictionary(locale).direction || 'ltr';
}

module.exports = {
  t,
  getDictionary,
  resolveLocale,
  direction,
  supportedLocales: env.i18n.supportedLocales,
};
