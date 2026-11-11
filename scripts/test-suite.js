/**
 * @fileoverview Suíte de testes automatizados (Node.js) com mock completo do ambiente
 * Google Apps Script (V8) para validar todas as camadas da aplicação "Agenda CNS":
 * Environment, SecurityUtils, SheetsRepository, InscriptionService, AdminService e Code.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ==========================================================================
 * 1. MOCK DO AMBIENTE GOOGLE APPS SCRIPT (V8 RUNTIME)
 * ========================================================================== */

const mockPropertiesStore = {
  SPREADSHEET_ID: 'mock-spreadsheet-id-ccb-cns-campinas',
  ADMIN_SECRET: 'ChaveMestraCNS#2026'
};

let mockLoggedGoogleEmail = '';

class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const result = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowIndex = this.row - 1 + r;
      const sourceRow = this.sheet.rows[rowIndex] || [];
      const rowSlice = [];
      for (let c = 0; c < this.numCols; c++) {
        const colIndex = this.col - 1 + c;
        rowSlice.push(sourceRow[colIndex] !== undefined ? sourceRow[colIndex] : '');
      }
      result.push(rowSlice);
    }
    return result;
  }

  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      const rowIndex = this.row - 1 + r;
      while (this.sheet.rows.length <= rowIndex) {
        this.sheet.rows.push([]);
      }
      for (let c = 0; c < values[r].length; c++) {
        const colIndex = this.col - 1 + c;
        this.sheet.rows[rowIndex][colIndex] = values[r][c];
      }
    }
    return this;
  }

  setBackground() {
    return this;
  }
  setFontColor() {
    return this;
  }
  setFontFamily() {
    return this;
  }
  setFontWeight() {
    return this;
  }
  setHorizontalAlignment() {
    return this;
  }
  setNumberFormat() {
    return this;
  }
  setNumberFormats() {
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      const rowIndex = this.row - 1 + r;
      if (this.sheet.rows[rowIndex]) {
        for (let c = 0; c < this.numCols; c++) {
          const colIndex = this.col - 1 + c;
          this.sheet.rows[rowIndex][colIndex] = '';
        }
      }
    }
    return this;
  }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.frozenRows = 0;
  }

  getLastRow() {
    for (let r = this.rows.length - 1; r >= 0; r--) {
      const row = this.rows[r] || [];
      if (row.some((cell) => cell !== '' && cell !== null && cell !== undefined)) {
        return r + 1;
      }
    }
    return 0;
  }

  getLastColumn() {
    if (this.rows.length === 0) return 0;
    return Math.max(...this.rows.map((r) => r.length), 0);
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    return new MockRange(this, row, col, numRows, numCols);
  }

  setFrozenRows(n) {
    this.frozenRows = n;
  }

  deleteRow(rowPosition) {
    const idx = rowPosition - 1;
    if (idx >= 0 && idx < this.rows.length) {
      this.rows.splice(idx, 1);
    }
  }

  deleteRows(rowPosition, howMany) {
    const idx = rowPosition - 1;
    if (idx >= 0 && idx < this.rows.length && howMany > 0) {
      this.rows.splice(idx, howMany);
    }
  }
}

