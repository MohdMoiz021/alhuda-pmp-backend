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
      ${footerNote || `© ${new Date().getFullYear()} ${process.env.COMPANY_NAME || 'Alhuda CIBE Financial'}. All rights reserved.`}
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
        <a href="${process.env.FRONTEND_URL || 'http://localhost:5000'}/dashboard" class="btn">Go to Dashboard</a>
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

    // New: Registration Approved Email for Sub Consultant
  registrationApproved: async (userData) => {
    const body = `
      <p>Hi ${userData.name},</p>
      <p>Congratulations! Your registration as a Sub Consultant has been <strong style="color: #10b981;">approved</strong> by the admin. You now have full access to the platform.</p>
      
      <div class="detail-block">
        <div class="detail-row">
          <span class="detail-label">Name</span>
          <span class="detail-value">${userData.name}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Email</span>
          <span class="detail-value">${userData.email}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Phone</span>
          <span class="detail-value">${userData.phone || 'Not provided'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">WhatsApp Number</span>
          <span class="detail-value">${userData.whatsapp_number || 'Not provided'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Company Name</span>
          <span class="detail-value">${userData.company_name || 'Not provided'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Location</span>
          <span class="detail-value">${userData.location || 'Not provided'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Status</span>
          <span class="detail-value"><span class="badge badge-green">Active</span></span>
        </div>
      </div>
      
      <h3>What you can do now:</h3>
      <ul class="feature-list">
        <li>✓ Create and manage cases</li>
        <li>✓ Upload documents for review</li>
        <li>✓ Track case status in real-time</li>
        <li>✓ Collaborate with the admin team</li>
        <li>✓ Access your dashboard anytime</li>
      </ul>
      
      <div class="btn-center">
        <a href="${userData.login_url}" class="btn">Sign In to Your Account</a>
      </div>
      
      <div class="note-box">
        <strong>Getting Started:</strong><br />
        Log in using your email <strong>${userData.email}</strong> and the password you created during registration. If you forgot your password, use the "Forgot Password" option on the login page.
      </div>
      
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;" />
      
      <p style="font-size: 12px; color: #6b7280;">If you have any questions or need assistance, please contact our support team at <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@alhudafinancial.com'}">${process.env.SUPPORT_EMAIL || 'support@alhudafinancial.com'}</a></p>
    `;

    return sendEmail({
      to: userData.email,
      subject: '🎉 Registration Approved — Welcome to Al Huda Financial!',
      html: wrapEmail(
        'Registration Approved',
        'Your Sub Consultant application has been approved!',
        body
      ),
    });
  },

  // New: Registration Rejected Email for Sub Consultant
  registrationRejected: async (userData) => {
    const body = `
      <p>Hi ${userData.name},</p>
      <p>Thank you for your interest in becoming a Sub Consultant with Al Huda Financial. After careful review, we regret to inform you that your registration application has been <strong style="color: #dc2626;">rejected</strong>.</p>
      
      <div class="detail-block">
        <div class="detail-row">
          <span class="detail-label">Reason for Rejection</span>
          <span class="detail-value" style="color: #dc2626;">${userData.rejection_reason}</span>
        </div>
      </div>
      
      <div class="note-box" style="background-color: #fef2f2; border-left-color: #dc2626;">
        <p><strong>What can you do?</strong></p>
        <ul>
          <li>Review the rejection reason above</li>
          <li>Update your information if needed</li>
          <li>Contact our support team for clarification</li>
          <li>Submit a new application with corrected details</li>
        </ul>
      </div>
      
      <p>If you believe this decision was made in error or would like more information about the specific reason, please don't hesitate to reach out to our support team.</p>
      
      <div class="note-box">
        <strong>Contact Support:</strong><br />
        Email: <a href="mailto:${userData.support_email}" style="color:#0071e3;">${userData.support_email}</a>
      </div>
      
      <p>We appreciate your interest and encourage you to reapply with the necessary corrections.</p>
      
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;" />
      
      <p style="font-size: 12px; color: #6b7280;">Thank you for your understanding.</p>
    `;

    return sendEmail({
      to: userData.email,
      subject: '📋 Update on Your Sub Consultant Application',
      html: wrapEmail(
        'Application Status Update',
        'Important information about your application',
        body
      ),
    });
  },

   adminApprovalNotification: async (data) => {
    const body = `
      <p>Hi ${data.admin_name},</p>
      <p>A new Sub Consultant has been <strong style="color: #10b981;">approved</strong> and is now active on the platform.</p>
      
      <div class="detail-block">
        <div class="detail-row">
          <span class="detail-label">Name</span>
          <span class="detail-value">${data.approved_user.name}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Email</span>
          <span class="detail-value">${data.approved_user.email}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Phone</span>
          <span class="detail-value">${data.approved_user.phone}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">WhatsApp Number</span>
          <span class="detail-value">${data.approved_user.whatsapp_number}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Company Name</span>
          <span class="detail-value">${data.approved_user.company_name}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Location</span>
          <span class="detail-value">${data.approved_user.location}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Approved Date</span>
          <span class="detail-value">${data.approved_user.approved_date}</span>
        </div>
      </div>
      
      <div class="btn-center">
        <a href="${data.admin_dashboard_url}" class="btn">View Admin Dashboard</a>
      </div>
      
      <div class="note-box">
        <strong>Next Steps:</strong><br />
        The approved Sub Consultant can now log in and start using the platform. You can manage their permissions and access from the admin dashboard.
      </div>
    `;

    const emailOptions = {
      to: data.admin_email,
      subject: '✅ New Sub Consultant Approved',
      html: wrapEmail(
        'Sub Consultant Approved',
        'A new Sub Consultant has been approved',
        body
      ),
    };

    // Add CC if provided
    if (data.cc_email) {
      emailOptions.cc = data.cc_email;
    }

    return sendEmail(emailOptions);
  },

  // New: Admin Rejection Notification
  adminRejectionNotification: async (data) => {
    const body = `
      <p>Hi ${data.admin_name},</p>
      <p>A Sub Consultant application has been <strong style="color: #dc2626;">rejected</strong>. Below are the details:</p>
      
      <div class="detail-block">
        <div class="detail-row">
          <span class="detail-label">Name</span>
          <span class="detail-value">${data.rejected_user.name}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Email</span>
          <span class="detail-value">${data.rejected_user.email}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Phone</span>
          <span class="detail-value">${data.rejected_user.phone}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">WhatsApp Number</span>
          <span class="detail-value">${data.rejected_user.whatsapp_number}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Company Name</span>
          <span class="detail-value">${data.rejected_user.company_name}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Location</span>
          <span class="detail-value">${data.rejected_user.location}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Rejection Reason</span>
          <span class="detail-value" style="color: #dc2626;">${data.rejected_user.rejection_reason}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Rejected Date</span>
          <span class="detail-value">${data.rejected_user.rejected_date}</span>
        </div>
      </div>
      
      <div class="note-box">
        <strong>Note:</strong><br />
        The applicant has been notified of this decision. They may reapply with corrected information if applicable.
      </div>
    `;

    const emailOptions = {
      to: data.admin_email,
      subject: '❌ Sub Consultant Application Rejected',
      html: wrapEmail(
        'Sub Consultant Rejected',
        'A Sub Consultant application has been rejected',
        body
      ),
    };

    // Add CC if provided
    if (data.cc_email) {
      emailOptions.cc = data.cc_email;
    }

    return sendEmail(emailOptions);
  },

  // Add to emailService.js

