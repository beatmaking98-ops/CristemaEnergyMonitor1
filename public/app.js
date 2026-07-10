// ===== VARIÁVEIS GLOBAIS =====
let graficos = {};
let gruposAtivos = {};

// ===== INICIALIZAÇÃO =====
window.addEventListener('DOMContentLoaded', () => {
  console.log('[INIT] Cristema iniciando...');
  inicializarNavegacao();
  carregarGrupos();
  
  // Atualizar dados em tempo real
  setInterval(atualizarTodosOsGrupos, 1000);
  
  // Atualizar gráficos a cada 5 minutos
  setInterval(atualizarGraficosTodos, 300000);
});

// ===== NAVEGAÇÃO =====
function inicializarNavegacao() {
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      mudarPagina(item.dataset.page);
    });
  });

  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mudarPeriodo(parseInt(btn.dataset.dias));
    });
  });

  const formNovoGrupo = document.getElementById('add-grupo-form');
  if (formNovoGrupo) formNovoGrupo.addEventListener('submit', criarNovoGrupo);

  const formNovoShelly = document.getElementById('add-shelly-form');
  if (formNovoShelly) formNovoShelly.addEventListener('submit', adicionarShellyAGrupo);
}

function mudarPagina(page) {
  document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

  document.querySelectorAll('.page-section').forEach(section => section.classList.remove('active'));
  document.getElementById(page)?.classList.add('active');

  const titulos = {
    'dashboard': 'Dashboard',
    'devices': 'Dispositivos',
    'add-device': 'Adicionar Dispositivo',
    'energy': 'Análise de Energia',
    'settings': 'Definições'
  };
  const titleEl = document.querySelector('.page-title');
  if (titleEl) titleEl.textContent = titulos[page] || 'Dashboard';
}

// ===== CARREGAR GRUPOS =====
async function carregarGrupos() {
  try {
    const r = await fetch('/api/grupos');
    const grupos = await r.json();
    
    console.log('[GRUPOS] Carregados:', grupos);
    gruposAtivos = {};
    
    grupos.forEach(grupo => {
      gruposAtivos[grupo.id] = grupo;
      atualizarGrupo(grupo.id);
      atualizarGraficoGrupo(grupo.id, 7);
    });

    // Preencher select de grupos
    const selectGrupo = document.getElementById('grupo-select');
    if (selectGrupo) {
      selectGrupo.innerHTML = grupos.map(g => 
        `<option value="${g.id}">${g.nome} (${g.total} Shellys)</option>`
      ).join('');
    }

  } catch (erro) {
    console.error('[ERRO] Ao carregar grupos:', erro);
  }
}

// ===== ATUALIZAR TODOS OS GRUPOS =====
async function atualizarTodosOsGrupos() {
  for (const grupoId of Object.keys(gruposAtivos)) {
    atualizarGrupo(grupoId);
  }
}

// ===== ATUALIZAR UM GRUPO =====
async function atualizarGrupo(grupoId) {
  try {
    const r = await fetch(`/api/status/${grupoId}`);
    
    if (!r.ok) {
      mostrarOfflineGrupo(grupoId);
      return;
    }
    
    const dados = await r.json();
    console.log(`[STATUS ${grupoId}]`, dados);
    
    // Atualizar hora
    const horaEl = document.getElementById(`hora-${grupoId}`);
    if (horaEl) horaEl.textContent = dados.hora;
    
    // Atualizar totais
    const totalPowerEl = document.getElementById(`totalPower-${grupoId}`);
    const energiaHojeEl = document.getElementById(`energiaHoje-${grupoId}`);
    
    if (totalPowerEl) totalPowerEl.textContent = dados.totalKW;
    if (energiaHojeEl) energiaHojeEl.textContent = dados.energiaHoje;
    
    // Criar cards dos Shellys
    const containerShellys = document.getElementById(`shellys-container-${grupoId}`);
    if (containerShellys) {
      containerShellys.innerHTML = '';
      
      dados.shellys.forEach((shelly, index) => {
        const isOnline = shelly.online === true;
        // A potência já vem em kW do API
        const poder = shelly.potencia ? parseFloat(shelly.potencia).toFixed(3) : '0.000';
        // A energia já vem em kWh do API
        const energiaConsumida = shelly.energia ? parseFloat(shelly.energia).toFixed(3) : '0.000';
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'Online' : 'Offline';
        
        const card = document.createElement('div');
        card.className = 'device-card';
        card.style.borderTop = `4px solid ${dados.cor}`;
        card.innerHTML = `
          <div class="card-header">
            <h3>Shelly ${shelly.ip}</h3>
            <span class="status-badge ${statusClass}">${statusText}</span>
          </div>
          <div class="card-body">
            <div class="metric">
              <label>Potência</label>
              <div class="value">${poder} <span class="unit">kW</span></div>
            </div>
            <div class="metric">
              <label>Energia Hoje</label>
              <div class="value">${energiaConsumida} <span class="unit">kWh</span></div>
            </div>
          </div>
          <div class="card-footer">
            <button class="btn-small" onclick="removerShellyDoGrupo('${grupoId}', '${shelly.ip}')">
              <i class="fas fa-trash"></i> Remover
            </button>
          </div>
        `;
        containerShellys.appendChild(card);
      });
    }
    
  } catch (erro) {
    console.error(`[ERRO] Ao atualizar grupo ${grupoId}:`, erro);
    mostrarOfflineGrupo(grupoId);
  }
}

