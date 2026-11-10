/**
 * @fileoverview Ponto de entrada canônico (Controller / Router) da aplicação web
 * "Agenda CNS" - Comissão de Negociadores de Suprimentos (CCB - Regional Campinas/SP).
 *
 * Responsável pelo roteamento em doGet(e), composição de templates HTML e exposição
 * de endpoints RPC assíncronos para `google.script.run` sem jamais acessar
 * diretamente o SpreadsheetApp na camada de apresentação.
 */

/**
 * Resolve e carrega um arquivo de template HTML de forma resiliente,
 * funcionando tanto na estrutura modular (`html/Nome`) quanto na raiz (`Nome`).
 *
 * @param {string} filename Nome do arquivo HTML sem extensão.
 * @returns {GoogleAppsScript.HTML.HtmlTemplate} Template instanciado.
 * @private
 */
function createHtmlTemplateSafe_(filename) {
  const cleanName = String(filename || '').replace(/\.html$/i, '');
  try {
    return HtmlService.createTemplateFromFile(`html/${cleanName}`);
  } catch (_) {
    return HtmlService.createTemplateFromFile(cleanName);
  }
}

/**
 * Helper global utilizado nos arquivos HTML (`<?!= include('AppStyles') ?>`)
 * para injeção modular de folhas de estilo e scripts de cliente.
 *
 * @param {string} filename Nome do arquivo HTML parcial.
 * @returns {string} Conteúdo bruto do arquivo HTML.
 */
function include(filename) {
  const cleanName = String(filename || '').replace(/\.html$/i, '');
  try {
    return HtmlService.createHtmlOutputFromFile(`html/${cleanName}`).getContent();
  } catch (_) {
    return HtmlService.createHtmlOutputFromFile(cleanName).getContent();
  }
}

/**
 * Entrypoint canônico HTTP GET do Google Apps Script Web App.
 * Gerencia o roteamento via parâmetro `e.parameter.view`:
 * - `view=portal` (padrão quando omitido): Rota Pública de Convocação e Inscrição.
 * - `view=checkin` (com opcional `&evento=UUID`): Rota Exclusiva de Auto-Credenciamento Online do Evento Ativo.
 * - `view=admin`: Rota Administrativa protegida por chave mestra (ADMIN_SECRET).
 *
 * @param {GoogleAppsScript.Events.DoGet} e Evento de requisição HTTP GET.
 * @returns {GoogleAppsScript.HTML.HtmlOutput} Página web renderizada.
 */
