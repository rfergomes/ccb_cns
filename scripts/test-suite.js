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
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.frozenRows = 0;
  }

  getLastRow() {
    return this.rows.length;
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
  console.log('✓ [1/9] doGet() padrão roteia para view=portal e expõe Logotipos CCB e CNS.');

  // Teste 2: Roteamento doGet para view=admin e view=checkin
  const resAdminRoute = gasGlobalContext.doGet({ parameter: { view: 'admin' } });
  assert.strictEqual(resAdminRoute.template.initialView, 'admin');
  const resCheckinRoute = gasGlobalContext.doGet({ parameter: { view: 'checkin' } });
  assert.strictEqual(resCheckinRoute.template.initialView, 'checkin');
  console.log('✓ [2/9] Roteamento de views (portal, checkin e admin) validado.');

  // Teste 3: Proteção ADMIN_SECRET
  assert.throws(() => {
    gasGlobalContext.apiAdminAuthenticateAndLoad('SenhaIncorreta');
  }, /Acesso não autorizado/);
  console.log('✓ [3/9] Segurança ADMIN_SECRET bloqueia tentativas de acesso com chave incorreta.');

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
      STATUS: 'ATIVO'
    },
    'ALL'
  );
  assert.strictEqual(createEvRes.success, true);
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
  console.log(`✓ [4/9] Evento único ATIVO e status PREVISTO validados (${idEventoCriado}).`);

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

  // Testa recuperação direta da credencial QR Code via link do WhatsApp (?credencial=UUID)
  const voucherLookup = gasGlobalContext.apiGetVoucherById(inscricaoRes1.inscricao.ID_INSCRICAO);
  assert.ok(voucherLookup && voucherLookup.inscricao);
  assert.strictEqual(voucherLookup.inscricao.ID_INSCRICAO, inscricaoRes1.inscricao.ID_INSCRICAO);

  const portalWithVoucher = gasGlobalContext.apiGetPortalState(
    '',
    inscricaoRes1.inscricao.ID_INSCRICAO
  );
  assert.ok(portalWithVoucher.initialVoucher && portalWithVoucher.initialVoucher.inscricao);
  assert.strictEqual(
    portalWithVoucher.initialVoucher.inscricao.ID_INSCRICAO,
    inscricaoRes1.inscricao.ID_INSCRICAO
  );
  console.log('✓ [5/9] Inscrições e link direto de Credencial QR Code (WhatsApp) validados.');

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
  console.log('✓ [6/9] Janela de 1h antes do evento validada (bloqueio prévio + liberação no horário).');

  // Teste 7: Auto-Credenciamento Online informando APENAS E-mail ou APENAS Telefone
  assert.throws(() => {
    gasGlobalContext.apiSubmitOnlineSelfCheckIn({
      ID_EVENTO: idEventoCriado,
      METHOD: 'EMAIL_PHONE',
      EMAIL: '',
      TELEFONE: ''
    });
  }, /pelo menos um dos campos/);

  const selfCheckinOnlyPhone = gasGlobalContext.apiSubmitOnlineSelfCheckIn({
    ID_EVENTO: idEventoCriado,
    METHOD: 'EMAIL_PHONE',
    EMAIL: '',
    TELEFONE: '4321' // Informou apenas os 4 últimos dígitos do telefone de Carlos Eduardo Souza
  });
  assert.strictEqual(selfCheckinOnlyPhone.success, true);
  assert.strictEqual(selfCheckinOnlyPhone.alreadyCheckedIn, false);
  assert.strictEqual(selfCheckinOnlyPhone.inscricao.PRESENCA_CONFIRMADA, true);

  const selfCheckinOnlyEmail = gasGlobalContext.apiSubmitOnlineSelfCheckIn({
    ID_EVENTO: idEventoCriado,
    METHOD: 'EMAIL_PHONE',
    EMAIL: 'carlos.souza@exemplo.org.br',
    TELEFONE: '' // Informou apenas o e-mail
  });
  assert.strictEqual(selfCheckinOnlyEmail.success, true);
  assert.strictEqual(selfCheckinOnlyEmail.alreadyCheckedIn, true);
  console.log('✓ [7/9] Auto-Credenciamento Online validado com APENAS E-mail ou APENAS Telefone.');

  // Teste 8: Check-in via QR Code na Recepção detecta presença já confirmada
  const checkinRecepcao = gasGlobalContext.apiAdminProcessQrCheckIn(
    mockPropertiesStore.ADMIN_SECRET,
    inscricaoRes1.inscricao.ID_INSCRICAO,
    idEventoCriado,
    'ALL'
  );
  assert.strictEqual(checkinRecepcao.success, true);
  assert.strictEqual(checkinRecepcao.alreadyCheckedIn, true);
  console.log('✓ [8/9] Terminal de Recepção integra-se em tempo real com os check-ins feitos online.');

  // Teste 9: Cálculo de KPIs e séries de gráficos no Dashboard Administrativo
  const dashBundle = gasGlobalContext.apiAdminGetDashboardData(
    mockPropertiesStore.ADMIN_SECRET,
    idEventoCriado
  );
  assert.strictEqual(dashBundle.kpis.totalInscricoes, 2);
  assert.strictEqual(dashBundle.kpis.totalPresencas, 2);
  assert.strictEqual(dashBundle.kpis.taxaPresenca, 100);
  console.log('✓ [9/9] KPIs e agregações de gráficos atualizados com 100% de precisão.\n');

  console.log('Todos os 9 cenários de teste automatizados passaram com sucesso!');
}

runTests();
