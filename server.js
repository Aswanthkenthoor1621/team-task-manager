const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const { store, save } = require('./database');

const app = express();
const SECRET = 'taskmanager_secret_key_2024';
const PORT = process.env.PORT || 3000;

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

// SIGNUP
app.post('/api/signup', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields required' });
  if (store.users.find(u => u.email === email))
    return res.status(400).json({ error: 'Email already exists' });
  const hashed = bcrypt.hashSync(password, 10);
  const id = store._id.users++;
  const user = { id, name, email, password: hashed, role: role || 'member' };
  store.users.push(user);
  save();
  const token = jwt.sign({ id, name, email, role: role || 'member' }, SECRET);
  res.json({ token, user: { id, name, email, role: role || 'member' } });
});

// LOGIN
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = store.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, SECRET);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// GET PROJECTS
app.get('/api/projects', auth, (req, res) => {
  const myProjects = store.projects.filter(p =>
    p.created_by === req.user.id ||
    store.project_members.find(m => m.project_id === p.id && m.user_id === req.user.id)
  );
  const result = myProjects.map(p => ({
    ...p,
    creator_name: store.users.find(u => u.id === p.created_by)?.name || ''
  }));
  res.json(result);
});

// CREATE PROJECT
app.post('/api/projects', auth, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  const id = store._id.projects++;
  const project = { id, name, description, created_by: req.user.id };
  store.projects.push(project);
  store.project_members.push({ id: store._id.members++, project_id: id, user_id: req.user.id, role: 'admin' });
  save();
  res.json(project);
});

// DELETE PROJECT
app.delete('/api/projects/:id', auth, (req, res) => {
  const id = parseInt(req.params.id);
  const project = store.projects.find(p => p.id === id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.created_by !== req.user.id)
    return res.status(403).json({ error: 'Only creator can delete' });
  store.projects = store.projects.filter(p => p.id !== id);
  store.tasks = store.tasks.filter(t => t.project_id !== id);
  store.project_members = store.project_members.filter(m => m.project_id !== id);
  save();
  res.json({ success: true });
});

// GET TASKS
app.get('/api/projects/:id/tasks', auth, (req, res) => {
  const project_id = parseInt(req.params.id);
  const tasks = store.tasks.filter(t => t.project_id === project_id).map(t => ({
    ...t,
    assigned_name: store.users.find(u => u.id === t.assigned_to)?.name || null
  }));
  res.json(tasks);
});

// CREATE TASK
app.post('/api/projects/:id/tasks', auth, (req, res) => {
  const { title, description, priority, due_date, assigned_to } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const id = store._id.tasks++;
  const task = {
    id, title, description,
    status: 'todo',
    priority: priority || 'medium',
    due_date: due_date || null,
    assigned_to: assigned_to ? parseInt(assigned_to) : null,
    project_id: parseInt(req.params.id),
    created_by: req.user.id
  };
  store.tasks.push(task);
  save();
  res.json(task);
});

// UPDATE TASK
app.patch('/api/tasks/:id', auth, (req, res) => {
  const id = parseInt(req.params.id);
  const task = store.tasks.find(t => t.id === id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const { status, title, description, priority, due_date } = req.body;
  if (status) task.status = status;
  if (title) task.title = title;
  if (description) task.description = description;
  if (priority) task.priority = priority;
  if (due_date) task.due_date = due_date;
  save();
  res.json({ success: true });
});

// DELETE TASK
app.delete('/api/tasks/:id', auth, (req, res) => {
  const id = parseInt(req.params.id);
  store.tasks = store.tasks.filter(t => t.id !== id);
  save();
  res.json({ success: true });
});

// GET USERS
app.get('/api/users', auth, (req, res) => {
  res.json(store.users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })));
});

// STATS
app.get('/api/stats', auth, (req, res) => {
  const myTasks = store.tasks.filter(t => t.assigned_to === req.user.id);
  const today = new Date().toISOString().split('T')[0];
  res.json({
    total: myTasks.length,
    done: myTasks.filter(t => t.status === 'done').length,
    overdue: myTasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length
  });
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));