function doGet(e) {
  const rawView =
    e && e.parameter && e.parameter.view
      ? String(e.parameter.view).trim().toLowerCase()
      : 'portal';

  const requestedEventoId =
    e && e.parameter && (e.parameter.evento || e.parameter.idEvento)
      ? String(e.parameter.evento || e.parameter.idEvento).trim()
      : '';

  const requestedCredencialId =
    e && e.parameter && (e.parameter.credencial || e.parameter.inscricao || e.parameter.idInscricao)
      ? String(
          e.parameter.credencial || e.parameter.inscricao || e.parameter.idInscricao
        ).trim()
      : '';

  let currentView = 'portal';
  if (rawView === 'admin') {
    currentView = 'admin';
  } else if (
    rawView === 'checkin' ||
    rawView === 'autocredenciamento' ||
    rawView === 'credenciamento'
  ) {
    currentView = 'checkin';
  }

  let initialBootstrapData = {
    view: currentView,
    requestedEventoId,
    requestedCredencialId,
    hasActiveEvent: false,
    activeEvent: null,
    activeEvents: [],
    googleSessionMatch: null,
    initialVoucher: null,
    metadata: Environment.getPublicMetadata(),
    configError: null
  };

  try {
    const inscriptionService = new InscriptionService();
    const portalState = inscriptionService.getPortalState(
      requestedEventoId,
      requestedCredencialId
    );
    initialBootstrapData = {
      ...initialBootstrapData,
      hasActiveEvent: portalState.hasActiveEvent,
      activeEvent: portalState.activeEvent,
      activeEvents: portalState.activeEvents,
      googleSessionMatch: portalState.googleSessionMatch,
      initialVoucher: portalState.initialVoucher,
      metadata: portalState.metadata
    };
  } catch (err) {
    initialBootstrapData.configError =
      err && err.message
        ? err.message
        : 'Erro ao inicializar conexão com a base de dados Google Sheets.';
  }

  const template = createHtmlTemplateSafe_('Index');
  template.initialView = currentView;
  template.bootstrapJson = JSON.stringify(initialBootstrapData)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  let pageTitle = 'Agenda CNS | Convocação e Credenciamento - CCB Regional Campinas';
  if (currentView === 'admin') {
    pageTitle = 'Agenda CNS | Painel Administrativo - CCB Regional Campinas';
  } else if (currentView === 'checkin') {
    pageTitle = 'Agenda CNS | Auto-Credenciamento Online - CCB Regional Campinas';
  }

  return template
    .evaluate()
    .setTitle(pageTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, shrink-to-fit=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ==========================================================================
 * ENDPOINTS RPC PÚBLICOS (PORTAL DE INSCRIÇÃO E AUTO-CREDENCIAMENTO ONLINE)
 * ========================================================================== */

/**
 * Consulta o estado atualizado do Portal Público e de Auto-Credenciamento.
 * @param {string} [preferredEventoId] UUID opcional do evento.
 * @param {string} [credentialUuid] UUID opcional da inscrição.
 * @returns {Object} Estado do portal.
 */
function apiGetPortalState(preferredEventoId, credentialUuid) {
  const service = new InscriptionService();
  return service.getPortalState(preferredEventoId || '', credentialUuid || '');
}

/**
 * Recupera os dados do comprovante e QR Code de uma inscrição pelo seu UUID.
 *
 * @param {string} idInscricao UUID da inscrição.
 * @returns {Object|null} Dados do comprovante para renderização do QR Code.
 */
function apiGetVoucherById(idInscricao) {
  const service = new InscriptionService();
  return service.getVoucherById(idInscricao);
}

/**
 * Registra a inscrição de um participante e retorna o UUID gerado para o QR Code.
 *
 * @param {Object} formPayload Dados preenchidos pelo irmão no formulário público.
 * @returns {Object} Resultado contendo a inscrição, evento e UUID do QR Code.
 */
function apiSubmitPublicInscription(formPayload) {
  const service = new InscriptionService();
  return service.registerPublicInscription(formPayload);
}

/**
 * Verifica se o participante possui correspondência automática para o Auto-Credenciamento
 * (via Conta Google ativa na sessão ou credencial UUID salva no dispositivo).
 *
 * @param {string} idEvento UUID do evento ativo.
 * @param {string} [deviceSavedUuid] UUID salvo no localStorage do aparelho.
 * @returns {Object} Dados de elegibilidade para check-in com 1 clique.
 */
function apiCheckParticipantAutoMatch(idEvento, deviceSavedUuid) {
  const service = new InscriptionService();
  return service.checkParticipantAutoMatch(idEvento, deviceSavedUuid || '');
}

/**
 * Executa o Auto-Credenciamento Online (Self Check-in) pelo próprio participante
 * (via Conta Google logada, Credencial do Dispositivo ou E-mail + Telefone).
 *
 * @param {Object} checkInPayload Dados de validação de presença.
 * @returns {Object} Resultado da confirmação de presença e comprovante atualizado.
 */
function apiSubmitOnlineSelfCheckIn(checkInPayload) {
  const service = new InscriptionService();
  return service.performOnlineSelfCheckIn(checkInPayload);
}

/* ==========================================================================
 * ENDPOINTS RPC ADMINISTRATIVOS (PROTEGIDOS POR ADMIN_SECRET)
 * ========================================================================== */

/**
 * Valida a chave mestra (ADMIN_SECRET) e carrega os dados iniciais do painel administrativo.
 *
 * @param {string} adminSecret Segredo administrativo informado no modal de login.
 * @param {string} [filterEventoId='ALL'] Filtro de evento ('ALL' ou UUID).
 * @returns {Object} Pacote completo de dados administrativos.
 */
function apiAdminAuthenticateAndLoad(adminSecret, filterEventoId) {
  const adminService = new AdminService();
  return adminService.authenticateAndLoadDashboard(adminSecret, filterEventoId || 'ALL');
}

/**
 * Recarrega os indicadores, gráficos e tabelas do painel administrativo.
 *
 * @param {string} adminSecret Segredo administrativo.
 * @param {string} [filterEventoId='ALL'] Filtro de evento ('ALL' ou UUID).
 * @returns {Object} Dados consolidados do painel.
 */
function apiAdminGetDashboardData(adminSecret, filterEventoId) {
  const adminService = new AdminService();
  return adminService.getAdminDataBundle(adminSecret, filterEventoId || 'ALL');
}

/**
 * Cria ou edita uma reunião/convocação na tabela EVENTOS.
 *
 * @param {string} adminSecret Segredo administrativo.
 * @param {Object} eventPayload Dados da reunião.
 * @param {string} [currentFilterId='ALL'] Filtro atual do dashboard.
 * @returns {Object} Resultado da operação e dados atualizados do painel.
 */
function apiAdminSaveEvento(adminSecret, eventPayload, currentFilterId) {
  const adminService = new AdminService();
  const result = adminService.saveEvento(adminSecret, eventPayload);
  const bundle = adminService.getAdminDataBundle(adminSecret, currentFilterId || 'ALL');
  return { ...result, bundle };
}

/**
 * Altera o status de um evento (ATIVO | ENCERRADO).
 *
 * @param {string} adminSecret Segredo administrativo.
 * @param {string} idEvento UUID do evento.
 * @param {string} novoStatus Novo status ('ATIVO' | 'ENCERRADO').
 * @param {string} [currentFilterId='ALL'] Filtro atual do dashboard.
 * @returns {Object} Resultado e bundle atualizado.
 */
function apiAdminUpdateEventoStatus(adminSecret, idEvento, novoStatus, currentFilterId) {
  const adminService = new AdminService();
  const result = adminService.updateEventoStatus(adminSecret, idEvento, novoStatus);
  const bundle = adminService.getAdminDataBundle(adminSecret, currentFilterId || 'ALL');
  return { ...result, bundle };
}

/**
 * Exclui um evento e suas inscrições vinculadas.
 *
 * @param {string} adminSecret Segredo administrativo.
 * @param {string} idEvento UUID do evento.
 * @param {string} [currentFilterId='ALL'] Filtro atual do dashboard.
 * @returns {Object} Resultado e bundle atualizado.
 */
function apiAdminDeleteEvento(adminSecret, idEvento, currentFilterId) {
  const adminService = new AdminService();
  const result = adminService.deleteEvento(adminSecret, idEvento);
  const nextFilter =
    currentFilterId && currentFilterId.toLowerCase() === String(idEvento).toLowerCase()
      ? 'ALL'
      : currentFilterId || 'ALL';
  const bundle = adminService.getAdminDataBundle(adminSecret, nextFilter);
  return { ...result, bundle };
}

/**
 * Insere manualmente uma inscrição pelo painel administrativo.
 *
 * @param {string} adminSecret Segredo administrativo.
 * @param {Object} payload Dados do participante.
 * @param {string} [currentFilterId='ALL'] Filtro atual do dashboard.
 * @returns {Object} Resultado e bundle atualizado.
 */
function apiAdminCreateManualInscricao(adminSecret, payload, currentFilterId) {
  const adminService = new AdminService();
  const result = adminService.createManualInscricao(adminSecret, payload);
  const bundle = adminService.getAdminDataBundle(adminSecret, currentFilterId || 'ALL');
  return { ...result, bundle };
}

/**
 * Alterna manualmente a presença confirmada de uma inscrição.
 *
 * @param {string} adminSecret Segredo administrativo.
 * @param {string} idInscricao UUID da inscrição.
 * @param {boolean} presencaConfirmada Estado booleano desejado.
 * @param {string} [currentFilterId='ALL'] Filtro atual do dashboard.
 * @returns {Object} Resultado e bundle atualizado.
 */
function apiAdminSetPresencaManual(adminSecret, idInscricao, presencaConfirmada, currentFilterId) {
  const adminService = new AdminService();
  const result = adminService.setPresencaManual(adminSecret, idInscricao, presencaConfirmada);
  const bundle = adminService.getAdminDataBundle(adminSecret, currentFilterId || 'ALL');
  return { ...result, bundle };
}

/**
 * Remove manualmente uma inscrição pelo UUID.
 *
 * @param {string} adminSecret Segredo administrativo.
 * @param {string} idInscricao UUID da inscrição.
 * @param {string} [currentFilterId='ALL'] Filtro atual do dashboard.
 * @returns {Object} Resultado e bundle atualizado.
 */
function apiAdminDeleteInscricao(adminSecret, idInscricao, currentFilterId) {
  const adminService = new AdminService();
  const result = adminService.deleteInscricao(adminSecret, idInscricao);
  const bundle = adminService.getAdminDataBundle(adminSecret, currentFilterId || 'ALL');
  return { ...result, bundle };
}

/**
 * Processa o check-in por QR Code no Terminal de Recepção.
 *
 * @param {string} adminSecret Segredo administrativo.
 * @param {string} qrCodePayload Conteúdo decodificado do QR Code (UUID).
 * @param {string} [expectedEventoId='ALL'] Evento selecionado no terminal.
 * @param {string} [currentFilterId='ALL'] Filtro atual do dashboard.
 * @returns {Object} Resultado do check-in e bundle atualizado.
 */
function apiAdminProcessQrCheckIn(adminSecret, qrCodePayload, expectedEventoId, currentFilterId) {
  const adminService = new AdminService();
  const result = adminService.processQrCheckIn(
    adminSecret,
    qrCodePayload,
    expectedEventoId || 'ALL'
  );
  const bundle = adminService.getAdminDataBundle(adminSecret, currentFilterId || 'ALL');
  return { ...result, bundle };
}

/**
 * Função utilitária de provisionamento inicial (executável apenas no editor do Apps Script)
 * para garantir a criação das tabelas EVENTOS e INSCRICOES na planilha configurada.
 */
function initializeDatabaseTables() {
  const repository = new SheetsRepository();
  repository.ensureDatabaseSchema();
  Logger.log('Tabelas EVENTOS e INSCRICOES verificadas/criadas com sucesso.');
}
