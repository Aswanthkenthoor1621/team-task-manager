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

app.post('/api/signup', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields required' });
  const hashed = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
    [name, email, hashed, role || 'member'],
    function(err) {
      if (err) return res.status(400).json({ error: 'Email already exists' });
      const token = jwt.sign({ id: this.lastID, name, email, role: role || 'member' }, SECRET);
      res.json({ token, user: { id: this.lastID, name, email, role: role || 'member' } });
    });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, SECRET);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });
});

app.get('/api/projects', auth, (req, res) => {
  db.all(`SELECT p.*, u.name as creator_name FROM projects p
    JOIN users u ON p.created_by = u.id
    WHERE p.created_by = ? OR p.id IN (
      SELECT project_id FROM project_members WHERE user_id = ?
    )`, [req.user.id, req.user.id], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/projects', auth, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  db.run('INSERT INTO projects (name, description, created_by) VALUES (?, ?, ?)',
    [name, description, req.user.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      db.run('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)',
        [this.lastID, req.user.id, 'admin']);
      res.json({ id: this.lastID, name, description });
    });
});

app.delete('/api/projects/:id', auth, (req, res) => {
  db.get('SELECT * FROM projects WHERE id = ?', [req.params.id], (err, project) => {
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (project.created_by !== req.user.id)
      return res.status(403).json({ error: 'Only creator can delete' });
    db.run('DELETE FROM tasks WHERE project_id = ?', [req.params.id]);
    db.run('DELETE FROM project_members WHERE project_id = ?', [req.params.id]);
    db.run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });
});

app.get('/api/projects/:id/tasks', auth, (req, res) => {
  db.all(`SELECT t.*, u.name as assigned_name FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.project_id = ?`, [req.params.id], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/projects/:id/tasks', auth, (req, res) => {
  const { title, description, priority, due_date, assigned_to } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  db.run(`INSERT INTO tasks (title, description, priority, due_date, assigned_to, project_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [title, description, priority || 'medium', due_date, assigned_to || null, req.params.id, req.user.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, title });
    });
});

app.patch('/api/tasks/:id', auth, (req, res) => {
  const { status, title, description, priority, due_date } = req.body;
  db.run(`UPDATE tasks SET
    status = COALESCE(?, status),
    title = COALESCE(?, title),
    description = COALESCE(?, description),
    priority = COALESCE(?, priority),
    due_date = COALESCE(?, due_date)
    WHERE id = ?`,
    [status, title, description, priority, due_date, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  db.run('DELETE FROM tasks WHERE id = ?', [req.params.id], (err) => {
    res.json({ success: true });
  });
});

app.get('/api/users', auth, (req, res) => {
  db.all('SELECT id, name, email, role FROM users', [], (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/stats', auth, (req, res) => {
  db.get('SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ?', [req.user.id], (err, total) => {
    db.get("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status = 'done'", [req.user.id], (err, done) => {
      db.get("SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND due_date < date('now') AND status != 'done'", [req.user.id], (err, overdue) => {
        res.json({ total: total.count, done: done.count, overdue: overdue.count });
      });
    });
  });
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));