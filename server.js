const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// ================= CONFIG =================

const configPath = path.join(__dirname, 'config.json');

const config = JSON.parse(
  fs.readFileSync(configPath, 'utf8')
);


// ================= POSTGRESQL =================

const pool = new Pool({

  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false
  }

});



pool.connect()

.then(client => {

  console.log('[DB] PostgreSQL conectado');

  client.release();

  criarTabelas();

})

.catch(err => {

  console.error(
    '[DB] Erro ligação:',
    err.message
  );

});



// ================= CRIAR TABELAS =================

async function criarTabelas() {


try {


await pool.query(`

CREATE TABLE IF NOT EXISTS dados_shelly (

id SERIAL PRIMARY KEY,

ip TEXT NOT NULL,

grupo TEXT NOT NULL,

potencia REAL NOT NULL,

energia REAL NOT NULL,

timestamp TEXT NOT NULL,

data_dia TEXT NOT NULL

)

`);



await pool.query(`

CREATE TABLE IF NOT EXISTS dados_hora (

id SERIAL PRIMARY KEY,

ip TEXT NOT NULL,

grupo TEXT NOT NULL,

consumo_kwh REAL NOT NULL,

potencia_media_kw REAL NOT NULL,

data_hora TEXT NOT NULL,

data_dia TEXT NOT NULL

)

`);




await pool.query(`

CREATE INDEX IF NOT EXISTS idx_dados_grupo

ON dados_shelly(grupo)

`);




await pool.query(`

CREATE INDEX IF NOT EXISTS idx_dados_ip

ON dados_shelly(ip)

`);




console.log('[DB] Tabelas prontas');



}

catch(err){


console.error(

'[DB] Erro tabelas:',

err.message

);


}


}


// ================= RECEBER SHELLY =================

app.post('/api/shelly', async (req,res)=>{


try {


const {

ip,

grupo,

potencia,

energia

} = req.body;



const agora = new Date().toISOString();

const hoje = agora.split('T')[0];



await pool.query(`

INSERT INTO dados_shelly

(

ip,

grupo,

potencia,

energia,

timestamp,

data_dia

)

VALUES

($1,$2,$3,$4,$5,$6)

`,

[

ip,

grupo,

potencia,

energia,

agora,

hoje

]

);



console.log(

`[SHELLY RECEBIDO] ${ip} ${potencia}W`

);



res.json({

ok:true

});



}

catch(err){


console.error(

'[API SHELLY]',

err.message

);



res.status(500).json({

erro:err.message

});


}


});


// ================= API GRUPOS =================

app.get('/api/grupos', (req,res)=>{


const grupos =

Object.entries(config.grupos)

.map(([id,g])=>({


id,

nome:g.nome,

cor:g.cor,

ips:g.ips


}));


res.json(grupos);


});





// ================= API STATUS =================

app.get('/api/status/:grupoId', async(req,res)=>{


try{


const grupoId = req.params.grupoId;



const resultado = await pool.query(`

SELECT DISTINCT ON (ip)

ip,

potencia,

energia,

timestamp


FROM dados_shelly


WHERE grupo=$1


ORDER BY ip,timestamp DESC


`,[grupoId]);





let totalPotencia = 0;

let totalEnergia = 0;



const shellys = resultado.rows.map(row=>{


totalPotencia += Number(row.potencia);

totalEnergia += Number(row.energia);



return {


ip: row.ip,


online:true,


potencia:

(Number(row.potencia)/1000).toFixed(3),



energia:

(Number(row.energia)/1000).toFixed(3)


};


});





res.json({


grupo:grupoId,


totalKW:

(totalPotencia/1000).toFixed(3),



energiaHoje:

(totalEnergia/1000).toFixed(3),



energiaTotal:

(totalEnergia/1000).toFixed(3),



online:shellys.length,



dispositivos:shellys.length,



hora:new Date().toLocaleTimeString('pt-PT'),



shellys


});



}

catch(err){


console.error(

'[STATUS]',

err.message

);



res.status(500).json({

erro:err.message

});


}


});





// ================= HISTÓRICO DIÁRIO =================


app.get('/api/historico/:grupoId', async(req,res)=>{


try{


const dias =

parseInt(req.query.dias) || 7;



const resultado = await pool.query(`


SELECT


data_dia AS dia,


MAX(energia) AS energiaConsumida,


ROUND(AVG(potencia)/1000,3) AS potenciaMedia,


ROUND(MAX(potencia)/1000,3) AS potenciaMaxima,


COUNT(*) AS medicoes



FROM dados_shelly



WHERE grupo=$1



AND data_dia >= CURRENT_DATE - $2



GROUP BY data_dia



ORDER BY dia ASC



`,

[

req.params.grupoId,

dias

]

);



res.json(resultado.rows);



}


catch(err){


console.error(

'[HISTORICO]',

err.message

);



res.status(500).json({

erro:err.message

});


}


});


// ================= SERVIDOR =================


const PORT = process.env.PORT || 3000;


app.listen(PORT, ()=>{


console.log(
`[SERVIDOR] Cristema iniciado na porta ${PORT}`
);


console.log(
`[DASHBOARD] https://cristemaenergymonitor1.onrender.com`
);


});