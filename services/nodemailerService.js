const nodemailer = require('nodemailer');

// Create transporter
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false, // true for 465, false for 587
  auth: {
    user: process.env.BREVO_SMTP_USER, // Your Brevo login email
    pass: process.env.BREVO_API_KEY,   // Same API key works as password
  },
});

const sendEmail = async (to, subject, htmlContent, from = null) => {
  try {
    const mailOptions = {
      from: from || `"${process.env.BREVO_SENDER_NAME}" <${process.env.BREVO_SENDER_EMAIL}>`,
      to: to,
      subject: subject,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

module.exports = { sendEmail };