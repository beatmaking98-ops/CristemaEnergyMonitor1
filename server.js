const express = require('express');
const { Pool } = require('pg');
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


// ===== DATABASE POSTGRESQL =====

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
    console.error('[DB] Erro PostgreSQL:', err.message);
  });


// ===== CRIAR TABELAS =====

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
      CREATE INDEX IF NOT EXISTS idx_grupo 
      ON dados_shelly(grupo)
    `);


    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ip 
      ON dados_shelly(ip)
    `);


    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_data 
      ON dados_shelly(data_dia)
    `);


    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hora_grupo 
      ON dados_hora(grupo)
    `);


    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hora_data 
      ON dados_hora(data_hora)
    `);


    console.log('[DB] Tabelas PostgreSQL prontas');


  } catch (err) {

    console.error(
      '[DB] Erro ao criar tabelas:',
      err.message
    );

  }

}


// ===== CACHE DE ENERGIA =====

const energiaInicialCache = {};
const ultimaHoraAgregacao = {};


// ===== OBTER ENERGIA INICIAL DO DIA =====

function obterEnergiaInicial(ip, energiaAtual) {

  const hoje = new Date()
    .toISOString()
    .split('T')[0];


  if (!energiaInicialCache[ip]) {

    energiaInicialCache[ip] = {
      data: hoje,
      energiaInicial: energiaAtual
    };

    console.log(
      `[CACHE] Primeira leitura ${ip}: ${energiaAtual.toFixed(0)} Wh`
    );

    return 0;
  }


  const cache = energiaInicialCache[ip];


  if (cache.data !== hoje) {

    cache.data = hoje;
    cache.energiaInicial = energiaAtual;

    return 0;
  }


  return Math.max(
    0,
    energiaAtual - cache.energiaInicial
  );

}
// ===== AGREGAR DADOS POR HORA =====

function agregarPorHora(ip, grupo, consumoDia, potencia) {

  const agora = new Date();

  const horaAtual = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate(),
    agora.getHours()
  );

  const dataHora = horaAtual.toISOString();
  const dataDia = agora.toISOString().split('T')[0];


  if (!ultimaHoraAgregacao[ip]) {

    ultimaHoraAgregacao[ip] = {
      dataHora,
      consumoAnterior: consumoDia,
      potencias: []
    };

  }


  const cache = ultimaHoraAgregacao[ip];


  if (cache.dataHora !== dataHora) {


    const consumoHora = Math.max(
      0,
      consumoDia - cache.consumoAnterior
    );


    const potenciaMedia =
      cache.potencias.length > 0
        ? cache.potencias.reduce((a,b)=>a+b,0) / cache.potencias.length
        : 0;



    if (consumoHora > 0 || potenciaMedia > 0) {


      pool.query(
        `
        INSERT INTO dados_hora
        (
          ip,
          grupo,
          consumo_kwh,
          potencia_media_kw,
          data_hora,
          data_dia
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          ip,
          grupo,
          consumoHora / 1000,
          potenciaMedia / 1000,
          cache.dataHora,
          dataDia
        ]

      )
      .then(()=>{

        console.log(
          `[✓ HORA] ${ip}: ${(consumoHora/1000).toFixed(3)} kWh`
        );

      })
      .catch(err=>{

        console.error(
          '[DB] Erro hora:',
          err.message
        );

      });


    }


    cache.dataHora = dataHora;
    cache.consumoAnterior = consumoDia;
    cache.potencias = [potencia];


  } else {


    cache.potencias.push(potencia);


  }

}



// ===== BUSCAR DADOS SHELLY =====


