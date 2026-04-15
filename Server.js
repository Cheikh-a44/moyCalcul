const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// تفعيل CORS للسماح للـ Frontend بالتواصل
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173'
}));

app.use(express.json());

// مثال على API بسيط
app.get('/api/users', (req, res) => {
    res.json({ users: ['Ahmed', 'Sara', 'Mohamed'] });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    res.json({ message: 'تم تسجيل الدخول بنجاح', email });
});

app.listen(PORT, () => {
    console.log(`Backend يعمل على المنفذ ${PORT}`);
});
