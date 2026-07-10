const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'cristema.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[DB] Erro ao conectar:', err);
    process.exit(1);
  }
  console.log('[DB] Conectado à base de dados');
});

// Criar tabela dados_shelly
db.run(`
  CREATE TABLE IF NOT EXISTS dados_shelly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    grupo TEXT NOT NULL,
    potencia REAL DEFAULT 0,
    energia REAL DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_dia DATE DEFAULT CURRENT_DATE
  )
`, (err) => {
  if (err) {
    console.error('[DB] Erro ao criar tabela:', err);
  } else {
    console.log('✅ Tabela dados_shelly criada com sucesso!');
  }
  
  db.close();
  process.exit(0);
});