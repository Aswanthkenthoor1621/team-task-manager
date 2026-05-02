const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const SECRET = 'taskmanager_secret_key_2024';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Auth Middleware
function auth(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── AUTH ROUTES ──────────────────────────────────────────
app.post('/api/signup', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields required' });
  const hashed = bcrypt.hashSync(password, 10);
  try {
    const stmt = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)');
    const result = stmt.run(name, email, hashed, role || 'member');
    const token = jwt.sign({ id: result.lastInsertRowid, name, email, role: role || 'member' }, SECRET);
    res.json({ token, user: { id: result.lastInsertRowid, name, email, role: role || 'member' } });
  } catch (e) {
    res.status(400).json({ error: 'Email already exists' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, SECRET);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// ── PROJECT ROUTES ───────────────────────────────────────
app.get('/api/projects', auth, (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, u.name as creator_name FROM projects p
    JOIN users u ON p.created_by = u.id
    WHERE p.created_by = ? OR p.id IN (
      SELECT project_id FROM project_members WHERE user_id = ?
    )
  `).all(req.user.id, req.user.id);
  res.json(projects);
});

app.post('/api/projects', auth, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  const result = db.prepare('INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)')
    .run(name, description, req.user.id);
  db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
    .run(result.lastInsertRowid, req.user.id, 'admin');
  res.json({ id: result.lastInsertRowid, name, description });
});

app.delete('/api/projects/:id', auth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.created_by !== req.user.id)
    return res.status(403).json({ error: 'Only creator can delete' });
  db.prepare('DELETE FROM tasks WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM project_members WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── TASK ROUTES ──────────────────────────────────────────
app.get('/api/projects/:id/tasks', auth, (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, u.name as assigned_name FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.project_id = ?
  `).all(req.params.id);
  res.json(tasks);
});

app.post('/api/projects/:id/tasks', auth, (req, res) => {
  const { title, description, priority, due_date, assigned_to } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const result = db.prepare(`
    INSERT INTO tasks (title, description, priority, due_date, assigned_to, project_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, description, priority || 'medium', due_date, assigned_to || null, req.params.id, req.user.id);
  res.json({ id: result.lastInsertRowid, title });
});

app.patch('/api/tasks/:id', auth, (req, res) => {
  const { status, title, description, priority, due_date } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE tasks SET
      status = COALESCE(?, status),
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      priority = COALESCE(?, priority),
      due_date = COALESCE(?, due_date)
    WHERE id = ?
  `).run(status, title, description, priority, due_date, req.params.id);
  res.json({ success: true });
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── USERS ROUTE ──────────────────────────────────────────
app.get('/api/users', auth, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role FROM users').all();
  res.json(users);
});

// ── DASHBOARD STATS ──────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ?').get(req.user.id);
  const done = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status = 'done'").get(req.user.id);
  const overdue = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND due_date < date('now') AND status != 'done'").get(req.user.id);
  res.json({ total: total.count, done: done.count, overdue: overdue.count });
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));