//function buscarDadosShelly(ip) {


  return new Promise((resolve)=>{


    const reqPotencia = http.get(
      `http://${ip}/rpc/EM.GetStatus?id=0`,
      {timeout:5000},
      (res)=>{


        let data='';


        res.on('data',chunk=>{
          data += chunk;
        });



        res.on('end',()=>{


          try {


            const json = JSON.parse(data);


            const potenciaTotal =
              json.total_act_power || 0;



            const reqEnergia = http.get(
              `http://${ip}/rpc/EMData.GetStatus?id=0`,
              {timeout:5000},
              (resEnergia)=>{


                let dataEnergia='';



                resEnergia.on('data',chunk=>{
                  dataEnergia += chunk;
                });



                resEnergia.on('end',()=>{


                  try {


                    const jsonEnergia =
                      JSON.parse(dataEnergia);



                    const energiaTotal =
                      (jsonEnergia.a_total_act_energy || 0) +
                      (jsonEnergia.b_total_act_energy || 0) +
                      (jsonEnergia.c_total_act_energy || 0);



                    const consumoDia =
                      obterEnergiaInicial(
                        ip,
                        energiaTotal
                      );



                    resolve({

                      ip,

                      potencia:
                        Number(potenciaTotal) || 0,

                      energia:
                        consumoDia,

                      energiaTotal,

                      online:true

                    });



                  } catch(e){


                    resolve({

                      ip,
                      potencia:Number(potenciaTotal)||0,
                      energia:0,
                      energiaTotal:0,
                      online:true

                    });


                  }


                });



              }
            );



            reqEnergia.on('error',()=>{

              resolve({

                ip,
                potencia:Number(potenciaTotal)||0,
                energia:0,
                energiaTotal:0,
                online:true

              });

            });



          } catch(e){


            resolve({

              ip,
              potencia:0,
              energia:0,
              energiaTotal:0,
              online:false

            });


          }



        });



      }

    );



    reqPotencia.on('error',()=>{

      resolve({

        ip,
        potencia:0,
        energia:0,
        energiaTotal:0,
        online:false

      });


    });



  });


}
// ===== BUSCAR TODOS OS SHELLYS ===//==

//async function buscarTodosDados() {

  try {


    for (const [grupoId, grupoConfig] of Object.entries(config.grupos)) {


      for (const ip of grupoConfig.ips) {


        const dados = await buscarDadosShelly(ip);



        if (dados.online) {


          const hoje =
            new Date().toISOString().split('T')[0];


          const agora =
            new Date().toISOString();



          pool.query(
            `
            INSERT INTO dados_shelly
            (
              ip,
              grupo,
              potencia,
              energia,
              timestamp,
              data_dia
            )
            VALUES ($1,$2,$3,$4,$5,$6)
            `,
            [
              ip,
              grupoId,
              dados.potencia,
              dados.energia,
              agora,
              hoje
            ]
          )
          .then(()=>{

            console.log(
              `[✓] ${ip}: ${dados.potencia.toFixed(0)}W | ${dados.energia.toFixed(0)}Wh`
            );

          })
          .catch(err=>{

            console.error(
              '[DB] Erro inserir:',
              err.message
            );

          });



          agregarPorHora(
            ip,
            grupoId,
            dados.energia,
            dados.potencia
          );


        }
        else {


          console.log(
            `[✗] ${ip} OFFLINE`
          );


        }


      }


    }



  } catch(err){

    console.error(
      '[ERRO]',
      err.message
    );

  }


}



// ===== INICIAR LEITURAS =====

app.post('/api/shelly', async (req,res)=>{
...
});

// ===== API GRUPOS =====

app.get('/api/grupos',(req,res)=>{


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



// ===== API STATUS =====

app.get('/api/status/:grupoId',async(req,res)=>{


try{


const grupoId=req.params.grupoId;


const resultado =
await pool.query(
`
SELECT DISTINCT ON (ip)
ip,
potencia,
energia,
timestamp

FROM dados_shelly

WHERE grupo=$1

ORDER BY ip,timestamp DESC
`,
[grupoId]
);



let totalPotencia=0;
let totalEnergia=0;



const shellys =
resultado.rows.map(row=>{


totalPotencia += row.potencia;
totalEnergia += row.energia;



return {

ip:row.ip,

online:true,

potencia:
(row.potencia/1000).toFixed(3),

energia:
(row.energia/1000).toFixed(3)

};


});



res.json({

grupo:grupoId,

totalKW:
(totalPotencia/1000).toFixed(3),

energiaHoje:
(totalEnergia/1000).toFixed(3),

shellys


});



}catch(err){


res.status(500).json({

erro:err.message

});


}


});



// ===== HISTÓRICO DIÁRIO =====

app.get('/api/historico/:grupoId',async(req,res)=>{


try{


const dias =
parseInt(req.query.dias)||7;



const result =
await pool.query(
`
SELECT

data_dia AS dia,

MAX(energia) AS energiaConsumida,

ROUND(AVG(potencia)/1000,3) AS potenciaMedia,

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



res.json(result.rows);



}catch(err){


res.status(500).json({

erro:err.message

});


}


});



// ===== SERVIDOR =====

const PORT = process.env.PORT || 3000;


app.listen(PORT,()=>{


console.log(
`Servidor Cristema iniciado na porta ${PORT}`
);


});