function mostrarOfflineGrupo(grupoId) {
  const containerShellys = document.getElementById(`shellys-container-${grupoId}`);
  if (containerShellys) {
    containerShellys.innerHTML = `
      <div class="error-message">
        <p>Nenhum Shelly disponível</p>
        <p style="font-size: 0.9em; color: #999;">Verifique a conexão</p>
      </div>
    `;
  }
  
  const totalPowerEl = document.getElementById(`totalPower-${grupoId}`);
  const energiaHojeEl = document.getElementById(`energiaHoje-${grupoId}`);
  if (totalPowerEl) totalPowerEl.textContent = '0.000';
  if (energiaHojeEl) energiaHojeEl.textContent = '0.000';
}

// ===== GRÁFICOS =====
async function atualizarGraficoGrupo(grupoId, dias = 7) {
  try {
    const r = await fetch(`/api/historico/${grupoId}?dias=${dias}`);
    const dados = await r.json();
    
    if (!Array.isArray(dados) || dados.length === 0) {
      console.log(`[GRÁFICO] Sem dados para ${grupoId}`);
      return;
    }
    
    const dadosFiltrados = dados.filter(d => parseFloat(d.energiaConsumida || 0) > 0);
    if (dadosFiltrados.length === 0) return;
    
    const labels = dadosFiltrados.map(d => {
      const data = new Date(d.dia);
      return data.toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit' });
    });
    
    // energiaConsumida já vem em kWh do API
    const energias = dadosFiltrados.map(d => parseFloat(d.energiaConsumida || 0));
    // potenciaMedia já vem em kW do API
    const potenciasMedia = dadosFiltrados.map(d => parseFloat(d.potenciaMedia || 0));
    
    const ctx = document.getElementById(`grafico-${grupoId}`);
    if (!ctx) return;
    
    if (graficos[grupoId]) graficos[grupoId].destroy();
    
    graficos[grupoId] = new Chart(ctx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Consumo Diário (kWh)',
            data: energias,
            backgroundColor: 'rgba(75, 192, 192, 0.7)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 2,
            yAxisID: 'y',
            borderRadius: 5
          },
          {
            label: 'Potência Média (kW)',
            data: potenciasMedia,
            type: 'line',
            borderColor: 'rgba(255, 159, 64, 1)',
            backgroundColor: 'rgba(255, 159, 64, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            yAxisID: 'y1',
            pointRadius: 5,
            pointHoverRadius: 7
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          title: {
            display: true,
            text: `${gruposAtivos[grupoId]?.nome} - Últimos ${dias} Dias`,
            font: { size: 16, weight: 'bold' }
          },
          legend: { display: true, position: 'top' }
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'Energia (kWh)', font: { weight: 'bold' } }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: { display: true, text: 'Potência Média (kW)', font: { weight: 'bold' } },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  } catch (e) {
    console.error(`[ERRO] Gráfico ${grupoId}:`, e);
  }
}