class MockSpreadsheet {
  constructor(id) {
    this.id = id;
    this.sheets = new Map();
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    const sheet = new MockSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

const mockSpreadsheetsDb = new Map();

let uuidCounter = 0;
const gasGlobalContext = {
  console,
  Date,
  Math,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Map,
  Set,
  Error,
  JSON,
  isNaN,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => mockPropertiesStore[key] || null,
      setProperty: (key, val) => {
        mockPropertiesStore[key] = val;
      }
    })
  },
  Session: {
    getScriptTimeZone: () => 'America/Sao_Paulo',
    getActiveUser: () => ({
      getEmail: () => mockLoggedGoogleEmail
    })
  },
  ScriptApp: {
    getService: () => ({
      getUrl: () => 'https://script.google.com/macros/s/MOCK_DEPLOY_ID/exec'
    })
  },
  Utilities: {
    getUuid: () => {
      uuidCounter++;
      const hex = uuidCounter.toString(16).padStart(12, '0');
      return `550e8400-e29b-41d4-a716-${hex}`;
    },
    formatDate: (date, _tz, format) => {
      const d = new Date(date);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      if (format === 'yyyy-MM-dd') return `${yyyy}-${mm}-${dd}`;
      if (format === 'HH:mm') return `${hh}:${min}`;
      return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}-03:00`;
    }
  },
  LockService: {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  },
  SpreadsheetApp: {
    openById: (id) => {
      if (!mockSpreadsheetsDb.has(id)) {
        mockSpreadsheetsDb.set(id, new MockSpreadsheet(id));
      }
      return mockSpreadsheetsDb.get(id);
    },
    flush: () => {}
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createHtmlOutputFromFile: (file) => ({
      getContent: () => `<!-- Conteúdo de ${file} -->`
    }),
    createTemplateFromFile: (file) => ({
      file,
      evaluate: function () {
        return {
          template: this,
          title: '',
          metaTags: [],
          xFrameMode: null,
          setTitle(t) {
            this.title = t;
            return this;
          },
          addMetaTag(name, content) {
            this.metaTags.push({ name, content });
            return this;
          },
          setXFrameOptionsMode(m) {
            this.xFrameMode = m;
            return this;
          }
        };
      }
    })
  },
  Logger: {
    log: () => {}
  }
};

vm.createContext(gasGlobalContext);

const srcFilesOrder = [
  'src/config/Environment.js',
  'src/utils/SecurityUtils.js',
  'src/repositories/SheetsRepository.js',
  'src/services/InscriptionService.js',
  'src/services/AdminService.js',
  'src/Code.js'
];

for (const relativePath of srcFilesOrder) {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  const code = fs.readFileSync(fullPath, 'utf8');
  vm.runInContext(code, gasGlobalContext, { filename: relativePath });
}

/* ==========================================================================
 * 2. EXECUÇÃO DOS CENÁRIOS DE TESTE
 * ========================================================================== */

function runTests() {
  console.log('Iniciando suíte de testes automatizados da Agenda CNS...\n');

  // Teste 1: Roteamento doGet sem evento ativo e presença dos Logotipos nos metadados
  const resPortalVazio = gasGlobalContext.doGet({ parameter: {} });
  assert.strictEqual(resPortalVazio.template.initialView, 'portal');
  const bootVazio = JSON.parse(resPortalVazio.template.bootstrapJson);
  assert.strictEqual(bootVazio.hasActiveEvent, false);
  assert.strictEqual(bootVazio.metadata.logos.CCB_FILE_ID, '13etuen5crQ5e66EVMRJp4cHrYWRXsREM');
  assert.strictEqual(bootVazio.metadata.logos.CNS_FILE_ID, '11cfotJKM6DCDD3HUk99kboHWLHG2v0ah');
  console.log('✓ [1/10] doGet() padrão roteia para view=portal e expõe Logotipos CCB e CNS.');

  // Teste 2: Roteamento doGet para view=admin e view=checkin
  const resAdminRoute = gasGlobalContext.doGet({ parameter: { view: 'admin' } });
  assert.strictEqual(resAdminRoute.template.initialView, 'admin');
  const resCheckinRoute = gasGlobalContext.doGet({ parameter: { view: 'checkin' } });
  assert.strictEqual(resCheckinRoute.template.initialView, 'checkin');
  console.log('✓ [2/10] Roteamento de views (portal, checkin e admin) validado.');

  // Teste 3: Proteção ADMIN_SECRET
  assert.throws(() => {
    gasGlobalContext.apiAdminAuthenticateAndLoad('SenhaIncorreta');
  }, /Acesso não autorizado/);
  console.log('✓ [3/10] Segurança ADMIN_SECRET bloqueia tentativas de acesso com chave incorreta.');

  // Teste 4: Criação de Evento futuro com status ATIVO pelo Admin
  const futureDate = '2027-05-15';
  const createEvRes = gasGlobalContext.apiAdminSaveEvento(
    mockPropertiesStore.ADMIN_SECRET,
    {
      TITULO: '1ª Reunião Geral CNS - Regional Campinas',
      DATA_EVENTO: futureDate,
      HORA_EVENTO: '14:00',
      HORA_LANCHE: '15:20',
      LOCAL: 'Rua Germânia, 661 - Campinas/SP',
      COMPLEMENTO_LOCAL: 'Salão de Reuniões - 3º andar - Prédio anexo do Bonfim - Campinas.',
      STATUS: 'ATIVO'
    },
    'ALL'
  );
  assert.strictEqual(createEvRes.success, true);
  assert.strictEqual(
    createEvRes.evento.COMPLEMENTO_LOCAL,
    'Salão de Reuniões - 3º andar - Prédio anexo do Bonfim - Campinas.'
  );
  assert.strictEqual(createEvRes.evento.LOCAL, 'Rua Germânia, 661 - Campinas/SP');
  const idEventoCriado = createEvRes.evento.ID_EVENTO;
  assert.ok(idEventoCriado && idEventoCriado.length === 36);

  // Testa criação de evento futuro com status PREVISTO (não afeta o evento ATIVO)
  const evPrevistoRes = gasGlobalContext.apiAdminSaveEvento(
    mockPropertiesStore.ADMIN_SECRET,
    {
      TITULO: '2ª Reunião Geral CNS - Programada',
      DATA_EVENTO: '2027-09-20',
      HORA_EVENTO: '14:00',
      HORA_LANCHE: '15:20',
      LOCAL: 'Rua Germânia, 661 - Campinas/SP',
      STATUS: 'PREVISTO'
    },
    'ALL'
  );
  assert.strictEqual(evPrevistoRes.evento.STATUS, 'PREVISTO');

  // Testa ativação do 2º evento: encerra automaticamente o 1º evento ativo
  const activateSecondRes = gasGlobalContext.apiAdminUpdateEventoStatus(
    mockPropertiesStore.ADMIN_SECRET,
    evPrevistoRes.evento.ID_EVENTO,
    'ATIVO',
    'ALL'
  );
  assert.strictEqual(activateSecondRes.evento.STATUS, 'ATIVO');
  assert.strictEqual(activateSecondRes.autoClosedEvents.length, 1);

  // Reativa o 1º evento (e deixa o 2º como PREVISTO) para os testes seguintes
  gasGlobalContext.apiAdminUpdateEventoStatus(
    mockPropertiesStore.ADMIN_SECRET,
    evPrevistoRes.evento.ID_EVENTO,
    'PREVISTO',
    'ALL'
  );
  gasGlobalContext.apiAdminUpdateEventoStatus(
    mockPropertiesStore.ADMIN_SECRET,
    idEventoCriado,
    'ATIVO',
    'ALL'
  );
  const portalWithUpcoming = gasGlobalContext.apiGetPortalState();
  assert.strictEqual(portalWithUpcoming.hasActiveEvent, true);
  assert.strictEqual(
    portalWithUpcoming.activeEvent.COMPLEMENTO_LOCAL,
    'Salão de Reuniões - 3º andar - Prédio anexo do Bonfim - Campinas.'
  );
  assert.ok(Array.isArray(portalWithUpcoming.upcomingEvents));
  assert.strictEqual(portalWithUpcoming.upcomingEvents.length, 1);
  assert.strictEqual(portalWithUpcoming.upcomingEvents[0].ID_EVENTO, evPrevistoRes.evento.ID_EVENTO);
  console.log(`✓ [4/10] Evento único ATIVO e status PREVISTO validados (${idEventoCriado}).`);

  // Teste 5: Validação condicional (E-mail OU Telefone: pelo menos um obrigatório) e LGPD
  assert.throws(() => {
    gasGlobalContext.apiSubmitPublicInscription({
      ID_EVENTO: idEventoCriado,
      NOME_COMPLETO: 'Rodrigo Fernando Gomes Lima',
      CIDADE: 'Campinas',
      FUNCAO: 'Negociador de Suprimentos (CNS)',
      EMAIL: '',
      TELEFONE: '',
      ACEITE_LGPD: true
    });
  }, /pelo menos um dado de contato/);

  assert.throws(() => {
    gasGlobalContext.apiSubmitPublicInscription({
      ID_EVENTO: idEventoCriado,
      NOME_COMPLETO: 'Rodrigo Fernando Gomes Lima',
      CIDADE: 'Campinas',
      FUNCAO: 'Negociador de Suprimentos (CNS)',
      EMAIL: 'rodrigo.lima@exemplo.org.br',
      TELEFONE: '',
      ACEITE_LGPD: false
    });
  }, /LGPD/);

  const inscricaoRes1 = gasGlobalContext.apiSubmitPublicInscription({
    ID_EVENTO: idEventoCriado,
    NOME_COMPLETO: 'Rodrigo Fernando Gomes Lima',
    CIDADE: 'Campinas',
    FUNCAO: 'Negociador de Suprimentos (CNS)',
    EMAIL: 'rodrigo.lima@exemplo.org.br',
    TELEFONE: '19998887766',
    ACEITE_LGPD: true
  });
  assert.strictEqual(inscricaoRes1.success, true);
  assert.strictEqual(inscricaoRes1.inscricao.TELEFONE, '(19) 99888-7766');

  const inscricaoRes2 = gasGlobalContext.apiSubmitPublicInscription({
    ID_EVENTO: idEventoCriado,
    NOME_COMPLETO: 'Carlos Eduardo Souza',
    CIDADE: 'Valinhos',
    FUNCAO: 'Diácono',
    EMAIL: 'carlos.souza@exemplo.org.br',
    TELEFONE: '19987654321',
    ACEITE_LGPD: true
  });
  assert.strictEqual(inscricaoRes2.success, true);

  // Testa recuperação direta da credencial QR Code via link do WhatsApp (?credencial=UUID) + LGPD Masking
  const voucherLookup = gasGlobalContext.apiGetVoucherById(inscricaoRes1.inscricao.ID_INSCRICAO);
  assert.ok(voucherLookup && voucherLookup.inscricao);
  assert.strictEqual(voucherLookup.inscricao.ID_INSCRICAO, inscricaoRes1.inscricao.ID_INSCRICAO);
  assert.strictEqual(voucherLookup.inscricao.EMAIL, '');
  assert.strictEqual(voucherLookup.inscricao.TELEFONE, '');
  assert.ok(voucherLookup.inscricao.EMAIL_MASKED.includes('***'));
  assert.strictEqual(voucherLookup.inscricao.HAS_TELEFONE, true);

  const portalWithVoucher = gasGlobalContext.apiGetPortalState(
    '',
    inscricaoRes1.inscricao.ID_INSCRICAO
  );
  assert.ok(portalWithVoucher.initialVoucher && portalWithVoucher.initialVoucher.inscricao);
  assert.strictEqual(
    portalWithVoucher.initialVoucher.inscricao.ID_INSCRICAO,
    inscricaoRes1.inscricao.ID_INSCRICAO
  );
  assert.strictEqual(portalWithVoucher.initialVoucher.inscricao.EMAIL, '');
  console.log('✓ [5/10] Inscrições, link QR Code (WhatsApp) e mascaramento LGPD validados.');

  // Teste 6: Bloqueio de Check-in antes da janela de 1 hora do evento e liberação dentro da janela
  assert.throws(() => {
    gasGlobalContext.apiSubmitOnlineSelfCheckIn({
      ID_EVENTO: idEventoCriado,
      METHOD: 'EMAIL_PHONE',
      EMAIL: 'rodrigo.lima@exemplo.org.br',
      TELEFONE: ''
    });
  }, /liberado somente 1 hora antes da reunião/);

  assert.throws(() => {
    gasGlobalContext.apiAdminProcessQrCheckIn(
      mockPropertiesStore.ADMIN_SECRET,
      inscricaoRes1.inscricao.ID_INSCRICAO,
      idEventoCriado,
      'ALL'
    );
  }, /liberado somente 1 hora antes da reunião/);

  // Atualiza a data/hora do evento para hoje (dentro da janela de 1 hora antes da reunião)
  const nowPlus30Min = new Date(Date.now() + 30 * 60 * 1000);
  const todayIso = gasGlobalContext.Utilities.formatDate(
    nowPlus30Min,
    'America/Sao_Paulo',
    'yyyy-MM-dd'
  );
  const horaIso = gasGlobalContext.Utilities.formatDate(
    nowPlus30Min,
    'America/Sao_Paulo',
    'HH:mm'
  );
  gasGlobalContext.apiAdminSaveEvento(
    mockPropertiesStore.ADMIN_SECRET,
    {
      ID_EVENTO: idEventoCriado,
      TITULO: '1ª Reunião Geral CNS - Regional Campinas',
      DATA_EVENTO: todayIso,
      HORA_EVENTO: horaIso,
      HORA_LANCHE: '15:20',
      LOCAL: 'Rua Germânia, 661 - Campinas/SP',
      STATUS: 'ATIVO'
    },
    'ALL'
  );

  // Agora dentro da janela de 1h antes do evento, testa Auto-Credenciamento via Conta Google Logada
  mockLoggedGoogleEmail = 'rodrigo.lima@exemplo.org.br';
  const matchGoogle = gasGlobalContext.apiCheckParticipantAutoMatch(idEventoCriado, '');
  assert.strictEqual(matchGoogle.found, true);
  assert.strictEqual(matchGoogle.source, 'GOOGLE_ACCOUNT');
  assert.strictEqual(matchGoogle.candidate.NOME_COMPLETO, 'Rodrigo Fernando Gomes Lima');

  const selfCheckinGoogle = gasGlobalContext.apiSubmitOnlineSelfCheckIn({
    ID_EVENTO: idEventoCriado,
    METHOD: 'GOOGLE_ACCOUNT'
  });
  assert.strictEqual(selfCheckinGoogle.success, true);
  assert.strictEqual(selfCheckinGoogle.alreadyCheckedIn, false);
  assert.strictEqual(selfCheckinGoogle.inscricao.PRESENCA_CONFIRMADA, true);
  mockLoggedGoogleEmail = '';
  console.log('✓ [6/10] Janela de 1h antes do evento validada (bloqueio prévio + liberação no horário).');

  // Teste 7: Auto-Credenciamento Online exigindo telefone completo quando usado sozinho e aceitando 4 dígitos com E-mail
  assert.throws(() => {
    gasGlobalContext.apiSubmitOnlineSelfCheckIn({
      ID_EVENTO: idEventoCriado,
      METHOD: 'EMAIL_PHONE',
      EMAIL: '',
      TELEFONE: ''
    });
  }, /pelo menos um dos campos/);

  assert.throws(() => {
    gasGlobalContext.apiSubmitOnlineSelfCheckIn({
      ID_EVENTO: idEventoCriado,
      METHOD: 'EMAIL_PHONE',
      EMAIL: '',
      TELEFONE: '4321' // Apenas 4 dígitos sem e-mail deve ser bloqueado por segurança
    });
  }, /número completo com DDD/);

  const selfCheckinOnlyPhone = gasGlobalContext.apiSubmitOnlineSelfCheckIn({
    ID_EVENTO: idEventoCriado,
    METHOD: 'EMAIL_PHONE',
    EMAIL: '',
    TELEFONE: '19987654321'
  });
  assert.strictEqual(selfCheckinOnlyPhone.success, true);
  assert.strictEqual(selfCheckinOnlyPhone.alreadyCheckedIn, false);
  assert.strictEqual(selfCheckinOnlyPhone.inscricao.PRESENCA_CONFIRMADA, true);
  assert.strictEqual(selfCheckinOnlyPhone.inscricao.EMAIL, '');

  const selfCheckinEmailPlus4 = gasGlobalContext.apiSubmitOnlineSelfCheckIn({
    ID_EVENTO: idEventoCriado,
    METHOD: 'EMAIL_PHONE',
    EMAIL: 'carlos.souza@exemplo.org.br',
    TELEFONE: '4321' // 2º fator com 4 últimos dígitos quando combinado com e-mail
  });
  assert.strictEqual(selfCheckinEmailPlus4.success, true);
  assert.strictEqual(selfCheckinEmailPlus4.alreadyCheckedIn, true);
  console.log('✓ [7/10] Auto-Credenciamento Online validado com proteção contra chute de 4 dígitos.');

  // Teste 8: Check-in via QR Code na Recepção detecta presença já confirmada
  const checkinRecepcao = gasGlobalContext.apiAdminProcessQrCheckIn(
    mockPropertiesStore.ADMIN_SECRET,
    inscricaoRes1.inscricao.ID_INSCRICAO,
    idEventoCriado,
    'ALL'
  );
  assert.strictEqual(checkinRecepcao.success, true);
  assert.strictEqual(checkinRecepcao.alreadyCheckedIn, true);
  console.log('✓ [8/10] Terminal de Recepção integra-se em tempo real com os check-ins feitos online.');

  // Teste 9: Cálculo de KPIs e séries de gráficos no Dashboard Administrativo
  const dashBundle = gasGlobalContext.apiAdminGetDashboardData(
    mockPropertiesStore.ADMIN_SECRET,
    idEventoCriado
  );
  assert.strictEqual(dashBundle.kpis.totalInscricoes, 2);
  assert.strictEqual(dashBundle.kpis.totalPresencas, 2);
  assert.strictEqual(dashBundle.kpis.taxaPresenca, 100);
  console.log('✓ [9/10] KPIs e agregações de gráficos atualizados com 100% de precisão.');

  // Teste 10: Deduplicação por telefone, preservação de contato, bloqueio de evento encerrado e segurança do frontend
  const reInscricaoOnlyPhone = gasGlobalContext.apiSubmitPublicInscription({
    ID_EVENTO: idEventoCriado,
    NOME_COMPLETO: 'Rodrigo F. G. Lima', // Variação leve de nome, mas mesmo telefone
    CIDADE: 'Campinas',
    FUNCAO: 'Negociador de Suprimentos (CNS)',
    EMAIL: '',
    TELEFONE: '19998887766',
    ACEITE_LGPD: true
  });
  assert.strictEqual(reInscricaoOnlyPhone.isDuplicate, true);
  assert.strictEqual(reInscricaoOnlyPhone.inscricao.ID_INSCRICAO, inscricaoRes1.inscricao.ID_INSCRICAO);
  assert.strictEqual(reInscricaoOnlyPhone.inscricao.EMAIL, 'rodrigo.lima@exemplo.org.br'); // E-mail anterior preservado

  assert.throws(() => {
    gasGlobalContext.apiAdminCreateManualInscricao(
      mockPropertiesStore.ADMIN_SECRET,
      {
        ID_EVENTO: idEventoCriado,
        NOME_COMPLETO: 'Carlos Eduardo Souza',
        CIDADE: 'Valinhos',
        FUNCAO: 'Diácono',
        EMAIL: 'carlos.souza@exemplo.org.br',
        TELEFONE: '19987654321',
        ACEITE_LGPD: true
      },
      'ALL'
    );
  }, /já possui inscrição registrada/);

  gasGlobalContext.apiAdminUpdateEventoStatus(
    mockPropertiesStore.ADMIN_SECRET,
    idEventoCriado,
    'ENCERRADO',
    'ALL'
  );
  assert.throws(() => {
    gasGlobalContext.apiAdminProcessQrCheckIn(
      mockPropertiesStore.ADMIN_SECRET,
      inscricaoRes1.inscricao.ID_INSCRICAO,
      idEventoCriado,
      'ALL'
    );
  }, /status ENCERRADO/);

  // Valida exclusão em lote de evento + inscrições vinculadas
  const delRes = gasGlobalContext.apiAdminDeleteEvento(
    mockPropertiesStore.ADMIN_SECRET,
    idEventoCriado,
    'ALL'
  );
  assert.strictEqual(delRes.success, true);
  assert.strictEqual(delRes.bundle.kpis.totalInscricoes, 0);

  // Sem evento ATIVO, o portal deve indicar hasActiveEvent = false mas listar upcomingEvents (PREVISTO)
  const portalOnlyUpcoming = gasGlobalContext.apiGetPortalState();
  assert.strictEqual(portalOnlyUpcoming.hasActiveEvent, false);
  assert.strictEqual(portalOnlyUpcoming.upcomingEvents.length, 1);
  assert.strictEqual(portalOnlyUpcoming.upcomingEvents[0].STATUS, 'PREVISTO');

  // Auditoria estática de segurança/sintaxe no frontend AppScripts.html
  const appScriptsHtml = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'html', 'AppScripts.html'), 'utf8');
  const scriptMatch = appScriptsHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Tag <script> ausente em AppScripts.html');
  new Function(scriptMatch[1]); // Valida sintaxe JS completa
  assert.strictEqual(
    appScriptsHtml.split('\n').filter((l) => (l.match(/`/g) || []).length > 2).length,
    0,
    'Crases aninhadas detectadas em AppScripts.html'
  );
  assert.strictEqual(
    [...appScriptsHtml].filter((ch) => ch.codePointAt(0) > 0xffff).length,
    0,
    'Caracteres astrais (>U+FFFF) detectados em AppScripts.html'
  );
  assert.strictEqual(
    /\b(Environment|SecurityUtils|SpreadsheetApp|PropertiesService|Utilities)\./.test(appScriptsHtml),
    false,
    'Referência a símbolo exclusivo de backend detectada em AppScripts.html'
  );
  console.log('✓ [10/10] Deduplicação atômica, lote no Sheets e auditoria estática do frontend aprovados.');

  // Teste 11: CRUD dinâmico de Funções / Ministérios (aba FUNCOES) + Carga Institucional CCB
  const funcoesIniciais = gasGlobalContext.apiListarFuncoes();
  assert.strictEqual(funcoesIniciais.success, true);
  assert.strictEqual(funcoesIniciais.funcoes.length, 10);

  const novaFnRes = gasGlobalContext.apiAdminSaveFuncao(
    mockPropertiesStore.ADMIN_SECRET,
    {
      FUNCAO: 'Tesoureiro Regional',
      TIPO: 'Administração / Estatutário',
      ATIVO: true
    },
    'ALL'
  );
  assert.strictEqual(novaFnRes.success, true);
  assert.strictEqual(novaFnRes.funcao.FUNCAO_ID, 'FUNC-1011');
  assert.strictEqual(novaFnRes.bundle.funcoes.length, 11);

  assert.throws(() => {
    gasGlobalContext.apiAdminSaveFuncao(
      mockPropertiesStore.ADMIN_SECRET,
      {
        FUNCAO: 'tesoureiro regional',
        TIPO: 'Administração / Estatutário',
        ATIVO: true
      },
      'ALL'
    );
  }, /Já existe uma função cadastrada/);

  const toggleOffFnRes = gasGlobalContext.apiAdminToggleFuncaoStatus(
    mockPropertiesStore.ADMIN_SECRET,
    'FUNC-1011',
    false,
    'ALL'
  );
  assert.strictEqual(toggleOffFnRes.funcao.ATIVO, false);
  assert.strictEqual(
    gasGlobalContext.apiListarFuncoes().names.includes('Tesoureiro Regional'),
    false
  );

  const delFnRes = gasGlobalContext.apiAdminDeleteFuncao(
    mockPropertiesStore.ADMIN_SECRET,
    'FUNC-1011',
    'ALL'
  );
  assert.strictEqual(delFnRes.success, true);
  assert.strictEqual(delFnRes.bundle.funcoes.length, 10);

  const seedRes = gasGlobalContext.apiAdminSeedFuncoesInstitucionais(
    mockPropertiesStore.ADMIN_SECRET,
    'ALL'
  );
  assert.strictEqual(seedRes.success, true);
  assert.ok(seedRes.addedCount >= 15);
  const secondSeedRes = gasGlobalContext.apiAdminSeedFuncoesInstitucionais(
    mockPropertiesStore.ADMIN_SECRET,
    'ALL'
  );
  assert.strictEqual(secondSeedRes.addedCount, 0);
  console.log('✓ [11/11] CRUD completo de Funções e Carga Institucional CCB aprovados.\n');

  console.log('Todos os 11 cenários de teste automatizados passaram com sucesso!');
}

runTests();
