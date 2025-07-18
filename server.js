const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');

// ⛔ Node.js 14/16 da fetch yo‘q — dynamic import ishlatiladi
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // ✅ Frontenddan so‘rovga ruxsat
app.use(bodyParser.json());

// ✅ SQLite bazaga ulanish
const db = new sqlite3.Database(path.join(__dirname, 'otp-auth.db'), (err) => {
  if (err) return console.error('❌ SQLite xatosi:', err.message);
  console.log('✅ SQLite bazaga ulandi');
});

// ✅ OTP jadvalini yaratish
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

// ✅ Telegram orqali OTP yuborish funksiyasi
const sendOtpToTelegram = async (otp, phone) => {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  const message = `📱 Yangi OTP kodi: ${otp}\n👤 Telefon: ${phone}`;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('❌ Telegramga yuborishda xatolik:', data.description);
    } else {
      console.log('✅ OTP Telegramga yuborildi');
    }
  } catch (err) {
    console.error('❌ Telegram so‘rovida xatolik:', err.message);
  }
};

// ✅ OTP yuborish endpoint
app.post('/api/send-otp', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ message: 'Telefon raqam kerak' });

  const otp = Math.floor(1000 + Math.random() * 9000).toString();

  db.run(`INSERT INTO otps (phone, otp) VALUES (?, ?)`, [phone, otp], async function (err) {
    if (err) return res.status(500).json({ message: 'Bazaga yozishda xatolik' });

    console.log(`📲 OTP ${otp} yuborildi: ${phone}`);
    await sendOtpToTelegram(otp, phone); // Telegramga yuborish

    return res.status(200).json({ message: 'OTP yuborildi' });
  });
});

// ✅ OTP tasdiqlash endpoint
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

      return res.status(200).json({ message: 'Muvaffaqiyatli', token });
    }
  );
});

// ✅ Serverni ishga tushirish
app.listen(PORT, () => {
  console.log(`🚀 Server ishga tushdi: http://localhost:${PORT}`);
});
