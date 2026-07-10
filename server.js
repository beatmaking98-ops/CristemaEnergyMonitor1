const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== CONFIG =====
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// ===== DATABASE =====
const dbPath = path.join(__dirname, 'cristema.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('[DB] Erro ao conectar:', err);
  else {
    console.log('[DB] Conectado à base de dados SQLite');
    criarTabelas(); // Criar tabelas se não existirem
  }
});

// ===== CRIAR TABELAS =====
function criarTabelas() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS dados_shelly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        grupo TEXT NOT NULL,
        potencia REAL NOT NULL,
        energia REAL NOT NULL,
        timestamp TEXT NOT NULL,
        data_dia TEXT NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('[DB] Erro ao criar tabela dados_shelly:', err);
      } else {
        console.log('[DB] Tabela dados_shelly pronta');
      }
    });

    // Tabela para histórico por hora
    db.run(`
      CREATE TABLE IF NOT EXISTS dados_hora (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        grupo TEXT NOT NULL,
        consumo_kwh REAL NOT NULL,
        potencia_media_kw REAL NOT NULL,
        data_hora TEXT NOT NULL,
        data_dia TEXT NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('[DB] Erro ao criar tabela dados_hora:', err);
      } else {
        console.log('[DB] Tabela dados_hora pronta');
      }
    });

    // Criar índices para melhor performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_grupo ON dados_shelly(grupo)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ip ON dados_shelly(ip)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_data ON dados_shelly(data_dia)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_hora_grupo ON dados_hora(grupo)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_hora_data ON dados_hora(data_hora)`);
  });
}

// ===== CACHE DE ENERGIA INICIAL DO DIA =====
const energiaInicialCache = {};
const ultimaHoraAgregacao = {};

// ===== FUNÇÃO: OBTER ENERGIA INICIAL DO DIA =====
function obterEnergiaInicial(ip, energiaAtual) {
  const hoje = new Date().toISOString().split('T')[0];
  
  if (!energiaInicialCache[ip]) {
    energiaInicialCache[ip] = { data: hoje, energiaInicial: energiaAtual };
    console.log(`[CACHE] Primeira leitura de ${ip} hoje: ${energiaAtual.toFixed(0)} Wh`);
    return 0;
  }
  
  const cache = energiaInicialCache[ip];
  
  if (cache.data !== hoje) {
    console.log(`[CACHE] Novo dia para ${ip}! Resetando cache...`);
    cache.data = hoje;
    cache.energiaInicial = energiaAtual;
    return 0;
  }
  
  const consumo = Math.max(0, energiaAtual - cache.energiaInicial);
  return consumo;
}

