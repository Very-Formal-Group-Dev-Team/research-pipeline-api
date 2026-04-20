const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendVerificationEmail(to, token) {
  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';
  const verifyUrl = `${webOrigin}/auth/verify?token=${encodeURIComponent(token)}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f9f9f6">
  <div style="max-width:480px;margin:40px auto;background:#fff;border:1px solid #e5e5e0;border-radius:8px;overflow:hidden">
    <div style="background:#b22234;padding:24px 32px">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600">Student Research Portal</h1>
    </div>
    <div style="padding:32px">
      <p style="margin:0 0 16px;color:#1e293b;font-size:15px;line-height:1.6">
        Verify your email address to complete your registration.
      </p>
      <a href="${verifyUrl}" style="display:inline-block;background:#b22234;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:600">
        Verify Email
      </a>
      <p style="margin:24px 0 0;color:#64748b;font-size:13px;line-height:1.5">
        Or copy this link:<br>
        <span style="color:#b22234;word-break:break-all">${verifyUrl}</span>
      </p>
      <p style="margin:20px 0 0;color:#94a3b8;font-size:12px">
        This link expires in 24 hours. If you did not create an account, ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`.trim();

  const text = `Verify your email for Student Research Portal\n\nClick the link below to verify your email:\n${verifyUrl}\n\nThis link expires in 24 hours.`;

  await transporter.sendMail({
    from: `"Student Research" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Verify your email — Student Research Portal',
    text,
    html,
  });
}

module.exports = { sendVerificationEmail };
