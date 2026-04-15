const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// هذا يسمح للـ Frontend بالتواصل مع الـ Backend
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.use(express.json());

// مسار تجريبي لاختبار أن الخادم يعمل
app.get('/', (req, res) => {
    res.json({ 
        message: 'الخادم يعمل بنجاح على Railway!',
        status: 'online',
        time: new Date().toISOString()
    });
});

// مسار API مثال للمستخدمين
app.get('/api/users', (req, res) => {
    res.json({
        users: ['أحمد', 'سارة', 'محمد', 'فاطمة']
    });
});

// تشغيل الخادم
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ الخادم يعمل على المنفذ: ${PORT}`);
    console.log(`🌐 الرابط: http://localhost:${PORT}`);
});