// ===== FUNÇÃO: AGREGAR DADOS POR HORA =====
function agregarPorHora(ip, grupo, consumoDia, potencia) {
  const agora = new Date();
  const horaAtual = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), agora.getHours());
  const dataHora = horaAtual.toISOString();
  const dataDia = agora.toISOString().split('T')[0];
  
  if (!ultimaHoraAgregacao[ip]) {
    ultimaHoraAgregacao[ip] = { dataHora, consumoAnterior: 0, potencias: [] };
  }
  
  const cache = ultimaHoraAgregacao[ip];
  
  // Se mudou de hora, salvar agregação anterior
  if (cache.dataHora !== dataHora) {
    const consumoHora = Math.max(0, consumoDia - cache.consumoAnterior);
    const potenciaMedia = cache.potencias.length > 0 
      ? cache.potencias.reduce((a, b) => a + b) / cache.potencias.length 
      : 0;
    
    if (consumoHora > 0 || potenciaMedia > 0) {
      db.run(
        `INSERT INTO dados_hora (ip, grupo, consumo_kwh, potencia_media_kw, data_hora, data_dia)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ip, grupo, consumoHora / 1000, potenciaMedia / 1000, cache.dataHora, dataDia],
        (err) => {
          if (err) console.error(`[DB] Erro ao inserir hora ${ip}:`, err.message);
          else console.log(`[✓ HORA] ${ip}: ${(consumoHora/1000).toFixed(3)} kWh`);
        }
      );
    }
    
    // Resetar cache para nova hora
    cache.dataHora = dataHora;
    cache.consumoAnterior = consumoDia;
    cache.potencias = [potencia];
  } else {
    // Mesmo horário, guardar potência para média
    cache.potencias.push(potencia);
  }
}

// ===== INICIALIZAR =====
console.log('✅ Servidor Cristema rodando em http://localhost:3000');
console.log('📊 Dashboard: http://localhost:3000');
console.log('🔌 API: http://localhost:3000/api');
console.log('💾 Base de dados:', dbPath);
console.log('⚙️  Configuração:', configPath);
console.log('\n📡 Grupos de Shellys:\n');

for (const [grupoId, grupoConfig] of Object.entries(config.grupos)) {
  console.log(`   ${grupoConfig.nome} (${grupoId}):`);
  grupoConfig.ips.forEach(ip => console.log(`      - ${ip}`));
}

console.log('\n✅ Sistema de monitorização iniciado\n');

// ===== BUSCAR DADOS DO SHELLY 3EM =====
function buscarDadosShelly(ip) {
  return new Promise((resolve) => {
    const reqPotencia = http.get(`http://${ip}/rpc/EM.GetStatus?id=0`, { timeout: 5000 }, (res) => {
      let data = '';
      
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const potenciaTotal = json.total_act_power || 0;
          
          const reqEnergia = http.get(`http://${ip}/rpc/EMData.GetStatus?id=0`, { timeout: 5000 }, (resEnergia) => {
            let dataEnergia = '';
            
            resEnergia.on('data', chunk => dataEnergia += chunk);
            resEnergia.on('end', () => {
              try {
                const jsonEnergia = JSON.parse(dataEnergia);
                const energiaTotal = (jsonEnergia.a_total_act_energy || 0) +
                                   (jsonEnergia.b_total_act_energy || 0) +
                                   (jsonEnergia.c_total_act_energy || 0);
                
                const consumoDia = obterEnergiaInicial(ip, energiaTotal);
                
                resolve({
                  ip,
                  potencia: parseFloat(potenciaTotal) || 0,
                  energia: consumoDia,
                  energiaTotal: energiaTotal,
                  online: true
                });
              } catch (e) {
                console.error(`[SHELLY] Erro ao parsear energia de ${ip}:`, e.message);
                resolve({ ip, potencia: parseFloat(potenciaTotal) || 0, energia: 0, energiaTotal: 0, online: true });
              }
            });
          });

          reqEnergia.on('error', (err) => {
            console.error(`[SHELLY] Erro ao buscar energia de ${ip}:`, err.message);
            resolve({ ip, potencia: parseFloat(potenciaTotal) || 0, energia: 0, energiaTotal: 0, online: true });
          });

          reqEnergia.on('timeout', () => {
            reqEnergia.destroy();
            resolve({ ip, potencia: parseFloat(potenciaTotal) || 0, energia: 0, energiaTotal: 0, online: true });
          });
        } catch (e) {
          console.error(`[SHELLY] Erro ao parsear potência de ${ip}:`, e.message);
          resolve({ ip, potencia: 0, energia: 0, energiaTotal: 0, online: false });
        }
      });
    });

    reqPotencia.on('error', (err) => {
      console.error(`[SHELLY] Erro ao conectar ${ip}:`, err.message);
      resolve({ ip, potencia: 0, energia: 0, energiaTotal: 0, online: false });
    });

    reqPotencia.on('timeout', () => {
      reqPotencia.destroy();
      resolve({ ip, potencia: 0, energia: 0, energiaTotal: 0, online: false });
    });
  });
}