// ============================================
// CASE STATUS EMAIL TEMPLATES
// ============================================

// 1. Case Approved - Client Email
caseApproved: async (caseData) => {
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #10b981; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">✅ Case Approved</h1>
      </div>
      
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Dear ${caseData.clientName},</p>
        
        <p>We are pleased to inform you that your case <strong>#${caseData.caseId}</strong> has been <strong style="color: #10b981;">APPROVED</strong>.</p>
        
        ${caseData.financialDetails ? `
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Financial Summary</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0;"><strong>Total Deal Value:</strong></td>
              <td style="padding: 8px 0; text-align: right;">£${parseFloat(caseData.financialDetails.total_deal_value).toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Profit Margin:</strong></td>
              <td style="padding: 8px 0; text-align: right;">${caseData.financialDetails.profit_margin}%</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Total Profit:</strong></td>
              <td style="padding: 8px 0; text-align: right;">£${parseFloat(caseData.financialDetails.total_profit).toLocaleString()}</td>
            </tr>
            <tr style="border-top: 2px solid #d1d5db;">
              <td style="padding: 12px 0 0 0;"><strong>Your Commission:</strong></td>
              <td style="padding: 12px 0 0 0; text-align: right; color: #10b981; font-size: 18px;"><strong>£${parseFloat(caseData.financialDetails.commission).toLocaleString()}</strong></td>
            </tr>
          </table>
        </div>
        ` : ''}
        
        <p>You can now proceed with the next steps. Our team will contact you shortly with further instructions.</p>
        
        <div class="btn-center" style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL}/cases/${caseData.caseId}" 
             style="background-color: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Case Details
          </a>
        </div>
        
        <div class="note-box" style="background-color: #fef9e3; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <strong>Next Steps:</strong>
          <ul style="margin: 10px 0 0 20px;">
            <li>Review the financial summary above</li>
            <li>Complete any outstanding documentation</li>
            <li>Contact our team if you have questions</li>
          </ul>
        </div>
        
        <p>If you have any questions, please contact our support team.</p>
        
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;" />
        
        <p style="font-size: 12px; color: #6b7280;">
          Best regards,<br />
          <strong>Al Huda CIBE Finance Team</strong>
        </p>
      </div>
    </div>
  `;

  return sendEmail({
    to: caseData.clientEmail,
    subject: `✅ Case #${caseData.caseId} Approved - Al Huda CIBE Finance`,
    html: wrapEmail('Case Approved', 'Your case has been approved!', body)
  });
},

