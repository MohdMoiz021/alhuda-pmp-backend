const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const handlebars = require('handlebars');

// Create reusable transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST,
    port: parseInt(process.env.BREVO_SMTP_PORT),
    user: process.env.BREVO_SMTP_LOGIN,
    secure: false, // true for 465, false for 587
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_KEY,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });
};

// Create transporter instance
let transporter = createTransporter();

// ─── Shared design tokens ────────────────────────────────────────────────────
const BASE_STYLES = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f5f5f7;
      color: #1d1d1f;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      background-color: #f5f5f7;
      padding: 40px 20px;
    }
    .card {
      max-width: 560px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 18px;
      overflow: hidden;
    }
    .card-header {
      padding: 40px 40px 28px;
      border-bottom: 1px solid #e8e8ed;
    }
    .card-header .label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6e6e73;
      margin-bottom: 8px;
    }
    .card-header h1 {
      font-size: 26px;
      font-weight: 600;
      letter-spacing: -0.4px;
      color: #1d1d1f;
      line-height: 1.2;
    }
    .card-body {
      padding: 32px 40px;
    }
    .card-body p {
      font-size: 15px;
      line-height: 1.6;
      color: #3a3a3c;
      margin-bottom: 20px;
    }
    .detail-block {
      background: #f5f5f7;
      border-radius: 12px;
      overflow: hidden;
      margin: 24px 0;
    }
    .detail-row {
      display: flex;
      padding: 12px 16px;
      font-size: 14px;
      border-bottom: 1px solid #e8e8ed;
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-label {
      color: #6e6e73;
      width: 150px;
      flex-shrink: 0;
      font-weight: 400;
    }
    .detail-value {
      color: #1d1d1f;
      font-weight: 500;
      flex: 1;
    }
    .btn {
      display: inline-block;
      padding: 12px 26px;
      background: #ff9500;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 980px;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.2px;
    }
    .btn-center {
      text-align: center;
      margin: 28px 0;
    }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 980px;
      font-size: 12px;
      font-weight: 500;
      background: #e8e8ed;
      color: #1d1d1f;
    }
    .badge-green  { background: #d1f0e0; color: #1c6641; }
    .badge-yellow { background: #fff3cd; color: #7d5200; }
    .badge-red    { background: #ffe5e5; color: #9b1c1c; }
    .badge-blue   { background: #dbeafe; color: #1e40af; }
    .note-box {
      background: #f5f5f7;
      border-radius: 10px;
      padding: 16px;
      font-size: 13px;
      color: #6e6e73;
      line-height: 1.6;
      margin: 20px 0;
    }
    .warning-box {
      background: #fff8f0;
      border-left: 3px solid #ff9500;
      border-radius: 0 10px 10px 0;
      padding: 12px 16px;
      font-size: 13px;
      color: #7d5200;
      margin: 20px 0;
    }
    .link-box {
      background: #f5f5f7;
      border-radius: 10px;
      padding: 14px 16px;
      font-size: 13px;
      color: #6e6e73;
      word-break: break-all;
      font-family: 'SF Mono', 'Menlo', monospace;
      margin: 16px 0;
    }
    .divider {
      border: none;
      border-top: 1px solid #e8e8ed;
      margin: 24px 0;
    }
    .card-footer {
      padding: 20px 40px;
      background: #fafafa;
      border-top: 1px solid #e8e8ed;
      font-size: 12px;
      color: #6e6e73;
      line-height: 1.6;
      text-align: center;
    }
    ul.feature-list {
      padding-left: 0;
      list-style: none;
      margin: 16px 0;
    }
    ul.feature-list li {
      font-size: 14px;
      color: #3a3a3c;
      padding: 6px 0;
      border-bottom: 1px solid #e8e8ed;
    }
    ul.feature-list li:last-child { border-bottom: none; }
    ul.feature-list li::before {
      content: "–";
      margin-right: 8px;
      color: #6e6e73;
    }
  </style>
`;

// ─── Wrapper helper ───────────────────────────────────────────────────────────
const wrapEmail = (headerLabel, headerTitle, body, footerNote = '') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headerTitle}</title>
  ${BASE_STYLES}
</head>
<body>
<div class="wrapper">
  <div class="card">
    <div class="card-header">
      ${headerLabel ? `<div class="label">${headerLabel}</div>` : ''}
      <h1>${headerTitle}</h1>
    </div>
    <div class="card-body">
      ${body}
    </div>
    <div class="card-footer">
      ${footerNote || `© ${new Date().getFullYear()} ${process.env.COMPANY_NAME || 'Alhuda Financial'}. All rights reserved.`}
    </div>
  </div>
</div>
</body>
</html>
`;

// ─── Core sendEmail function ──────────────────────────────────────────────────
const sendEmail = async ({
  to,
  subject,
  html,
  text = null,
  from = null,
  attachments = [],
  cc = null,
  bcc = null,
  replyTo = null
}) => {
  try {
    if (!to) throw new Error('No recipients defined');

    const adminSubjects = [
      'New Team Member Joined',
      'New Sub Consultant Registration',
      'New Case Received',
      'Case Assigned',
      'New Case',
      'New Registration',
      'Pending Approval',
      'Sub Consultant',
      'Team Member Joined'
    ];

    const isAdminEmail = adminSubjects.some(s => subject && subject.includes(s));

    let finalTo = to;
    let finalCc = cc;
    let finalBcc = bcc;

    const ADMIN_EMAIL = 'info@alhudafinancial.com';

    if (isAdminEmail) {
      finalTo = ADMIN_EMAIL;
      finalCc = 'tech@alhudafinancial.com';
      finalBcc = null;
      console.log(`Admin email detected — forcing recipient to: ${finalTo}`);
    }

    let plainText = text;
    if (!plainText && html) {
      plainText = html.replace(/<[^>]*>?/gm, '');
    }

    const mailOptions = {
      from: from || `"${process.env.BREVO_FROM_NAME}" <${process.env.BREVO_FROM_EMAIL}>`,
      to: Array.isArray(finalTo) ? finalTo.join(', ') : finalTo,
      subject,
      html,
      text: plainText || '',
      attachments,
      ...(finalCc && { cc: Array.isArray(finalCc) ? finalCc.join(', ') : finalCc }),
      ...(finalBcc && { bcc: Array.isArray(finalBcc) ? finalBcc.join(', ') : finalBcc }),
      ...(replyTo && { replyTo }),
    };

    console.log('Sending email:', {
      to: mailOptions.to,
      subject: mailOptions.subject,
      cc: mailOptions.cc || 'none',
    });

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${finalTo}: ${info.messageId}`);

    return { success: true, messageId: info.messageId, response: info.response };
  } catch (error) {
    console.error('Email sending failed:', error);
    if (error.code === 'EAUTH') throw new Error('Authentication failed. Check your Brevo SMTP key.');
    else if (error.code === 'ESOCKET') throw new Error('Network error. Check your internet connection.');
    else if (error.responseCode === 554) throw new Error('Email rejected. Check recipient address.');
    else if (error.message === 'No recipients defined') throw new Error('Email cannot be sent: No recipient email address provided');
    throw error;
  }
};

// ─── Template-based email ─────────────────────────────────────────────────────
const sendTemplateEmail = async ({ to, subject, templateName, templateData = {}, ...options }) => {
  try {
    const templatePath = path.join(__dirname, '../templates', `${templateName}.html`);
    let templateHtml = await fs.readFile(templatePath, 'utf-8');
    const template = handlebars.compile(templateHtml);
    const html = template(templateData);
    return await sendEmail({ to, subject, html, ...options });
  } catch (error) {
    console.error(`Template error (${templateName}):`, error);
    throw error;
  }
};

// Reconnect if transporter fails
const reconnect = () => {
  transporter = createTransporter();
  console.log('Email transporter reconnected');
};

// ─── Email Templates ──────────────────────────────────────────────────────────
const emailTemplates = {

  // Welcome email for auto-approved users
  welcome: async (to, name) => {
    const body = `
      <p>Hi ${name},</p>
      <p>Your account is ready. Everything you need is waiting for you in the dashboard.</p>
      <div class="btn-center">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" class="btn">Go to Dashboard</a>
      </div>
      <div class="note-box">
        Need help? Reply to this email or contact <a href="mailto:${process.env.SUPPORT_EMAIL || 'info@alhudafinancial.com'}" style="color:#0071e3;">${process.env.SUPPORT_EMAIL || 'info@alhudafinancial.com'}</a>
      </div>
    `;
    return sendEmail({
      to,
      subject: 'Welcome — your account is ready',
      html: wrapEmail('Account Activation', 'Welcome to the platform.', body),
    });
  },

  // Email to sub consultant when they register (pending approval)
  registrationPending: (userData) => {
    const body = `
      <p>Hi ${userData.first_name} ${userData.last_name},</p>
      <p>We've received your Sub Consultant application. Our team will review it and get back to you within 1–2 business days.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${userData.first_name} ${userData.last_name}</span></div>
        <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${userData.email}</span></div>
        <div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value">${userData.phone || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Company</span><span class="detail-value">${userData.company_name || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Role</span><span class="detail-value">Sub Consultant</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="badge badge-yellow">Pending Approval</span></span></div>
        <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${new Date().toLocaleDateString()}</span></div>
      </div>
      <p>You'll receive an email once a decision has been made.</p>
    `;
    return sendEmail({
      to: userData.email,
      subject: 'Application received — awaiting review',
      html: wrapEmail('Sub Consultant Application', 'Application received.', body),
    });
  },

  // Password reset
  passwordReset: async ({ email, name, resetLink, role }) => {
    if (!email) throw new Error('Email address is required for password reset');
    console.log('Preparing password reset email for:', email);

    const body = `
      <p>Hi ${name || 'there'},</p>
      ${role ? `<p style="margin-bottom:20px;"><span class="badge badge-blue">${role}</span></p>` : ''}
      <p>We received a request to reset the password for your account. Click the button below to choose a new password.</p>
      <div class="btn-center">
        <a href="${resetLink}" class="btn">Reset Password</a>
      </div>
      <p style="font-size:13px;color:#6e6e73;margin-bottom:8px;">Or copy this link into your browser:</p>
      <div class="link-box">${resetLink}</div>
      <p style="font-size:13px;color:#6e6e73;">This link expires in <strong>1 hour</strong>.</p>
      <div class="warning-box">
        If you didn't request a password reset, you can safely ignore this email.
      </div>
    `;

    const text = `Reset Your Password\n\nHi ${name || 'there'},\n\nReset link: ${resetLink}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, ignore this email.`;

    return sendEmail({
      to: email,
      subject: 'Reset your password',
      html: wrapEmail('Security', 'Reset your password.', body),
      text,
    });
  },

  // Password reset confirmation
  passwordResetConfirmation: async ({ email, name }) => {
    const body = `
      <p>Hi ${name},</p>
      <p>Your password has been successfully updated. You can now sign in with your new credentials.</p>
      <div class="btn-center">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login" class="btn">Sign In</a>
      </div>
      <div class="warning-box">
        If you didn't make this change, please contact support immediately.
      </div>
    `;
    return sendEmail({
      to: email,
      subject: 'Password updated successfully',
      html: wrapEmail('Security', 'Your password has been updated.', body),
    });
  },

  // Admin notification: new sub consultant registered
  adminNotification: (userData) => {
    const ADMIN_EMAIL = 'info@alhudafinancial.com';
    if (!ADMIN_EMAIL) {
      console.log('ADMIN_EMAIL not configured — skipping admin notification');
      return Promise.resolve({ success: false, skipped: true });
    }
    if (!userData || !userData.email) {
      console.log('Invalid userData for admin notification');
      return Promise.resolve({ success: false, skipped: true });
    }

    const body = `
      <p>A new Sub Consultant has registered and is awaiting your review.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${userData.first_name || ''} ${userData.last_name || ''}</span></div>
        <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${userData.email}</span></div>
        <div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value">${userData.phone || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Company</span><span class="detail-value">${userData.company_name || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Registered</span><span class="detail-value">${new Date().toLocaleString()}</span></div>
      </div>
      <div class="btn-center">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/users/${userData.id}/approve" class="btn">Review Application</a>
      </div>
    `;
    return sendEmail({
      to: ADMIN_EMAIL,
      subject: 'New Sub Consultant Registration — Pending Approval',
      html: wrapEmail('Admin Notification', 'New registration pending approval.', body),
    });
  },

  // Case assigned to team member
  caseAssignedToTeamMember: (data) => {
    const {
      team_member_name, team_member_email, case_reference, case_type,
      case_sub_type, description, priority, partner_name,
      assigned_by_name, assigned_date, case_id
    } = data;

    const priorityClass = (priority === 'urgent' || priority === 'critical') ? 'badge-red' : 'badge-yellow';

    const body = `
      <p>Hi ${team_member_name},</p>
      <p>A new case has been assigned to you for review and action.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Case Reference</span><span class="detail-value">${case_reference}</span></div>
        <div class="detail-row"><span class="detail-label">Case Type</span><span class="detail-value">${case_type || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Sub Type</span><span class="detail-value">${case_sub_type || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Priority</span><span class="detail-value"><span class="badge ${priorityClass}">${priority || 'Normal'}</span></span></div>
        <div class="detail-row"><span class="detail-label">Partner</span><span class="detail-value">${partner_name || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Description</span><span class="detail-value">${description || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Assigned By</span><span class="detail-value">${assigned_by_name}</span></div>
        <div class="detail-row"><span class="detail-label">Assigned On</span><span class="detail-value">${assigned_date}</span></div>
      </div>
      <div class="btn-center">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/cases/${case_id}" class="btn">View Case</a>
      </div>
    `;
    return sendEmail({
      to: team_member_email,
      subject: `New case assigned — ${case_reference}`,
      html: wrapEmail('Case Assignment', `${case_reference}`, body),
    });
  },

  // Welcome email for new internal team members
  welcomeTeamMember: (data) => {
    const { email, name, role, login_url } = data;

    const body = `
      <p>Hi ${name},</p>
      <p>Your internal team account has been created and is ready to use.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${name}</span></div>
        <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${email}</span></div>
        <div class="detail-row"><span class="detail-label">Role</span><span class="detail-value"><span class="badge">${role}</span></span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="badge badge-green">Active</span></span></div>
      </div>
      <ul class="feature-list">
        <li>View and manage cases assigned to you</li>
        <li>Collaborate with other team members</li>
        <li>Update case status and add remarks</li>
      </ul>
      <div class="btn-center">
        <a href="${login_url}" class="btn">Sign In to Your Account</a>
      </div>
      <div class="note-box">
        Use your email <strong>${email}</strong> and the password you created during registration to sign in.
      </div>
    `;
    return sendEmail({
      to: email,
      subject: `Welcome to the team, ${name}`,
      html: wrapEmail('Team Account', 'Your account is ready.', body),
    });
  },

  // Notification to admins when new team member joins
  newTeamMemberNotification: (data) => {
    const {
      admin_name, admin_email, new_member_name, new_member_email,
      new_member_role, new_member_phone, new_member_company,
      registered_date, admin_dashboard_url
    } = data;

    const body = `
      <p>Hi ${admin_name},</p>
      <p>A new team member has joined the platform.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${new_member_name}</span></div>
        <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${new_member_email}</span></div>
        <div class="detail-row"><span class="detail-label">Role</span><span class="detail-value"><span class="badge">${new_member_role}</span></span></div>
        <div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value">${new_member_phone || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Company</span><span class="detail-value">${new_member_company || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Joined On</span><span class="detail-value">${registered_date}</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="badge badge-green">Active</span></span></div>
      </div>
      <div class="btn-center">
        <a href="${admin_dashboard_url}" class="btn">View Team Members</a>
      </div>
    `;
    return sendEmail({
      to: admin_email,
      subject: `New Team Member Joined — ${new_member_name}`,
      html: wrapEmail('Team Notification', 'New team member joined.', body),
    });
  },

  // Notification to admins when a case is assigned
  caseAssignedNotificationToAdmin: (data) => {
    const {
      admin_name, admin_email, case_reference, case_type, case_sub_type,
      priority, partner_name, assigned_to_name, assigned_to_role,
      assigned_by_name, assigned_date, case_id
    } = data;

    const priorityClass = (priority === 'urgent' || priority === 'critical') ? 'badge-red' : 'badge-yellow';

    const body = `
      <p>Hi ${admin_name},</p>
      <p>A case has been assigned to a team member.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Case Reference</span><span class="detail-value">${case_reference}</span></div>
        <div class="detail-row"><span class="detail-label">Case Type</span><span class="detail-value">${case_type || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Sub Type</span><span class="detail-value">${case_sub_type || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Priority</span><span class="detail-value"><span class="badge ${priorityClass}">${priority || 'Normal'}</span></span></div>
        <div class="detail-row"><span class="detail-label">Partner</span><span class="detail-value">${partner_name || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Assigned To</span><span class="detail-value">${assigned_to_name} <span class="badge">${assigned_to_role || 'Team Member'}</span></span></div>
        <div class="detail-row"><span class="detail-label">Assigned By</span><span class="detail-value">${assigned_by_name}</span></div>
        <div class="detail-row"><span class="detail-label">Assigned On</span><span class="detail-value">${assigned_date}</span></div>
      </div>
      <div class="btn-center">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/cases/${case_id}" class="btn">View Case</a>
      </div>
    `;
    return sendEmail({
      to: admin_email,
      subject: `Case Assigned — ${case_reference}`,
      html: wrapEmail('Case Management', 'Case assignment update.', body),
    });
  },

  // Admin notification: sub consultant approved
  adminNotificationForApproval: (approvedUser, admin) => {
    const body = `
      <p>Hi ${admin.first_name || 'Admin'},</p>
      <p>A new Sub Consultant has been approved and can now access the platform.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${approvedUser.first_name || ''} ${approvedUser.last_name || ''}</span></div>
        <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${approvedUser.email}</span></div>
        <div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value">${approvedUser.phone || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Company</span><span class="detail-value">${approvedUser.company_name || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Role</span><span class="detail-value">Sub Consultant</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="badge badge-green">Active</span></span></div>
        <div class="detail-row"><span class="detail-label">Approved On</span><span class="detail-value">${new Date().toLocaleString()}</span></div>
      </div>
      <div class="btn-center">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/users" class="btn">View All Users</a>
      </div>
    `;
    return sendEmail({
      to: admin.email,
      subject: 'New Sub Consultant Approved',
      html: wrapEmail('Admin Notification', 'Sub Consultant approved.', body),
    });
  },

  // Approval / rejection status to sub consultant
  approvalStatus: (userData, status, reason = null) => {
    const isApproved = status === 'approved';

    const body = isApproved ? `
      <p>Hi ${userData.first_name || ''} ${userData.last_name || ''},</p>
      <p>Your Sub Consultant application has been approved. You now have full access to the platform.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${userData.first_name || ''} ${userData.last_name || ''}</span></div>
        <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${userData.email}</span></div>
        <div class="detail-row"><span class="detail-label">Role</span><span class="detail-value">Sub Consultant</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="badge badge-green">Active</span></span></div>
      </div>
      <ul class="feature-list">
        <li>Create and manage cases</li>
        <li>Upload documents for review</li>
        <li>Track case status in real-time</li>
        <li>Collaborate with the admin team</li>
      </ul>
      <div class="btn-center">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login" class="btn">Sign In to Your Account</a>
      </div>
      <div class="note-box">
        Sign in using your email <strong>${userData.email}</strong> and the password you created during registration.
      </div>
    ` : `
      <p>Hi ${userData.first_name || ''} ${userData.last_name || ''},</p>
      <p>After review, we were unable to approve your Sub Consultant application at this time.</p>
      ${reason ? `
        <div class="detail-block">
          <div class="detail-row"><span class="detail-label">Reason</span><span class="detail-value">${reason}</span></div>
        </div>
      ` : ''}
      <p>If you believe this is an error or would like to learn more, please reach out to our support team.</p>
      <div class="note-box">
        Email: <a href="mailto:${process.env.SUPPORT_EMAIL || 'info@alhudafinancial.com'}" style="color:#0071e3;">${process.env.SUPPORT_EMAIL || 'info@alhudafinancial.com'}</a>
      </div>
    `;

    return sendEmail({
      to: userData.email,
      subject: isApproved
        ? 'Application approved — welcome aboard'
        : 'Update on your application',
      html: wrapEmail(
        'Sub Consultant Application',
        isApproved ? 'Your application has been approved.' : 'Application status update.',
        body
      ),
    });
  },

  // Case submitted confirmation to partner
  caseSubmittedToPartner: (data) => {
    const {
      partner_name, partner_email, case_reference, case_type,
      case_sub_type, description, priority, submitted_date, document_count
    } = data;

    const priorityClass = (priority === 'urgent' || priority === 'critical') ? 'badge-red' : 'badge-yellow';

    const body = `
      <p>Hi ${partner_name},</p>
      <p>Your case has been successfully submitted. Our team will review it and keep you updated.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Case Reference</span><span class="detail-value">${case_reference}</span></div>
        <div class="detail-row"><span class="detail-label">Case Type</span><span class="detail-value">${case_type || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Sub Type</span><span class="detail-value">${case_sub_type || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Priority</span><span class="detail-value"><span class="badge ${priorityClass}">${priority || 'Normal'}</span></span></div>
        <div class="detail-row"><span class="detail-label">Description</span><span class="detail-value">${description || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Documents</span><span class="detail-value"><span class="badge badge-blue">${document_count} uploaded</span></span></div>
        <div class="detail-row"><span class="detail-label">Submitted On</span><span class="detail-value">${submitted_date}</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="badge badge-yellow">Pending Review</span></span></div>
      </div>
      <ul class="feature-list">
        <li>Our team will review your case</li>
        <li>You will receive email updates when the status changes</li>
        <li>Log in to track your case at any time</li>
      </ul>
      <div class="btn-center">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/cases/track?ref=${case_reference}" class="btn">Track Your Case</a>
      </div>
    `;
    return sendEmail({
      to: partner_email,
      subject: `Case submitted — ${case_reference}`,
      html: wrapEmail('Case Submission', 'Case submitted successfully.', body),
    });
  },

  // New case notification to admins
  newCaseNotificationToAdmin: (data) => {
    const {
      admin_name, admin_email, partner_name, partner_email,
      case_reference, case_type, case_sub_type, description,
      priority, submitted_date, document_count, case_id
    } = data;

    const priorityClass = (priority === 'urgent' || priority === 'critical') ? 'badge-red' : 'badge-yellow';

    const body = `
      <p>Hi ${admin_name},</p>
      <p>A new case has been submitted and requires your attention.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Partner</span><span class="detail-value">${partner_name} &lt;${partner_email}&gt;</span></div>
        <div class="detail-row"><span class="detail-label">Case Reference</span><span class="detail-value">${case_reference}</span></div>
        <div class="detail-row"><span class="detail-label">Case Type</span><span class="detail-value">${case_type || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Sub Type</span><span class="detail-value">${case_sub_type || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Priority</span><span class="detail-value"><span class="badge ${priorityClass}">${priority || 'Normal'}</span></span></div>
        <div class="detail-row"><span class="detail-label">Description</span><span class="detail-value">${description || '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Documents</span><span class="detail-value"><span class="badge badge-blue">${document_count} uploaded</span></span></div>
        <div class="detail-row"><span class="detail-label">Submitted On</span><span class="detail-value">${submitted_date}</span></div>
      </div>
      <div class="btn-center">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/cases/${case_id}" class="btn">Review Case</a>
      </div>
    `;
    return sendEmail({
      to: admin_email,
      subject: `New Case Received — ${case_reference}`,
      html: wrapEmail('Case Management', 'New case received.', body),
    });
  },

  // Generic notification
  notification: async (to, subject, message, type = 'info') => {
    const badgeMap = { info: 'badge-blue', success: 'badge-green', warning: 'badge-yellow', error: 'badge-red' };
    const body = `
      <div class="note-box">
        <span class="badge ${badgeMap[type] || 'badge-blue'}">${type.charAt(0).toUpperCase() + type.slice(1)}</span>
        <div style="margin-top:12px;">${message}</div>
      </div>
    `;
    return sendEmail({
      to,
      subject,
      html: wrapEmail('Notification', subject, body),
    });
  },

  // Order confirmation
  orderConfirmation: async (to, orderData) => {
    const { name, orderId, items, total, shippingAddress } = orderData;

    const itemRows = items.map(item => `
      <div class="detail-row">
        <span class="detail-label">${item.name}</span>
        <span class="detail-value">x${item.quantity} — $${(item.quantity * item.price).toFixed(2)}</span>
      </div>
    `).join('');

    const body = `
      <p>Hi ${name},</p>
      <p>Thank you for your order. Here's a summary of what you purchased.</p>
      <div class="detail-block">
        <div class="detail-row"><span class="detail-label">Order ID</span><span class="detail-value">${orderId}</span></div>
        <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${new Date().toLocaleDateString()}</span></div>
        ${itemRows}
        <div class="detail-row"><span class="detail-label">Total</span><span class="detail-value"><strong>$${total.toFixed(2)}</strong></span></div>
        <div class="detail-row"><span class="detail-label">Shipping</span><span class="detail-value">Free</span></div>
      </div>
      ${shippingAddress ? `
        <p style="font-size:13px;color:#6e6e73;margin-bottom:8px;">Shipping to</p>
        <div class="note-box">
          ${shippingAddress.street}<br>
          ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zip}<br>
          ${shippingAddress.country}
        </div>
      ` : ''}
      <p>We'll notify you when your order ships.</p>
    `;
    return sendEmail({
      to,
      subject: `Order confirmed — #${orderId}`,
      html: wrapEmail('Order Confirmation', `Order #${orderId}`, body),
    });
  },
};

module.exports = {
  sendEmail,
  sendTemplateEmail,
  emailTemplates,
  reconnect
};
