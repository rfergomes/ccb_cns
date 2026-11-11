/**
 * @fileoverview Configurações globais de ambiente, constantes de domínio,
 * ativos institucionais (Logotipos CCB e CNS) e leitura segura de credenciais
 * via PropertiesService (Google Apps Script V8).
 *
 * Em conformidade com as diretrizes de segurança e LGPD (Lei nº 13.709/2018),
 * nenhuma chave sensível (SPREADSHEET_ID ou ADMIN_SECRET) é codificada no código-fonte.
 */

const Environment = (() => {
  /**
   * Chaves esperadas no PropertiesService.getScriptProperties()
   * @readonly
   * @enum {string}
   */
  const PROPERTY_KEYS = Object.freeze({
    SPREADSHEET_ID: 'SPREADSHEET_ID',
    ADMIN_SECRET: 'ADMIN_SECRET'
  });

  /**
   * Identificadores e URLs públicas dos logotipos institucionais no Google Drive.
   * - Logo CCB: https://drive.google.com/file/d/13etuen5crQ5e66EVMRJp4cHrYWRXsREM/view
   * - Logo CNS: https://drive.google.com/file/d/11cfotJKM6DCDD3HUk99kboHWLHG2v0ah/view
   */
  const LOGOS = Object.freeze({
    CCB_FILE_ID: '13etuen5crQ5e66EVMRJp4cHrYWRXsREM',
    CNS_FILE_ID: '11cfotJKM6DCDD3HUk99kboHWLHG2v0ah',
    CCB_PRIMARY_URL: 'https://lh3.googleusercontent.com/d/13etuen5crQ5e66EVMRJp4cHrYWRXsREM=w400',
    CCB_FALLBACK_URL: 'https://drive.google.com/thumbnail?id=13etuen5crQ5e66EVMRJp4cHrYWRXsREM&sz=w400',
    CNS_PRIMARY_URL: 'https://lh3.googleusercontent.com/d/11cfotJKM6DCDD3HUk99kboHWLHG2v0ah=w400',
    CNS_FALLBACK_URL: 'https://drive.google.com/thumbnail?id=11cfotJKM6DCDD3HUk99kboHWLHG2v0ah&sz=w400'
  });

  /**
   * Nomes das abas (tabelas) no Google Sheets e seus respectivos esquemas de colunas.
   */
  const TABLES = Object.freeze({
    EVENTOS: {
      NAME: 'EVENTOS',
      COLUMNS: Object.freeze([
        'ID_EVENTO',
        'TITULO',
        'DATA_EVENTO',
        'HORA_EVENTO',
        'HORA_LANCHE',
        'LOCAL',
        'STATUS',
        'LINK_MAPA',
        'COMPLEMENTO_LOCAL'
      ])
    },
    INSCRICOES: {
      NAME: 'INSCRICOES',
      COLUMNS: Object.freeze([
        'ID_INSCRICAO',
        'ID_EVENTO',
        'NOME_COMPLETO',
        'CIDADE',
        'FUNCAO',
        'EMAIL',
        'TELEFONE',
        'ACEITE_LGPD',
        'DATA_HORA_ACEITE',
        'PRESENCA_CONFIRMADA',
        'DATA_HORA_PRESENCA'
      ])
    },
    FUNCOES: {
      NAME: 'FUNCOES',
      COLUMNS: Object.freeze([
        'FUNCAO_ID',
        'FUNCAO',
        'TIPO',
        'ATIVO'
      ])
    }
  });

  /**
   * Status permitidos para eventos da CNS.
   * @readonly
   * @enum {string}
   */
  const EVENT_STATUS = Object.freeze({
    ATIVO: 'ATIVO',
    PREVISTO: 'PREVISTO',
    ENCERRADO: 'ENCERRADO'
  });

  /**
   * Lista oficial de Cidades / Grupos da Regional Campinas/SP (CNS).
   * @readonly
   * @type {ReadonlyArray<string>}
   */
  const CIDADES_REGIONAL_CAMPINAS = Object.freeze([
    'Campinas',
    'Cosmópolis',
    'Hortolândia',
    'Indaiatuba',
    'Monte Mor',
    'Nova Odessa',
    'Paulínia',
    'Sumaré',
    'Valinhos',
    'Vinhedo',
    'Negociadores'
  ]);

  /**
   * Papéis administrativos e ministeriais atuantes nas reuniões da CNS.
   * @readonly
   * @type {ReadonlyArray<string>}
   */
  const FUNCOES_CNS = Object.freeze([
    'Negociador de Suprimentos (CNS)',
    'Coordenador Regional CNS',
    'Membro da Administração',
    'Ancião / Ministério',
    'Diácono',
    'Cooperador do Ofício Ministerial',
    'Cooperador de Jovens e Menores',
    'Encarregado de Suprimentos / Compras',
    'Apoio Administrativo / Recepção',
    'Convidado / Outro'
  ]);

  /**
   * Classificações institucionais disponíveis para o cadastro de Funções / Ministérios.
   * @readonly
   * @type {ReadonlyArray<string>}
   */
  const TIPOS_FUNCAO = Object.freeze([
    'CNS / Suprimentos',
    'Ministério',
    'Administração / Estatutário',
    'Música',
    'Colaborador',
    'Outros'
  ]);

  /**
   * Catálogo padrão inicial populado automaticamente na primeira criação da aba FUNCOES.
   * Preserva integralmente as funções canônicas utilizadas na Agenda CNS.
   * @readonly
   * @type {ReadonlyArray<{FUNCAO_ID: string, FUNCAO: string, TIPO: string, ATIVO: boolean}>}
   */
  const FUNCOES_INICIAIS_CATALOGO = Object.freeze([
    { FUNCAO_ID: 'FUNC-1001', FUNCAO: 'Negociador de Suprimentos (CNS)', TIPO: 'CNS / Suprimentos', ATIVO: true },
    { FUNCAO_ID: 'FUNC-1002', FUNCAO: 'Coordenador Regional CNS', TIPO: 'CNS / Suprimentos', ATIVO: true },
    { FUNCAO_ID: 'FUNC-1003', FUNCAO: 'Membro da Administração', TIPO: 'Administração / Estatutário', ATIVO: true },
    { FUNCAO_ID: 'FUNC-1004', FUNCAO: 'Ancião / Ministério', TIPO: 'Ministério', ATIVO: true },
    { FUNCAO_ID: 'FUNC-1005', FUNCAO: 'Diácono', TIPO: 'Ministério', ATIVO: true },
    { FUNCAO_ID: 'FUNC-1006', FUNCAO: 'Cooperador do Ofício Ministerial', TIPO: 'Ministério', ATIVO: true },
    { FUNCAO_ID: 'FUNC-1007', FUNCAO: 'Cooperador de Jovens e Menores', TIPO: 'Ministério', ATIVO: true },
    { FUNCAO_ID: 'FUNC-1008', FUNCAO: 'Encarregado de Suprimentos / Compras', TIPO: 'CNS / Suprimentos', ATIVO: true },
    { FUNCAO_ID: 'FUNC-1009', FUNCAO: 'Apoio Administrativo / Recepção', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO_ID: 'FUNC-1010', FUNCAO: 'Convidado / Outro', TIPO: 'Outros', ATIVO: true }
  ]);

  /**
   * Catálogo complementar institucional CCB acionável sob demanda pelo Administrador ("Carga Institucional CCB").
   * @readonly
   * @type {ReadonlyArray<{FUNCAO: string, TIPO: string, ATIVO: boolean}>}
   */
  const FUNCOES_CARGA_INSTITUCIONAL = Object.freeze([
    { FUNCAO: 'Negociador de Suprimentos (CNS)', TIPO: 'CNS / Suprimentos', ATIVO: true },
    { FUNCAO: 'Coordenador Regional CNS', TIPO: 'CNS / Suprimentos', ATIVO: true },
    { FUNCAO: 'Encarregado de Suprimentos / Compras', TIPO: 'CNS / Suprimentos', ATIVO: true },
    { FUNCAO: 'Ancião / Ministério', TIPO: 'Ministério', ATIVO: true },
    { FUNCAO: 'Diácono', TIPO: 'Ministério', ATIVO: true },
    { FUNCAO: 'Cooperador do Ofício Ministerial', TIPO: 'Ministério', ATIVO: true },
    { FUNCAO: 'Cooperador de Jovens e Menores', TIPO: 'Ministério', ATIVO: true },
    { FUNCAO: 'Presidente', TIPO: 'Administração / Estatutário', ATIVO: true },
    { FUNCAO: 'Vice-Presidente', TIPO: 'Administração / Estatutário', ATIVO: true },
    { FUNCAO: 'Secretário', TIPO: 'Administração / Estatutário', ATIVO: true },
    { FUNCAO: 'Tesoureiro', TIPO: 'Administração / Estatutário', ATIVO: true },
    { FUNCAO: 'Membro do Conselho Fiscal', TIPO: 'Administração / Estatutário', ATIVO: true },
    { FUNCAO: 'Membro da Administração', TIPO: 'Administração / Estatutário', ATIVO: true },
    { FUNCAO: 'Encarregado Regional de Música', TIPO: 'Música', ATIVO: true },
    { FUNCAO: 'Encarregado Local de Música', TIPO: 'Música', ATIVO: true },
    { FUNCAO: 'Examinadora de Música', TIPO: 'Música', ATIVO: true },
    { FUNCAO: 'Instrutor(a) de Música', TIPO: 'Música', ATIVO: true },
    { FUNCAO: 'Organista', TIPO: 'Música', ATIVO: true },
    { FUNCAO: 'Músico', TIPO: 'Música', ATIVO: true },
    { FUNCAO: 'Auxiliar de Escrita', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO: 'Apoio Administrativo / Recepção', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO: 'Porteiro', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO: 'Som e Transmissão', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO: 'Auxiliar da Porta', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO: 'Tráfego e Estacionamento', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO: 'Apoio e Limpeza', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO: 'Manutenção Preventiva', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO: 'Engenheiro', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO: 'Advogado', TIPO: 'Colaborador', ATIVO: true },
    { FUNCAO: 'Convidado / Outro', TIPO: 'Outros', ATIVO: true }
  ]);

  /**
   * Obtém a instância de propriedades do script de maneira segura.
   * @returns {GoogleAppsScript.Properties.Properties}
   * @private
   */
  function getScriptProps_() {
    const props = PropertiesService.getScriptProperties();
    if (!props) {
      throw new Error('Serviço PropertiesService indisponível no contexto atual.');
    }
    return props;
  }

  /**
   * Obtém o ID da planilha banco de dados exclusivamente via ScriptProperties.
   * @returns {string} ID da planilha Google Sheets.
   * @throws {Error} Caso a propriedade SPREADSHEET_ID não esteja configurada.
   */
  function getSpreadsheetId() {
    const spreadsheetId = getScriptProps_().getProperty(PROPERTY_KEYS.SPREADSHEET_ID);
    if (!spreadsheetId || !spreadsheetId.trim()) {
      throw new Error(
        'Configuração ausente: A propriedade de script "SPREADSHEET_ID" não foi definida no PropertiesService.'
      );
    }
    return spreadsheetId.trim();
  }

  /**
   * Obtém a chave mestra administrativa exclusivamente via ScriptProperties.
   * @returns {string} Segredo administrativo configurado.
   * @throws {Error} Caso a propriedade ADMIN_SECRET não esteja configurada.
   */
  function getAdminSecret() {
    const adminSecret = getScriptProps_().getProperty(PROPERTY_KEYS.ADMIN_SECRET);
    if (!adminSecret || !adminSecret.trim()) {
      throw new Error(
        'Configuração ausente: A propriedade de script "ADMIN_SECRET" não foi definida no PropertiesService.'
      );
    }
    return adminSecret.trim();
  }

  /**
   * Retorna o fuso horário canônico da aplicação.
   * @returns {string} Timezone IANA (America/Sao_Paulo).
   */
  function getTimeZone() {
    try {
      return Session.getScriptTimeZone() || 'America/Sao_Paulo';
    } catch (_) {
      return 'America/Sao_Paulo';
    }
  }

  /**
   * Tenta obter o endereço de e-mail da conta Google ativa na sessão do navegador,
   * caso o ambiente e as permissões de execução do Apps Script permitam a identificação.
   * @returns {string} E-mail em letras minúsculas ou string vazia se anônimo/indisponível.
   */
  function getActiveGoogleUserEmail() {
    try {
      if (typeof Session !== 'undefined' && Session.getActiveUser) {
        const email = Session.getActiveUser().getEmail();
        if (email && typeof email === 'string' && email.includes('@')) {
          return email.trim().toLowerCase();
        }
      }
    } catch (_) {
      // Em execuções ANYONE_ANONYMOUS sem escopo de identidade, retorna vazio silenciosamente
    }
    return '';
  }

  /**
   * Obtém a URL pública de publicação do Web App no Google Apps Script.
   * @returns {string} URL do serviço ou string vazia.
   */
  function getWebAppUrl() {
    try {
      if (typeof ScriptApp !== 'undefined' && ScriptApp.getService) {
        return ScriptApp.getService().getUrl() || '';
      }
    } catch (_) {
      // Ignora em contexto sem ScriptApp
    }
    return '';
  }

  /**
   * Retorna metadados públicos de configuração para hidratação do frontend.
   * Jamais expõe SPREADSHEET_ID ou ADMIN_SECRET.
   * @returns {Object} Metadados públicos.
   */
  function getPublicMetadata() {
    let serverNowIso = '';
    try {
      serverNowIso = Utilities.formatDate(new Date(), getTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
    } catch (_) {
      serverNowIso = new Date().toISOString();
    }

    return {
      appName: 'Agenda CNS',
      regional: 'Regional Campinas/SP',
      entidade: 'Congregação Cristã no Brasil (CCB)',
      comissao: 'Comissão de Negociadores de Suprimentos (CNS)',
      cidades: CIDADES_REGIONAL_CAMPINAS,
      funcoes: FUNCOES_CNS,
      tiposFuncao: TIPOS_FUNCAO,
      statusEventos: EVENT_STATUS,
      logos: LOGOS,
      webAppUrl: getWebAppUrl(),
      detectedGoogleEmail: getActiveGoogleUserEmail(),
      timeZone: getTimeZone(),
      serverNowIso
    };
  }

  return Object.freeze({
    PROPERTY_KEYS,
    LOGOS,
    TABLES,
    EVENT_STATUS,
    CIDADES_REGIONAL_CAMPINAS,
    FUNCOES_CNS,
    TIPOS_FUNCAO,
    FUNCOES_INICIAIS_CATALOGO,
    FUNCOES_CARGA_INSTITUCIONAL,
    getSpreadsheetId,
    getAdminSecret,
    getTimeZone,
    getActiveGoogleUserEmail,
    getWebAppUrl,
    getPublicMetadata
  });
})();
