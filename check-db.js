const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cristema.db');

db.all("SELECT * FROM sqlite_master WHERE type='table'", (err, tables) => {
  if (err) {
    console.error('Erro:', err);
    return;
  }
  console.log('=== TABELAS ===');
  tables.forEach(t => console.log(t.name));
});

db.all("PRAGMA table_info(dados_shelly)", (err, columns) => {
  if (err) {
    console.error('Erro:', err);
    return;
  }
  console.log('\n=== COLUNAS ===');
  columns.forEach(col => console.log(`${col.name} (${col.type})`));
  
  db.get("SELECT * FROM dados_shelly LIMIT 1", (err, row) => {
    if (err) {
      console.error('Erro:', err);
    } else {
      console.log('\n=== PRIMEIRO REGISTO ===');
      console.log(row);
    }
    db.close();
  });
});