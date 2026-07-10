const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cristema.db');

console.log('=== VERIFICAR DADOS ===\n');

db.all("SELECT ip, grupo, energia, potencia, timestamp FROM dados_shelly LIMIT 20", (err, rows) => {
  if (err) {
    console.error('Erro:', err);
    return;
  }
  
  console.log('PRIMEIROS 20 REGISTOS:');
  console.log('IP\t\tGRUPO\tENERGIA\t\tPOTENCIA\tTIMESTAMP');
  console.log('='.repeat(100));
  
  rows.forEach(row => {
    console.log(`${row.ip}\t${row.grupo}\t${row.energia}\t${row.potencia}\t${row.timestamp}`);
  });
  
  console.log('\n=== AGREGADOS POR DIA ===\n');
  
  db.all(`
    SELECT 
      data_dia,
      grupo,
      COUNT(*) as medicoes,
      SUM(energia) as energia_total,
      AVG(potencia) as potencia_media,
      MAX(potencia) as potencia_max
    FROM dados_shelly
    GROUP BY data_dia, grupo
    ORDER BY data_dia DESC
  `, (err, rows) => {
    if (err) {
      console.error('Erro:', err);
      return;
    }
    
    console.log('DATA\t\tGRUPO\tMEDIÇÕES\tENERGIA_TOTAL\tPOT_MÉDIA\tPOT_MAX');
    console.log('='.repeat(100));
    
    rows.forEach(row => {
      console.log(`${row.data_dia}\t${row.grupo}\t${row.medicoes}\t${row.energia_total}\t${row.potencia_media}\t${row.potencia_max}`);
    });
    
    db.close();
  });
});