function atualizarGraficosTodos() {
  const periodoAtivo = document.querySelector('.period-btn.active');
  const dias = periodoAtivo ? parseInt(periodoAtivo.dataset.dias) : 7;
  
  for (const grupoId of Object.keys(gruposAtivos)) {
    atualizarGraficoGrupo(grupoId, dias);
  }
}

function mudarPeriodo(dias) {
  atualizarGraficosTodos();
}

// ===== CRIAR NOVO GRUPO =====
async function criarNovoGrupo(event) {
  event.preventDefault();
  
  const nome = document.getElementById('novo-grupo-nome').value;
  const cor = document.getElementById('novo-grupo-cor').value;
  const btn = document.getElementById('btn-add-grupo');
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Criando...';
  
  try {
    const response = await fetch('/api/grupos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, cor })
    });

    const resultado = await response.json();

    if (!resultado.sucesso) throw new Error(resultado.erro);

    mostrarToast('Grupo criado com sucesso!', 'sucesso');
    document.getElementById('add-grupo-form').reset();
    carregarGrupos();

  } catch (erro) {
    console.error('[ERRO]:', erro);
    mostrarToast('Erro: ' + erro.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plus"></i> Criar Grupo';
  }
}

// ===== ADICIONAR SHELLY A GRUPO =====
async function adicionarShellyAGrupo(event) {
  event.preventDefault();
  
  const grupoId = document.getElementById('grupo-select').value;
  const ip = document.getElementById('shelly-ip').value;
  const btn = document.getElementById('btn-add-shelly');
  const resultDiv = document.getElementById('result-shelly');
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Detectando...';
  resultDiv.classList.add('hidden');
  
  try {
    const response = await fetch(`/api/grupos/${grupoId}/shelly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip })
    });

    const resultado = await response.json();

    if (!resultado.sucesso) throw new Error(resultado.erro);

    mostrarResultado(resultado.dispositivo, true);
    document.getElementById('add-shelly-form').reset();
    carregarGrupos();
    mostrarToast('Shelly adicionado com sucesso!', 'sucesso');

  } catch (erro) {
    console.error('[ERRO]:', erro);
    mostrarResultado(null, false, erro.message);
    mostrarToast('Erro: ' + erro.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-search"></i> Detectar e Adicionar';
  }
}

// ===== REMOVER SHELLY DO GRUPO =====
async function removerShellyDoGrupo(grupoId, ip) {
  if (!confirm(`Remover Shelly ${ip}?`)) return;

  try {
    const response = await fetch(`/api/grupos/${grupoId}/shelly/${ip}`, {
      method: 'DELETE'
    });

    const resultado = await response.json();
    if (resultado.sucesso) {
      mostrarToast('Shelly removido', 'info');
      carregarGrupos();
    }
  } catch (erro) {
    console.error('[ERRO]:', erro);
    mostrarToast('Erro ao remover', 'erro');
  }
}

function mostrarResultado(dispositivo, sucesso, erro = null) {
  const resultDiv = document.getElementById('result-shelly');
  
  if (sucesso && dispositivo) {
    resultDiv.innerHTML = `
      <div class="result-box success">
        <i class="fas fa-check-circle"></i>
        <h4>Dispositivo Detectado!</h4>
        <p><strong>Modelo:</strong> ${dispositivo.modelo}</p>
        <p><strong>MAC:</strong> ${dispositivo.mac}</p>
        <p><strong>IP:</strong> ${dispositivo.ip}</p>
        <p style="color: #4caf50; margin-top: 1rem;">✓ Adicionado com sucesso</p>
      </div>
    `;
  } else {
    resultDiv.innerHTML = `
      <div class="result-box error">
        <i class="fas fa-times-circle"></i>
        <h4>Falha na Detecção</h4>
        <p>${erro || 'Não foi possível conectar'}</p>
        <p style="color: #f44336; margin-top: 1rem;">✗ Verifique o IP</p>
      </div>
    `;
  }
  resultDiv.classList.remove('hidden');
}

function mostrarToast(mensagem, tipo = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = mensagem;
  toast.className = `toast show ${tipo}`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}