// 2. Case Approved - Admin Notification
caseApprovedAdmin: async (caseData, adminEmails) => {
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #10b981; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">✅ Case Approved</h1>
      </div>
      
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>A case has been <strong style="color: #10b981;">APPROVED</strong>.</p>
        
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Case Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0;"><strong>Case ID:</strong></td><td style="padding: 8px 0;">#${caseData.caseId}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Client:</strong></td><td style="padding: 8px 0;">${caseData.clientName}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Client Email:</strong></td><td style="padding: 8px 0;">${caseData.clientEmail}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Approved By:</strong></td><td style="padding: 8px 0;">${caseData.updatedBy || 'System'}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Approved At:</strong></td><td style="padding: 8px 0;">${new Date().toLocaleString()}</td></tr>
          </table>
        </div>
        
        <div class="btn-center" style="text-align: center; margin: 30px 0;">
          <a href="${process.env.ADMIN_URL}/cases/${caseData.caseId}" 
             style="background-color: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Case in Admin
          </a>
        </div>
      </div>
    </div>
  `;

  return sendEmail({
    to: adminEmails,
    subject: `✅ Case #${caseData.caseId} Approved - Action Required`,
    html: wrapEmail('Case Approved', 'A case has been approved', body)
  });
},

// 3. Case Rejected - Client Email
caseRejected: async (caseData) => {
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #dc2626; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">❌ Case Update</h1>
      </div>
      
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Dear ${caseData.clientName},</p>
        
        <p>We regret to inform you that your case <strong>#${caseData.caseId}</strong> has been <strong style="color: #dc2626;">REJECTED</strong>.</p>
        
        ${caseData.remarks ? `
        <div style="background-color: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <strong style="color: #991b1b;">Reason for Rejection:</strong>
          <p style="margin: 10px 0 0 0; color: #991b1b;">${caseData.remarks}</p>
        </div>
        ` : ''}
        
        <div class="note-box" style="background-color: #fef9e3; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <strong>What can you do?</strong>
          <ul style="margin: 10px 0 0 20px;">
            <li>Review the rejection reason above</li>
            <li>Update the information as needed</li>
            <li>Contact our support team for clarification</li>
            <li>Submit a new case with corrected details</li>
          </ul>
        </div>
        
        <p>If you have questions or need assistance, please contact our support team.</p>
        
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;" />
        
        <p style="font-size: 12px; color: #6b7280;">
          Best regards,<br />
          <strong>Al Huda CIBE Finance Team</strong>
        </p>
      </div>
    </div>
  `;

  return sendEmail({
    to: caseData.clientEmail,
    subject: `❌ Case #${caseData.caseId} Update - Al Huda CIBE Finance`,
    html: wrapEmail('Case Status Update', 'Important update on your case', body)
  });
},

