const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const handlebars = require('handlebars');

// Create reusable transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST,
    port: parseInt(process.env.BREVO_SMTP_PORT),
    secure: false, // true for 465, false for 587
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_KEY, // Make sure this is SMTP key, not API key
    },
    // Optional: Add connection pool settings for better performance
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });
};

// Create transporter instance
let transporter = createTransporter();

// Simple email sending function
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
    // Validate required fields
    if (!to) {
      throw new Error('No recipients defined');
    }

    // Generate plain text from HTML if text not provided and HTML exists
    let plainText = text;
    if (!plainText && html) {
      plainText = html.replace(/<[^>]*>?/gm, ''); // Strip HTML tags
    }

    const mailOptions = {
      from: from || `"${process.env.BREVO_FROM_NAME}" <${process.env.BREVO_FROM_EMAIL}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      text: plainText || '', // Ensure text is never undefined
      attachments,
      ...(cc && { cc: Array.isArray(cc) ? cc.join(', ') : cc }),
      ...(bcc && { bcc: Array.isArray(bcc) ? bcc.join(', ') : bcc }),
      ...(replyTo && { replyTo }),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    
    return {
      success: true,
      messageId: info.messageId,
      response: info.response
    };
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    
    // Handle specific error types
    if (error.code === 'EAUTH') {
      throw new Error('Authentication failed. Check your Brevo SMTP key.');
    } else if (error.code === 'ESOCKET') {
      throw new Error('Network error. Check your internet connection.');
    } else if (error.responseCode === 554) {
      throw new Error('Email rejected. Check recipient address.');
    } else if (error.message === 'No recipients defined') {
      throw new Error('Email cannot be sent: No recipient email address provided');
    }
    
    throw error;
  }
};


// Template-based email sending
const sendTemplateEmail = async ({ 
  to, 
  subject, 
  templateName,
  templateData = {},
  ...options 
}) => {
  try {
    // Load template file
    const templatePath = path.join(__dirname, '../templates', `${templateName}.html`);
    let templateHtml = await fs.readFile(templatePath, 'utf-8');
    
    // Compile with Handlebars
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
  console.log('🔄 Email transporter reconnected');
};

// Pre-built email templates
const emailTemplates = {
  // Welcome email for auto-approved users (admin_b, admin_c)
  welcome: async (to, name) => {
    return sendEmail({
      to,
      subject: 'Welcome to Our Platform! 🎉',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Welcome, ${name}!</h1>
          <p>We're thrilled to have you on board. Get ready to explore all our features.</p>
          <div style="margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" 
               style="background-color: #007bff; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 5px;">
              Go to Dashboard
            </a>
          </div>
          <hr style="border: 1px solid #eee;" />
          <p style="color: #666; font-size: 12px;">
            Need help? <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@example.com'}">Contact support</a>
          </p>
        </div>
      `
    });
  },

  // Email sent to admin_a when they register (pending approval)
  registrationPending: (userData) => {
    return sendEmail({
      to: userData.email,
      subject: 'Registration Submitted - Awaiting Admin Approval',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 5px; }
            .content { padding: 20px; }
            .info { background-color: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
            .status-badge { 
              background-color: #ffc107; 
              color: #000; 
              padding: 5px 10px; 
              border-radius: 3px; 
              display: inline-block;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Registration Received</h2>
              <div class="status-badge">⏳ Pending Approval</div>
            </div>
            <div class="content">
              <p>Dear ${userData.first_name} ${userData.last_name},</p>
              <p>Thank you for registering as a Sub Consultant. Your application has been received and is now pending admin approval.</p>
              
              <div class="info">
                <h3>📋 Registration Details:</h3>
                <p><strong>Name:</strong> ${userData.first_name} ${userData.last_name}</p>
                <p><strong>Email:</strong> ${userData.email}</p>
                <p><strong>Phone:</strong> ${userData.phone || 'Not provided'}</p>
                <p><strong>Company:</strong> ${userData.company_name || 'Not provided'}</p>
                <p><strong>Role:</strong> Sub Consultant</p>
                <p><strong>Status:</strong> <span style="color: #ffc107;">Pending Approval</span></p>
                <p><strong>Registration Date:</strong> ${new Date().toLocaleDateString()}</p>
              </div>
              
              <p>You will receive another email once an admin reviews your application. This process typically takes 1-2 business days.</p>
              
              <p>If you have any questions, please contact our support team.</p>
              
              <p>Best regards,<br><strong>Admin Team</strong></p>
            </div>
            <div class="footer">
              <p>This is an automated message, please do not reply to this email.</p>
              <p>© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });
  },

  // Email sent to admins when new admin_a registers
adminNotification: (userData) => {
  // Check if admin email is configured
  if (!process.env.ADMIN_EMAIL) {
    console.log('⚠️ ADMIN_EMAIL not configured in .env file - skipping admin notification');
    return Promise.resolve({ 
      success: false, 
      skipped: true, 
      message: 'ADMIN_EMAIL not configured' 
    });
  }
  
  // Validate userData has required fields
  if (!userData || !userData.email) {
    console.log('⚠️ Invalid userData for admin notification');
    return Promise.resolve({ 
      success: false, 
      skipped: true, 
      message: 'Invalid user data' 
    });
  }
  
  return sendEmail({
    to: process.env.ADMIN_EMAIL,
    subject: '🔔 New Sub Consultant Registration Pending Approval',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #ffc107; padding: 20px; text-align: center; border-radius: 5px; }
          .content { padding: 20px; }
          .info { background-color: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
          .button {
            display: inline-block;
            padding: 10px 20px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin-right: 10px;
          }
          .approve { background-color: #28a745; }
          .reject { background-color: #dc3545; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>🔔 New Registration Pending Approval</h2>
          </div>
          <div class="content">
            <p>A new Sub Consultant has registered and requires your review.</p>
            
            <div class="info">
              <h3>👤 Applicant Details:</h3>
              <p><strong>Name:</strong> ${userData.first_name || ''} ${userData.last_name || ''}</p>
              <p><strong>Email:</strong> ${userData.email}</p>
              <p><strong>Phone:</strong> ${userData.phone || 'Not provided'}</p>
              <p><strong>Company:</strong> ${userData.company_name || 'Not provided'}</p>
              <p><strong>Registered:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/users/${userData.id}/approve" class="button approve">
                ✅ Approve Application
              </a>
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/users/${userData.id}/reject" class="button reject">
                ❌ Reject Application
              </a>
            </div>
            
            <p style="margin-top: 20px;">Or log in to the admin dashboard to review all pending applications.</p>
            
            <p>Best regards,<br><strong>System Notification</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated notification from your application.</p>
          </div>
        </div>
      </body>
      </html>
    `
  });
},


// In your emailService.js, add this new template to emailTemplates

// Notification to admins when a new user is approved
adminNotificationForApproval: (approvedUser, admin) => {
  return sendEmail({
    to: admin.email,
    subject: '✅ New Sub Consultant Approved',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #28a745; color: white; padding: 20px; text-align: center; border-radius: 5px; }
          .content { padding: 20px; }
          .info { background-color: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
          .button {
            display: inline-block;
            padding: 10px 20px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin-top: 20px;
          }
          .badge {
            background-color: #28a745;
            color: white;
            padding: 5px 10px;
            border-radius: 3px;
            font-size: 12px;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>✅ New Sub Consultant Approved</h2>
          </div>
          <div class="content">
            <p>Hello ${admin.first_name || 'Admin'},</p>
            <p>A new Sub Consultant has been approved and can now access the platform.</p>
            
            <div class="info">
              <h3>👤 Approved User Details:</h3>
              <p><strong>Name:</strong> ${approvedUser.first_name || ''} ${approvedUser.last_name || ''}</p>
              <p><strong>Email:</strong> ${approvedUser.email}</p>
              <p><strong>Phone:</strong> ${approvedUser.phone || 'Not provided'}</p>
              <p><strong>Company:</strong> ${approvedUser.company_name || 'Not provided'}</p>
              <p><strong>Role:</strong> Sub Consultant</p>
              <p><strong>Status:</strong> <span class="badge">Active</span></p>
              <p><strong>Approved On:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <div style="text-align: center;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/users" class="button">
                👥 View All Users
              </a>
            </div>
            
            <p style="margin-top: 30px;">The team now has a new member to collaborate with on cases.</p>
            
            <p>Best regards,<br><strong>System Notification</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated notification from your application.</p>
            <p>© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  });
},

  // Email sent when admin approves or rejects
// Update your existing approvalStatus template
approvalStatus: (userData, status, reason = null) => {
  const isApproved = status === 'approved';
  
  return sendEmail({
    to: userData.email,
    subject: isApproved 
      ? '✅ Congratulations! Your Sub Consultant Application Has Been Approved'
      : '📢 Update on Your Sub Consultant Application',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { 
            background-color: ${isApproved ? '#28a745' : '#dc3545'}; 
            color: white; 
            padding: 20px; 
            text-align: center; 
            border-radius: 5px; 
          }
          .content { padding: 20px; }
          .info { background-color: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
          .button {
            display: inline-block;
            padding: 12px 30px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
            margin: 20px 0;
          }
          .credentials {
            background-color: #f8f9fa;
            border-left: 4px solid #17a2b8;
            padding: 15px;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>${isApproved ? 'Application Approved! 🎉' : 'Application Update'}</h2>
          </div>
          <div class="content">
            <p>Dear ${userData.first_name || ''} ${userData.last_name || ''},</p>
            
            ${isApproved 
              ? `
                <p>Great news! Your Sub Consultant application has been <strong style="color: #28a745;">approved</strong> by our admin team.</p>
                
                <div class="info">
                  <h3>📋 Account Details:</h3>
                  <p><strong>Name:</strong> ${userData.first_name || ''} ${userData.last_name || ''}</p>
                  <p><strong>Email:</strong> ${userData.email}</p>
                  <p><strong>Role:</strong> Sub Consultant</p>
                  <p><strong>Status:</strong> <span style="color: #28a745; font-weight: bold;">Active</span></p>
                </div>
                
                <div class="credentials">
                  <p><strong>🔐 What you can do now:</strong></p>
                  <ul>
                    <li>Create and manage cases</li>
                    <li>Upload documents for review</li>
                    <li>Track case status in real-time</li>
                    <li>Collaborate with admin team</li>
                  </ul>
                </div>
                
                <div style="text-align: center;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login" class="button">
                    🔑 Login to Your Account
                  </a>
                </div>
                
                <p style="margin-top: 20px;"><strong>Login credentials:</strong></p>
                <p>Email: ${userData.email}<br>
                Password: (Use the password you created during registration)</p>
              `
              : `
                <p>We regret to inform you that your Sub Consultant application has been <strong style="color: #dc3545;">rejected</strong>.</p>
                
                ${reason ? `
                  <div class="info">
                    <h3>📝 Reason for rejection:</h3>
                    <p style="color: #dc3545; font-style: italic;">"${reason}"</p>
                  </div>
                ` : ''}
                
                <p>If you believe this was a mistake or would like more information, please contact our support team:</p>
                <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <p><strong>📧 Email:</strong> <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@example.com'}">${process.env.SUPPORT_EMAIL || 'support@example.com'}</a></p>
                  <p><strong>🌐 Website:</strong> ${process.env.FRONTEND_URL || 'http://localhost:3000'}</p>
                </div>
              `
            }
            
            <p>Best regards,<br><strong>Admin Team</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated message, please do not reply to this email.</p>
            <p>© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  });
},

// In your emailService.js, add these to emailTemplates

// 1. Email to Partner/Sub Consultant when case is submitted
caseSubmittedToPartner: (data) => {
  const {
    partner_name,
    partner_email,
    case_reference,
    case_type,
    case_sub_type,
    description,
    priority,
    submitted_date,
    document_count
  } = data;

  return sendEmail({
    to: partner_email,
    subject: `✅ Case Submitted Successfully - ${case_reference}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #28a745; color: white; padding: 20px; text-align: center; border-radius: 5px; }
          .content { padding: 20px; }
          .case-details { background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #007bff; }
          .info-row { display: flex; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
          .info-label { font-weight: bold; width: 140px; color: #555; }
          .info-value { flex: 1; }
          .badge { 
            background-color: #17a2b8; 
            color: white; 
            padding: 3px 10px; 
            border-radius: 20px; 
            font-size: 12px;
            display: inline-block;
          }
          .priority-badge {
            background-color: ${priority === 'urgent' || priority === 'critical' ? '#dc3545' : '#ffc107'};
            color: ${priority === 'urgent' || priority === 'critical' ? 'white' : '#333'};
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
          }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
          .button {
            display: inline-block;
            padding: 12px 30px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>✅ Case Submitted Successfully</h2>
          </div>
          <div class="content">
            <p>Dear <strong>${partner_name}</strong>,</p>
            <p>Your case has been successfully submitted to our system. Our team will review it shortly and get back to you.</p>
            
            <div class="case-details">
              <h3 style="margin-top: 0; color: #007bff;">📋 Case Details</h3>
              
              <div class="info-row">
                <div class="info-label">Case Reference:</div>
                <div class="info-value"><strong>${case_reference}</strong></div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Case Type:</div>
                <div class="info-value">${case_type || 'Not specified'}</div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Case Sub Type:</div>
                <div class="info-value">${case_sub_type || 'Not specified'}</div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Priority:</div>
                <div class="info-value">
                  <span class="priority-badge">${priority || 'Normal'}</span>
                </div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Description:</div>
                <div class="info-value">${description || 'No description provided'}</div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Documents:</div>
                <div class="info-value">
                  <span class="badge">${document_count} document(s) uploaded</span>
                </div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Submitted On:</div>
                <div class="info-value">${submitted_date}</div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Status:</div>
                <div class="info-value"><span style="color: #28a745; font-weight: bold;">Pending Review</span></div>
              </div>
            </div>
            
            <p><strong>📌 What happens next?</strong></p>
            <ul>
              <li>Our admin team will review your case</li>
              <li>You will receive email updates when the status changes</li>
              <li>You can track your case status by logging into your account</li>
            </ul>
            
            <div style="text-align: center;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/cases/track?ref=${case_reference}" class="button">
                🔍 Track Your Case
              </a>
            </div>
            
            <p>If you have any questions, please reply to this email or contact our support team.</p>
            
            <p>Best regards,<br><strong>Case Management Team</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated message, please do not reply directly to this email.</p>
            <p>© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  });
},

// 2. Email to Admins when new case is submitted
newCaseNotificationToAdmin: (data) => {
  const {
    admin_name,
    admin_email,
    partner_name,
    partner_email,
    case_reference,
    case_type,
    case_sub_type,
    description,
    priority,
    submitted_date,
    document_count,
    case_id
  } = data;

  return sendEmail({
    to: admin_email,
    subject: `🔔 New Case Received - ${case_reference}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #007bff; color: white; padding: 20px; text-align: center; border-radius: 5px; }
          .content { padding: 20px; }
          .case-details { background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745; }
          .partner-info { background-color: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .info-row { display: flex; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
          .info-label { font-weight: bold; width: 140px; color: #555; }
          .info-value { flex: 1; }
          .badge { 
            background-color: #17a2b8; 
            color: white; 
            padding: 3px 10px; 
            border-radius: 20px; 
            font-size: 12px;
            display: inline-block;
          }
          .priority-badge {
            background-color: ${priority === 'urgent' || priority === 'critical' ? '#dc3545' : '#ffc107'};
            color: ${priority === 'urgent' || priority === 'critical' ? 'white' : '#333'};
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
          }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
          .button {
            display: inline-block;
            padding: 12px 20px;
            background-color: #28a745;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
            margin: 5px;
          }
          .button-secondary {
            background-color: #6c757d;
          }
          .action-buttons {
            text-align: center;
            margin: 30px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>🔔 New Case Received</h2>
          </div>
          <div class="content">
            <p>Hello <strong>${admin_name}</strong>,</p>
            <p>A new case has been submitted and requires your attention.</p>
            
            <div class="partner-info">
              <h3 style="margin-top: 0; color: #007bff;">👤 Partner Information</h3>
              <p><strong>Name:</strong> ${partner_name}</p>
              <p><strong>Email:</strong> <a href="mailto:${partner_email}">${partner_email}</a></p>
            </div>
            
            <div class="case-details">
              <h3 style="margin-top: 0; color: #28a745;">📋 Case Details</h3>
              
              <div class="info-row">
                <div class="info-label">Case Reference:</div>
                <div class="info-value"><strong>${case_reference}</strong></div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Case Type:</div>
                <div class="info-value">${case_type || 'Not specified'}</div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Case Sub Type:</div>
                <div class="info-value">${case_sub_type || 'Not specified'}</div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Priority:</div>
                <div class="info-value">
                  <span class="priority-badge">${priority || 'Normal'}</span>
                </div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Description:</div>
                <div class="info-value">${description || 'No description provided'}</div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Documents:</div>
                <div class="info-value">
                  <span class="badge">${document_count} document(s) uploaded</span>
                </div>
              </div>
              
              <div class="info-row">
                <div class="info-label">Submitted On:</div>
                <div class="info-value">${submitted_date}</div>
              </div>
            </div>
            
      
            
            <p><strong>⏱️ Please review this case at your earliest convenience.</strong></p>
            
            <p>Best regards,<br><strong>Case Management System</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated notification from your case management system.</p>
            <p>© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  });
},

  orderConfirmation: async (to, orderData) => {
    const { name, orderId, items, total, shippingAddress } = orderData;
    
    const itemsList = items.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">$${item.price.toFixed(2)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">$${(item.quantity * item.price).toFixed(2)}</td>
      </tr>
    `).join('');

    return sendEmail({
      to,
      subject: `Order Confirmation #${orderId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #28a745;">Thank you for your order, ${name}!</h2>
          <p>Order ID: <strong>${orderId}</strong></p>
          <p>Order Date: ${new Date().toLocaleDateString()}</p>
          
          <h3>Order Details:</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Item</th>
                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Qty</th>
                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Price</th>
                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsList}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid #ddd;"><strong>Subtotal:</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd;"><strong>$${total.toFixed(2)}</strong></td>
              </tr>
              <tr>
                <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid #ddd;"><strong>Shipping:</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd;">Free</td>
              </tr>
              <tr>
                <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid #ddd;"><strong>Total:</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd;"><strong style="color: #28a745;">$${total.toFixed(2)}</strong></td>
              </tr>
            </tfoot>
          </table>
          
          ${shippingAddress ? `
            <h3>Shipping Address:</h3>
            <p style="background-color: #f9f9f9; padding: 15px; border-radius: 5px;">
              ${shippingAddress.street}<br>
              ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.zip}<br>
              ${shippingAddress.country}
            </p>
          ` : ''}
          
          <p>We'll notify you when your order ships!</p>
          <hr style="border: 1px solid #eee;" />
          <p style="color: #666; font-size: 12px;">Need help? Contact us at <a href="mailto:${process.env.SUPPORT_EMAIL || 'support@example.com'}">${process.env.SUPPORT_EMAIL || 'support@example.com'}</a></p>
        </div>
      `
    });
  },

  passwordReset: async (to, name, resetLink) => {
    return sendEmail({
      to,
      subject: 'Reset Your Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 5px;">
            <h2 style="color: #dc3545;">Password Reset Request</h2>
          </div>
          <div style="padding: 20px;">
            <p>Hi <strong>${name}</strong>,</p>
            <p>We received a request to reset your password. Click the button below to proceed:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" 
                 style="background-color: #dc3545; color: white; padding: 12px 24px; 
                        text-decoration: none; border-radius: 5px; display: inline-block;">
                🔐 Reset Password
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">⏰ This link expires in 1 hour.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 20px;">
              <p style="margin: 0; font-size: 14px; color: #666;">
                <strong>⚠️ Didn't request this?</strong><br>
                If you didn't request a password reset, please ignore this email or contact support if you have concerns.
              </p>
            </div>
          </div>
          <div style="text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee;">
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      `
    });
  },

  notification: async (to, subject, message, type = 'info') => {
    const colors = {
      info: '#17a2b8',
      success: '#28a745',
      warning: '#ffc107',
      error: '#dc3545'
    };

    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };

    return sendEmail({
      to,
      subject: `${icons[type]} ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="border-left: 4px solid ${colors[type]}; padding: 20px; background-color: #f9f9f9; border-radius: 5px;">
            <div style="font-size: 24px; margin-bottom: 10px;">${icons[type]}</div>
            ${message}
          </div>
          <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
            <p>© ${new Date().getFullYear()} Your Company. All rights reserved.</p>
          </div>
        </div>
      `
    });
  }
};

module.exports = {
  sendEmail,
  sendTemplateEmail,
  emailTemplates,
  reconnect
};