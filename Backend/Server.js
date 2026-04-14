require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Supabase ──────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key (not anon key) for admin ops
);

// ── Middleware ────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',   // ← بعد الرفع ضع رابط الـ frontend فقط
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// ── Helpers ───────────────────────────────────────────────────────────

/** توليد كود سري عشوائي 6 أحرف/أرقام */
function generateSecretCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون حروف مشابهة
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** التحقق من توكن الأدمن */
function authAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: 'غير مصرح' });
  const token = header.split(' ')[1];
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'توكن غير صالح' });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  STUDENT ROUTES
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /api/student/get-code
 * الطالب يدخل رقمه الجامعي + الوطني → يحصل على كوده السري
 */
app.post('/api/student/get-code', async (req, res) => {
  const { studentId, nationalId } = req.body;

  if (!studentId || !nationalId) {
    return res.status(400).json({ message: 'يرجى إدخال الرقم الجامعي والرقم الوطني' });
  }

  // البحث عن الطالب في DB
  const { data: student, error } = await supabase
    .from('students')
    .select('*')
    .eq('student_id', studentId.trim())
    .single();

  if (error || !student) {
    return res.status(404).json({ message: 'الرقم الجامعي غير مسجل في النظام. تواصل مع الإدارة.' });
  }

  // التحقق من الرقم الوطني
  const match = await bcrypt.compare(nationalId.trim(), student.national_id_hash);
  if (!match) {
    return res.status(401).json({ message: 'الرقم الوطني غير صحيح' });
  }

  // إذا كان للطالب كود بالفعل، أعده مباشرة
  if (student.secret_code) {
    return res.json({ code: student.secret_code, name: student.name });
  }

  // توليد كود جديد فريد
  let code, exists = true;
  while (exists) {
    code = generateSecretCode();
    const { data } = await supabase.from('students').select('id').eq('secret_code', code).single();
    exists = !!data;
  }

  // حفظ الكود
  await supabase.from('students').update({ secret_code: code }).eq('id', student.id);

  res.json({ code, name: student.name });
});

/**
 * GET /api/student/result/:code
 * الطالب يدخل كوده → يحصل على نتيجته
 */
app.get('/api/student/result/:code', async (req, res) => {
  const code = req.params.code.toUpperCase().trim();

  const { data: student, error } = await supabase
    .from('students')
    .select('*, results(*)')
    .eq('secret_code', code)
    .single();

  if (error || !student) {
    return res.status(404).json({ message: 'الكود غير صحيح' });
  }

  if (!student.results || student.results.length === 0) {
    return res.status(404).json({ message: 'لم يتم رفع النتائج بعد. يرجى المراجعة لاحقاً.' });
  }

  // ترتيب المواد
  const grades = student.results.map(r => ({
    subject: r.subject,
    score: r.score
  }));

  // حساب المعدل إذا لم يكن محفوظاً
  const overall = student.overall_score ??
    (grades.reduce((s, g) => s + parseFloat(g.score), 0) / grades.length).toFixed(1);

  res.json({
    name: student.name,
    studentId: student.student_id,
    grades,
    overall,
    status: parseFloat(overall) >= 50 ? 'pass' : 'fail'
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/login
 */
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (
    username !== process.env.ADMIN_USERNAME ||
    !(await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH))
  ) {
    return res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }

  const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

/**
 * GET /api/admin/stats
 */
app.get('/api/admin/stats', authAdmin, async (req, res) => {
  const { count: totalStudents } = await supabase.from('students').select('*', { count: 'exact', head: true });
  const { count: totalResults } = await supabase.from('results').select('*', { count: 'exact', head: true });

  // طلاب لديهم كود لكن لا نتيجة
  const { data: pending } = await supabase.from('students')
    .select('id')
    .not('secret_code', 'is', null)
    .is('overall_score', null);

  // آخر 10 طلاب
  const { data: recent } = await supabase.from('students')
    .select('student_id, name, secret_code, overall_score, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  res.json({
    totalStudents: totalStudents || 0,
    totalResults: totalResults || 0,
    pending: pending?.length || 0,
    recent: (recent || []).map(s => ({
      studentId: s.student_id,
      name: s.name,
      secretCode: s.secret_code || '—',
      hasResult: s.overall_score !== null,
      createdAt: s.created_at
    }))
  });
});

/**
 * GET /api/admin/students
 */
app.get('/api/admin/students', authAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .select('student_id, name, major, secret_code, overall_score, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ message: 'خطأ في الخادم' });

  res.json(data.map(s => ({
    studentId: s.student_id,
    name: s.name,
    major: s.major,
    secretCode: s.secret_code || '—',
    hasResult: s.overall_score !== null,
    createdAt: s.created_at
  })));
});

/**
 * POST /api/admin/students  ← إضافة طالب واحد
 */
app.post('/api/admin/students', authAdmin, async (req, res) => {
  const { studentId, nationalId, name, major, email, year } = req.body;

  if (!studentId || !nationalId || !name) {
    return res.status(400).json({ message: 'يرجى إدخال الرقم الجامعي والوطني والاسم' });
  }

  // تحقق من التكرار
  const { data: existing } = await supabase.from('students').select('id').eq('student_id', studentId).single();
  if (existing) return res.status(409).json({ message: 'الرقم الجامعي مسجل مسبقاً' });

  // تشفير الرقم الوطني
  const nationalIdHash = await bcrypt.hash(nationalId.trim(), 10);

  const { data, error } = await supabase.from('students').insert({
    student_id: studentId.trim(),
    national_id_hash: nationalIdHash,
    name: name.trim(),
    major: major || null,
    email: email || null,
    year: year || null,
    secret_code: null
  }).select().single();

  if (error) return res.status(500).json({ message: 'خطأ في الحفظ: ' + error.message });

  res.json({ success: true, studentId: data.student_id, secretCode: data.secret_code || 'لم يُولَّد بعد' });
});

/**
 * POST /api/admin/students/bulk ← رفع ملف Excel
 */
app.post('/api/admin/students/bulk', authAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'لم يتم رفع أي ملف' });

  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

  let imported = 0;
  for (const row of rows) {
    const studentId = String(row.studentId || row['الرقم الجامعي'] || '').trim();
    const nationalId = String(row.nationalId || row['الرقم الوطني'] || '').trim();
    const name = String(row.name || row['الاسم'] || '').trim();
    if (!studentId || !nationalId || !name) continue;

    const { data: existing } = await supabase.from('students').select('id').eq('student_id', studentId).single();
    if (existing) continue;

    const nationalIdHash = await bcrypt.hash(nationalId, 10);
    await supabase.from('students').insert({
      student_id: studentId,
      national_id_hash: nationalIdHash,
      name,
      major: row.major || row['التخصص'] || null,
      email: row.email || null,
    });
    imported++;
  }

  res.json({ imported });
});