// 4. Case Clarification Needed - Client Email
caseClarificationNeeded: async (caseData) => {
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #f59e0b; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">📝 Clarification Required</h1>
      </div>
      
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Dear ${caseData.clientName},</p>
        
        <p>We are reviewing your case <strong>#${caseData.caseId}</strong> and need additional information.</p>
        
        <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <strong style="color: #92400e;">Information Required:</strong>
          <p style="margin: 10px 0 0 0; color: #92400e;">${caseData.remarks}</p>
        </div>
        
        <p>Please provide the requested information as soon as possible to continue with the review process.</p>
        
        <div class="btn-center" style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL}/cases/${caseData.caseId}" 
             style="background-color: #f59e0b; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Update Your Case
          </a>
        </div>
        
        <p>If you have any questions, please contact our support team.</p>
        
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;" />
        
        <p style="font-size: 12px; color: #6b7280;">
          Best regards,<br />
          <strong>Al Huda CIBE Finance Team</strong>
        </p>
      </div>
    </div>
  `;

  return sendEmail({
    to: caseData.clientEmail,
    subject: `📝 Clarification Needed: Case #${caseData.caseId} - Al Huda CIBE Finance`,
    html: wrapEmail('Clarification Required', 'Additional information needed', body)
  });
},

// 5. Case In Review - Client Email
caseInReview: async (caseData) => {
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #3b82f6; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">🔄 Case In Review</h1>
      </div>
      
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Dear ${caseData.clientName},</p>
        
        <p>Your case <strong>#${caseData.caseId}</strong> is currently <strong style="color: #3b82f6;">IN REVIEW</strong>.</p>
        
        ${caseData.remarks ? `
        <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <strong>Review Notes:</strong>
          <p style="margin: 10px 0 0 0;">${caseData.remarks}</p>
        </div>
        ` : `
        <p>Our team is carefully reviewing your application. We will notify you once the review is complete.</p>
        `}
        
        <div class="note-box" style="background-color: #f3f4f6; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <strong>Timeline:</strong>
          <p>Typical review time: 2-3 business days. We'll keep you updated on any progress.</p>
        </div>
        
        <div class="btn-center" style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL}/cases/${caseData.caseId}" 
             style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Track Case Status
          </a>
        </div>
        
        <p>Thank you for your patience.</p>
        
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;" />
        
        <p style="font-size: 12px; color: #6b7280;">
          Best regards,<br />
          <strong>Al Huda CIBE Finance Team</strong>
        </p>
      </div>
    </div>
  `;

  return sendEmail({
    to: caseData.clientEmail,
    subject: `🔄 Case #${caseData.caseId} In Review - Al Huda CIBE Finance`,
    html: wrapEmail('Case In Review', 'Your case is being reviewed', body)
  });
},

// 6. Case Pending - Client Email
casePending: async (caseData) => {
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #6b7280; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">⏳ Case Pending</h1>
      </div>
      
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Dear ${caseData.clientName},</p>
        
        <p>Your case <strong>#${caseData.caseId}</strong> has been submitted and is now <strong style="color: #6b7280;">PENDING</strong> review.</p>
        
        ${caseData.remarks ? `
        <div style="background-color: #f3f4f6; padding: 15px; margin: 20px 0; border-radius: 4px;">
          <strong>Notes:</strong>
          <p style="margin: 10px 0 0 0;">${caseData.remarks}</p>
        </div>
        ` : ''}
        
        <p>We will notify you once the review begins. Thank you for choosing Al Huda CIBE Finance.</p>
        
        <div class="btn-center" style="text-align: center; margin: 30px 0;">
          <a href="${process.env.FRONTEND_URL}/cases/${caseData.caseId}" 
             style="background-color: #6b7280; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Case Details
          </a>
        </div>
        
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;" />
        
        <p style="font-size: 12px; color: #6b7280;">
          Best regards,<br />
          <strong>Al Huda CIBE Finance Team</strong>
        </p>
      </div>
    </div>
  `;

  return sendEmail({
    to: caseData.clientEmail,
    subject: `⏳ Case #${caseData.caseId} Submitted - Al Huda CIBE Finance`,
    html: wrapEmail('Case Submitted', 'Your case is pending review', body)
  });
},

