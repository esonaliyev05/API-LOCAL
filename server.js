const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');

// Node 14/16 da fetch dynamic import orqali
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// SQLite ulanish
const db = new sqlite3.Database(path.join(__dirname, 'otp-auth.db'), (err) => {
  if (err) return console.error('❌ SQLite xatosi:', err.message);
  console.log('✅ SQLite bazaga ulandi');
});

// Jadval yaratish
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      otp TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Telegram OTP yuborish
const sendOtpToTelegram = async (otp, phone) => {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  const message = `📱 Yangi OTP kodi: ${otp}\n👤 Telefon: ${phone}`;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('❌ Telegram xatosi:', data.description);
    } else {
      console.log('✅ OTP Telegramga yuborildi');
    }
  } catch (err) {
    console.error('❌ Telegram fetch xatolik:', err.message);
  }
};

// Email yuborish
const sendEmailConfirmation = async (email, phone, token) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const confirmUrl = `${process.env.BASE_URL}/api/confirm-email?token=${token}`;

  const mailOptions = {
    from: `"MyCloud Auth" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '📩 Telefon raqamingizni tasdiqlang',
    html: `
      <h3>Salom!</h3>
      <p>Quyidagi havola orqali telefon raqamingizni tasdiqlang:</p>
      <a href="${confirmUrl}">MY CLOUD UCHUN KIRISH token</a>
      <br/>
      <small>Agar bu siz bo'lmasangiz, bu xabarni e'tiborsiz qoldiring.</small>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('✅ Tasdiqlash email yuborildi:', email);
  } catch (error) {
    console.error('❌ Email yuborishda xatolik:', error.message);
  }
};

// OTP yuborish (phone + email)
app.post('/api/send-otp', (req, res) => {
  const { phone, email } = req.body;
  if (!phone || !email) return res.status(400).json({ message: 'Telefon va email kerak' });

  const otp = Math.floor(1000 + Math.random() * 9000).toString();

  db.run(`INSERT INTO otps (phone, otp) VALUES (?, ?)`, [phone, otp], async function (err) {
    if (err) return res.status(500).json({ message: 'Bazaga yozishda xatolik' });

    console.log(`📲 OTP ${otp} yuborildi: ${phone}`);
    await sendOtpToTelegram(otp, phone);

    const token = jwt.sign({ phone, email }, process.env.JWT_SECRET, {
      expiresIn: process.env.TOKEN_EXPIRES_IN || '1d',
    });

    await sendEmailConfirmation(email, phone, token);

    return res.status(200).json({ message: 'OTP yuborildi va emailga tasdiqlash havolasi jo‘natildi' });
  });
});

// OTP tekshirish
app.post('/api/verify-otp', (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    return res.status(400).json({ message: 'Telefon va OTP kerak' });
  }

  db.get(
    `SELECT * FROM otps WHERE phone = ? ORDER BY created_at DESC LIMIT 1`,
    [phone],
    (err, row) => {
      if (err) return res.status(500).json({ message: 'Bazadan o‘qishda xatolik' });

      if (!row || row.otp !== otp) {
        return res.status(401).json({ message: 'OTP noto‘g‘ri yoki muddati o‘tgan' });
      }

      const token = jwt.sign({ phone }, process.env.JWT_SECRET, {
        expiresIn: process.env.TOKEN_EXPIRES_IN || '1d',
      });

      db.run(`DELETE FROM otps WHERE phone = ?`, [phone]);

      return res.status(200).json({ message: 'Tasdiqlandi', token });
    }
  );
});

// Email orqali tasdiqlash
app.get('/api/confirm-email', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Token yo‘q');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.send(`
      <h2>✅ Tasdiqlash muvaffaqiyatli</h2>
      <p>Telefon raqam: ${decoded.phone}</p>
      <p>Email: ${decoded.email}</p>
    `);
  } catch (err) {
    res.status(401).send('❌ Token noto‘g‘ri yoki muddati tugagan');
  }
});

// Serverni ishga tushirish
app.listen(PORT, () => {
  console.log(`🚀 Server ishga tushdi: http://localhost:${PORT}`);
});
