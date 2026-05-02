const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

let db;
let dbReady = false;
const dbPath = path.join('/tmp', 'taskmanager.json');

// Simple JSON-based storage as fallback
const store = {
  users: [],
  projects: [],
  project_members: [],
  tasks: [],
  _id: { users: 1, projects: 1, members: 1, tasks: 1 }
};

if (fs.existsSync(dbPath)) {
  try {
    const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    Object.assign(store, data);
  } catch(e) {}
}

function save() {
  fs.writeFileSync(dbPath, JSON.stringify(store), 'utf8');
}

module.exports = { store, save };