// 7. Case Rejected - Admin Notification
caseRejectedAdmin: async (caseData, adminEmails) => {
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #dc2626; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">❌ Case Rejected</h1>
      </div>
      
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>A case has been <strong style="color: #dc2626;">REJECTED</strong>.</p>
        
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Case Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0;"><strong>Case ID:</strong></td><td style="padding: 8px 0;">#${caseData.caseId}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Client:</strong></td><td style="padding: 8px 0;">${caseData.clientName}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Client Email:</strong></td><td style="padding: 8px 0;">${caseData.clientEmail}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Rejected By:</strong></td><td style="padding: 8px 0;">${caseData.updatedBy || 'System'}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Rejection Reason:</strong></td><td style="padding: 8px 0;">${caseData.remarks}</td></tr>
          </table>
        </div>
        
        <div class="btn-center" style="text-align: center; margin: 30px 0;">
          <a href="${process.env.ADMIN_URL}/cases/${caseData.caseId}" 
             style="background-color: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Case in Admin
          </a>
        </div>
      </div>
    </div>
  `;

  return sendEmail({
    to: adminEmails,
    subject: `❌ Case #${caseData.caseId} Rejected - Action Required`,
    html: wrapEmail('Case Rejected', 'A case has been rejected', body)
  });
},

// 8. Case Clarification Needed - Admin Notification
caseClarificationNeededAdmin: async (caseData, adminEmails) => {
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #f59e0b; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">📝 Clarification Requested</h1>
      </div>
      
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Clarification has been requested for a case.</p>
        
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Case Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0;"><strong>Case ID:</strong></td><td style="padding: 8px 0;">#${caseData.caseId}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Client:</strong></td><td style="padding: 8px 0;">${caseData.clientName}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Client Email:</strong></td><td style="padding: 8px 0;">${caseData.clientEmail}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Requested By:</strong></td><td style="padding: 8px 0;">${caseData.updatedBy || 'System'}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Requested Information:</strong></td><td style="padding: 8px 0;">${caseData.remarks}</td></tr>
          </table>
        </div>
        
        <div class="btn-center" style="text-align: center; margin: 30px 0;">
          <a href="${process.env.ADMIN_URL}/cases/${caseData.caseId}" 
             style="background-color: #f59e0b; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            View Case in Admin
          </a>
        </div>
      </div>
    </div>
  `;

  return sendEmail({
    to: adminEmails,
    subject: `📝 Clarification Requested - Case #${caseData.caseId}`,
    html: wrapEmail('Clarification Requested', 'Additional information needed', body)
  });
},

// 9. Case In Review - Admin Notification
caseInReviewAdmin: async (caseData, adminEmails) => {
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #3b82f6; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">🔄 Case In Review</h1>
      </div>
      
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>A case has been moved to <strong style="color: #3b82f6;">IN REVIEW</strong> status.</p>
        
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Case Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0;"><strong>Case ID:</strong></td><td style="padding: 8px 0;">#${caseData.caseId}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Client:</strong></td><td style="padding: 8px 0;">${caseData.clientName}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Client Email:</strong></td><td style="padding: 8px 0;">${caseData.clientEmail}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Updated By:</strong></td><td style="padding: 8px 0;">${caseData.updatedBy || 'System'}</td></tr>
          </table>
        </div>
        
        <div class="btn-center" style="text-align: center; margin: 30px 0;">
          <a href="${process.env.ADMIN_URL}/cases/${caseData.caseId}" 
             style="background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Review Case
          </a>
        </div>
      </div>
    </div>
  `;

  return sendEmail({
    to: adminEmails,
    subject: `🔄 Case #${caseData.caseId} In Review`,
    html: wrapEmail('Case In Review', 'A case requires attention', body)
  })
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

  // Add to emailService.js