/**
 * DELETE /api/admin/students/:id
 */
app.delete('/api/admin/students/:id', authAdmin, async (req, res) => {
  await supabase.from('results').delete().eq('student_id', req.params.id);
  await supabase.from('students').delete().eq('student_id', req.params.id);
  res.json({ success: true });
});

/**
 * POST /api/admin/results  ← نتيجة يدوية
 */
app.post('/api/admin/results', authAdmin, async (req, res) => {
  const { studentId, grades, overall } = req.body;

  const { data: student } = await supabase.from('students').select('id').eq('student_id', studentId).single();
  if (!student) return res.status(404).json({ message: 'الطالب غير موجود' });

  // حذف النتائج القديمة
  await supabase.from('results').delete().eq('student_id', studentId);

  // إدراج النتائج الجديدة
  const inserts = grades.map(g => ({ student_id: studentId, subject: g.subject, score: g.score }));
  await supabase.from('results').insert(inserts);

  // حساب المعدل
  const calcOverall = overall ?? (grades.reduce((s, g) => s + g.score, 0) / grades.length);
  await supabase.from('students').update({ overall_score: calcOverall }).eq('student_id', studentId);

  res.json({ success: true });
});

/**
 * POST /api/admin/results/bulk ← رفع Excel نتائج
 */
app.post('/api/admin/results/bulk', authAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'لم يتم رفع ملف' });

  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

  // تجميع المواد حسب الطالب
  const studentMap = {};
  for (const row of rows) {
    const studentId = String(row.studentId || row['الرقم الجامعي'] || '').trim();
    const subject = String(row.subject || row['المادة'] || '').trim();
    const score = parseFloat(row.score || row['الدرجة'] || 0);
    if (!studentId || !subject) continue;
    if (!studentMap[studentId]) studentMap[studentId] = [];
    studentMap[studentId].push({ subject, score });
  }

  let updated = 0;
  for (const [studentId, grades] of Object.entries(studentMap)) {
    const { data: student } = await supabase.from('students').select('id').eq('student_id', studentId).single();
    if (!student) continue;
    await supabase.from('results').delete().eq('student_id', studentId);
    await supabase.from('results').insert(grades.map(g => ({ student_id: studentId, subject: g.subject, score: g.score })));
    const overall = (grades.reduce((s, g) => s + g.score, 0) / grades.length).toFixed(1);
    await supabase.from('students').update({ overall_score: parseFloat(overall) }).eq('student_id', studentId);
    updated++;
  }

  res.json({ updated });
});

// ── Start ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