// ===== BUSCAR DADOS DE TODOS OS SHELLYS =====
async function buscarTodosDados() {
  try {
    for (const [grupoId, grupoConfig] of Object.entries(config.grupos)) {
      for (const ip of grupoConfig.ips) {
        const dados = await buscarDadosShelly(ip);
        
        if (dados.online) {
          const hoje = new Date().toISOString().split('T')[0];
          const agora = new Date().toISOString();
          
          db.run(
            `INSERT INTO dados_shelly (ip, grupo, potencia, energia, timestamp, data_dia)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [ip, grupoId, dados.potencia, dados.energia, agora, hoje],
            (err) => {
              if (err) {
                console.error(`[DB] Erro ao inserir dados de ${ip}:`, err.message);
              } else {
                console.log(`[✓] ${ip} (${grupoId}): ${dados.potencia.toFixed(0)}W | ${dados.energia.toFixed(0)}Wh hoje`);
              }
            }
          );
          
          // Agregar por hora
          agregarPorHora(ip, grupoId, dados.energia, dados.potencia);
        } else {
          console.warn(`[✗] ${ip} (${grupoId}) OFFLINE`);
        }
      }
    }
  } catch (erro) {
    console.error('[ERRO] Ao buscar dados:', erro.message);
  }
}

// ===== BUSCAR DADOS A CADA 10 SEGUNDOS =====
setInterval(buscarTodosDados, 10000);
buscarTodosDados();

// ===== API: LISTAR GRUPOS =====
app.get('/api/grupos', (req, res) => {
  const grupos = Object.entries(config.grupos).map(([id, config]) => ({
    id,
    nome: config.nome,
    cor: config.cor,
    ips: config.ips
  }));
  res.json(grupos);
});

// ===== API: STATUS DE UM GRUPO (últimos dados) =====
app.get('/api/status/:grupoId', (req, res) => {
  const { grupoId } = req.params;
  const grupoConfig = config.grupos[grupoId];

  if (!grupoConfig) {
    return res.status(404).json({ erro: 'Grupo não encontrado' });
  }

  const ips = grupoConfig.ips;
  const ipsPlaceholder = ips.map(() => '?').join(',');

  const query = `
    SELECT 
      ip,
      potencia,
      energia,
      timestamp
    FROM dados_shelly
    WHERE grupo = ? AND ip IN (${ipsPlaceholder})
    ORDER BY timestamp DESC
    LIMIT ?
  `;

  const params = [grupoId, ...ips, ips.length];

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('[DB] Erro ao buscar status:', err);
      return res.status(500).json({ erro: err.message });
    }

    let totalPotencia = 0;
    let totalEnergia = 0;
    let online = 0;
    const shellys = [];
    const vistosIPs = new Set();

    rows.forEach(row => {
      if (!vistosIPs.has(row.ip)) {
        vistosIPs.add(row.ip);
        totalPotencia += row.potencia || 0;
        totalEnergia += row.energia || 0;
        online++;

        shellys.push({
          ip: row.ip,
          online: true,
          potencia: (row.potencia / 1000).toFixed(3),
          energia: (row.energia / 1000).toFixed(3)
        });
      }
    });

    ips.forEach(ip => {
      if (!vistosIPs.has(ip)) {
        shellys.push({
          ip,
          online: false,
          potencia: '0.000',
          energia: '0.000'
        });
      }
    });

    const hora = new Date().toLocaleTimeString('pt-PT');
    const totalKW = (totalPotencia / 1000).toFixed(3);
    const totalKwh = (totalEnergia / 1000).toFixed(3);

    res.json({
      grupo: grupoId,
      nomeGrupo: grupoConfig.nome,
      totalKW: totalKW,
      energiaHoje: totalKwh,
      energiaTotal: totalKwh,
      online,
      dispositivos: grupoConfig.ips.length,
      hora,
      shellys
    });
  });
});

// ===== API: HISTÓRICO DIÁRIO =====
app.get('/api/historico/:grupoId', (req, res) => {
  const { grupoId } = req.params;
  const dias = parseInt(req.query.dias) || 7;
  const grupoConfig = config.grupos[grupoId];

  if (!grupoConfig) {
    return res.status(404).json({ erro: 'Grupo não encontrado' });
  }

  const ips = grupoConfig.ips;
  const ipsPlaceholder = ips.map(() => '?').join(',');

  const query = `
    SELECT 
      data_dia as dia,
      MAX(energia) as energiaConsumida,
      ROUND(AVG(potencia) / 1000.0, 3) as potenciaMedia,
      ROUND(MAX(potencia) / 1000.0, 3) as potenciaMaxima,
      COUNT(*) as medicoes
    FROM dados_shelly
    WHERE grupo = ? AND ip IN (${ipsPlaceholder})
      AND data_dia >= date('now', '-${dias} days')
    GROUP BY data_dia
    ORDER BY dia ASC
  `;

  const params = [grupoId, ...ips];

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('[DB] Erro ao buscar histórico:', err);
      return res.status(500).json({ erro: err.message });
    }

    if (rows.length === 0) {
      return res.json([]);
    }

    const historico = rows.map(row => ({
      dia: row.dia,
      energiaConsumida: (row.energiaConsumida / 1000).toFixed(3),
      potenciaMedia: row.potenciaMedia.toString(),
      potenciaMaxima: row.potenciaMaxima.toString(),
      medicoes: row.medicoes
    }));

    res.json(historico);
  });
});

// ===== API: HISTÓRICO HORÁRIO =====
app.get('/api/historico-hora/:grupoId', (req, res) => {
  const { grupoId } = req.params;
  const horas = parseInt(req.query.horas) || 24;
  const grupoConfig = config.grupos[grupoId];

  if (!grupoConfig) {
    return res.status(404).json({ erro: 'Grupo não encontrado' });
  }

  const ips = grupoConfig.ips;
  const ipsPlaceholder = ips.map(() => '?').join(',');

  const query = `
    SELECT 
      data_hora as hora,
      SUM(consumo_kwh) as consumoKwh,
      ROUND(AVG(potencia_media_kw), 3) as potenciaMedia
    FROM dados_hora
    WHERE grupo = ? AND ip IN (${ipsPlaceholder})
      AND data_hora >= datetime('now', '-${horas} hours')
    GROUP BY data_hora
    ORDER BY hora ASC
  `;

  const params = [grupoId, ...ips];

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('[DB] Erro ao buscar histórico hora:', err);
      return res.status(500).json({ erro: err.message });
    }

    if (rows.length === 0) {
      return res.json([]);
    }

    const historico = rows.map(row => ({
      hora: row.hora,
      consumoKwh: parseFloat(row.consumoKwh).toFixed(3),
      potenciaMedia: row.potenciaMedia
    }));

    res.json(historico);
  });
});

// ===== INICIAR SERVIDOR =====
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`\n[SERVIDOR] Cristema iniciado em http://localhost:${PORT}\n`);
});