whatsappConversationStarted: async (data) => {
  const body = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #25D366; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0;">💬 New WhatsApp Message</h1>
      </div>
      
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p>Hello ${data.adminName},</p>
        
        <p>A new WhatsApp conversation has been started regarding <strong>Case #${data.caseId}</strong>.</p>
        
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Customer Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0;"><strong>Name:</strong></td><td>${data.userName}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Phone:</strong></td><td>${data.userPhone}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Email:</strong></td><td>${data.userEmail}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Case ID:</strong></td><td>#${data.caseId}</td></tr>
          </table>
        </div>
        
        <div style="background-color: #fef9e3; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
          <strong>First Message:</strong>
          <p style="margin: 10px 0 0 0;">"${data.firstMessage}"</p>
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #6b7280;">
            Received at: ${new Date(data.messageTime).toLocaleString()}
          </p>
        </div>
        
        <div class="btn-center" style="text-align: center; margin: 30px 0;">
          <a href="${process.env.ADMIN_URL}/cases/${data.caseId}?tab=chat" 
             style="background-color: #25D366; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Reply via WhatsApp
          </a>
        </div>
        
        <div class="note-box" style="background-color: #f3f4f6; padding: 15px; border-radius: 4px;">
          <strong>Quick Reply Options:</strong>
          <ul style="margin: 10px 0 0 20px;">
            <li>Click the button above to open the case</li>
            <li>Type your message and send</li>
            <li>The customer will receive your reply on WhatsApp</li>
          </ul>
        </div>
        
        <p style="font-size: 12px; color: #6b7280; margin-top: 20px;">
          This is a one-time notification for this conversation.
        </p>
      </div>
    </div>
  `;

  return sendEmail({
    to: data.adminEmail,
    subject: `💬 New WhatsApp Message - Case #${data.caseId}`,
    html: wrapEmail('New WhatsApp Message', 'Customer has started a conversation', body)
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
  const fullName = `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || 'User';

  const body = isApproved ? `
    <p>Hi ${fullName},</p>
    <p>Your Sub Consultant application has been <strong style="color: #10b981;">approved</strong>. You now have full access to the platform.</p>
    
    <div class="detail-block">
      <div class="detail-row">
        <span class="detail-label">Name</span>
        <span class="detail-value">${fullName}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Email</span>
        <span class="detail-value">${userData.email}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Role</span>
        <span class="detail-value">Sub Consultant</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status</span>
        <span class="detail-value"><span class="badge badge-green">Active</span></span>
      </div>
    </div>
    
    <h3>What you can do now:</h3>
    <ul class="feature-list">
      <li>✓ Create and manage cases</li>
      <li>✓ Upload documents for review</li>
      <li>✓ Track case status in real-time</li>
      <li>✓ Collaborate with the admin team</li>
    </ul>
    
    <div class="btn-center">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login" class="btn">Sign In to Your Account</a>
    </div>
    
    <div class="note-box">
      <strong>Note:</strong> Sign in using your email <strong>${userData.email}</strong> and the password you created during registration.
    </div>
    
    <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;" />
    
    <p style="font-size: 12px; color: #6b7280;">If you have any questions, please contact our support team.</p>
  ` : `
    <p>Hi ${fullName},</p>
    <p>Thank you for your interest in becoming a Sub Consultant. After careful review, we regret to inform you that we are unable to approve your application at this time.</p>
    
    ${reason ? `
      <div class="detail-block">
        <div class="detail-row">
          <span class="detail-label">Reason for rejection</span>
          <span class="detail-value" style="color: #dc2626;">${reason}</span>
        </div>
      </div>
    ` : `
      <div class="note-box" style="background-color: #fef2f2; border-left-color: #dc2626;">
        <p style="margin: 0; color: #991b1b;">Common reasons for rejection include:</p>
        <ul style="margin: 10px 0 0 20px; color: #991b1b;">
          <li>Incomplete or inaccurate information provided</li>
          <li>Unable to verify the provided details</li>
          <li>Does not meet our eligibility requirements</li>
        </ul>
      </div>
    `}
    
    <p>If you believe this decision was made in error or would like more information about the specific reason, please don't hesitate to reach out to our support team.</p>
    
    <div class="note-box">
      <strong>Contact Support:</strong><br />
      Email: <a href="mailto:${process.env.SUPPORT_EMAIL || 'info@alhudafinancial.com'}" style="color:#0071e3;">${process.env.SUPPORT_EMAIL || 'info@alhudafinancial.com'}</a>
    </div>
    
    <p>You may reapply with corrected information at any time.</p>
    
    <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;" />
    
    <p style="font-size: 12px; color: #6b7280;">We appreciate your interest and wish you the best.</p>
  `;

  return sendEmail({
    to: userData.email,
    subject: isApproved
      ? '🎉 Application Approved — Welcome to Al Huda Financial!'
      : '📋 Update on Your Sub Consultant Application',
    html: wrapEmail(
      'Sub Consultant Application',
      isApproved 
        ? 'Congratulations! Your application has been approved.' 
        : 'Status Update on Your Application',
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
