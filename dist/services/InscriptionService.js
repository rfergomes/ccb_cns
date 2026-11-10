/**
 * @fileoverview Serviço de domínio responsável pelas regras de negócio do Portal Público
 * e do Auto-Credenciamento Online (Self Check-in pelo participante):
 * consulta de convocações ativas, validação estrita dos campos obrigatórios (incluindo
 * E-mail e Telefone), conformidade com a LGPD (Lei nº 13.709/2018), emissão do comprovante
 * QR Code individual e confirmação de presença online via Conta Google ou E-mail + Telefone.
 */

class InscriptionService {
  /**
   * @param {SheetsRepository} [repository] Instância do repositório tabular.
   */
  constructor(repository) {
    /** @private @type {SheetsRepository} */
    this.repository_ = repository || new SheetsRepository();
  }

  /**
   * Obtém o estado do Portal Público e de Auto-Credenciamento.
   * Verifica se há evento com status ATIVO e cuja data seja igual ou posterior ao dia de hoje.
   * Se `preferredEventoId` for informado na URL (ex: link exclusivo do QR Code do evento),
   * seleciona prioritariamente esse evento caso esteja ativo.
   * Também verifica se há uma Conta Google logada na sessão que já possua inscrição no evento ativo.
   *
   * @param {string} [preferredEventoId] UUID opcional do evento vindo da URL (?view=checkin&evento=UUID).
   * @returns {{
   *   hasActiveEvent: boolean,
   *   activeEvent: Object|null,
   *   activeEvents: Array<Object>,
   *   googleSessionMatch: Object|null,
   *   metadata: Object
   * }}
   */
  getPortalState(preferredEventoId = '') {
    this.repository_.ensureDatabaseSchema();

    const today = SecurityUtils.getTodayDateString();
    const allEventos = this.repository_.findAllEventos();

    const activeEvents = allEventos
      .filter((evento) => {
        const isAtivo = evento.STATUS === Environment.EVENT_STATUS.ATIVO;
        const isCurrentOrFuture = Boolean(evento.DATA_EVENTO) && evento.DATA_EVENTO >= today;
        return isAtivo && isCurrentOrFuture;
      })
      .sort((a, b) => {
        const cmpDate = a.DATA_EVENTO.localeCompare(b.DATA_EVENTO);
        if (cmpDate !== 0) return cmpDate;
        return (a.HORA_EVENTO || '').localeCompare(b.HORA_EVENTO || '');
      });

    let selectedEvent = activeEvents.length > 0 ? activeEvents[0] : null;
    if (preferredEventoId && SecurityUtils.isValidUuid(preferredEventoId)) {
      const targetId = preferredEventoId.trim().toLowerCase();
      const found = activeEvents.find((ev) => ev.ID_EVENTO.toLowerCase() === targetId);
      if (found) {
        selectedEvent = found;
      }
    }

    const metadata = Environment.getPublicMetadata();
    let googleSessionMatch = null;

    if (selectedEvent && metadata.detectedGoogleEmail) {
      const inscricoesEvento = this.repository_.findInscricoesByEventoId(selectedEvent.ID_EVENTO);
      const match = inscricoesEvento.find(
        (ins) =>
          ins.EMAIL &&
          ins.EMAIL.trim().toLowerCase() === metadata.detectedGoogleEmail.toLowerCase()
      );
      if (match) {
        googleSessionMatch = {
          ID_INSCRICAO: match.ID_INSCRICAO,
          ID_EVENTO: match.ID_EVENTO,
          NOME_COMPLETO: match.NOME_COMPLETO,
          CIDADE: match.CIDADE,
          FUNCAO: match.FUNCAO,
          EMAIL_MASKED: SecurityUtils.maskEmailForDisplay(match.EMAIL),
          PRESENCA_CONFIRMADA: match.PRESENCA_CONFIRMADA,
          DATA_HORA_PRESENCA: match.DATA_HORA_PRESENCA
        };
      }
    }

    return {
      hasActiveEvent: activeEvents.length > 0,
      activeEvent: selectedEvent,
      activeEvents,
      googleSessionMatch,
      metadata
    };
  }

  /**
   * Valida os dados de entrada de uma inscrição conforme regras da CNS e LGPD.
   * Todos os campos (Nome Completo, Cidade, Função, E-mail, Telefone e Aceite LGPD) são obrigatórios.
   *
   * @param {Object} payload Dados brutos recebidos do formulário.
   * @param {Object} options Opções adicionais (ex: { allowClosedEvent: false }).
   * @returns {Object} Dados higienizados e prontos para persistência.
   * @throws {Error} Caso alguma regra de validação falhe.
   */
  validateAndNormalizePayload(payload, options = { allowClosedEvent: false }) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Dados de inscrição não fornecidos.');
    }

    const idEvento = String(payload.ID_EVENTO || payload.idEvento || '').trim();
    if (!SecurityUtils.isValidUuid(idEvento)) {
      throw new Error('Reunião / Convocação inválida ou não selecionada.');
    }

    const evento = this.repository_.findEventoById(idEvento);
    if (!evento) {
      throw new Error('A reunião selecionada não foi encontrada na base de dados.');
    }

    if (!options.allowClosedEvent) {
      const today = SecurityUtils.getTodayDateString();
      if (evento.STATUS !== Environment.EVENT_STATUS.ATIVO || evento.DATA_EVENTO < today) {
        throw new Error('As inscrições para esta convocação já se encontram encerradas.');
      }
    }

    const nomeCompleto = SecurityUtils.sanitizeText(
      payload.NOME_COMPLETO || payload.nomeCompleto,
      150
    );
    if (!nomeCompleto || nomeCompleto.length < 3) {
      throw new Error('O campo "Nome Completo" é obrigatório (mínimo de 3 caracteres).');
    }

    const cidade = SecurityUtils.sanitizeText(payload.CIDADE || payload.cidade, 80);
    if (!cidade) {
      throw new Error('O campo "Cidade" é obrigatório.');
    }
    if (!Environment.CIDADES_REGIONAL_CAMPINAS.includes(cidade)) {
      throw new Error(
        `A cidade selecionada ("${cidade}") não pertence à relação oficial da Regional Campinas.`
      );
    }

    const funcao = SecurityUtils.sanitizeText(payload.FUNCAO || payload.funcao, 120);
    if (!funcao) {
      throw new Error('O campo "Função / Ministério" é obrigatório.');
    }
    if (!Environment.FUNCOES_CNS.includes(funcao)) {
      throw new Error('A Função / Ministério informada não é válida.');
    }

    // Pelo menos um contato (E-mail ou Telefone) é obrigatório para identificação e auto-credenciamento
    const email = SecurityUtils.sanitizeEmail(payload.EMAIL || payload.email || '', false);
    const telefone = SecurityUtils.sanitizePhone(payload.TELEFONE || payload.telefone || '', false);

    if (!email && !telefone) {
      throw new Error(
        'Informe pelo menos um dado de contato (E-mail ou Telefone/Celular) para identificação e credenciamento.'
      );
    }

    const aceiteLgpd = SecurityUtils.parseBoolean(
      payload.ACEITE_LGPD !== undefined ? payload.ACEITE_LGPD : payload.aceiteLgpd
    );
    if (!aceiteLgpd) {
      throw new Error(
        'É obrigatório o consentimento expresso com o Termo de Privacidade (LGPD - Lei nº 13.709/2018) para prosseguir com o credenciamento.'
      );
    }

    return {
      evento,
      normalized: {
        ID_EVENTO: evento.ID_EVENTO,
        NOME_COMPLETO: nomeCompleto,
        CIDADE: cidade,
        FUNCAO: funcao,
        EMAIL: email,
        TELEFONE: telefone,
        ACEITE_LGPD: true,
        DATA_HORA_ACEITE: SecurityUtils.getCurrentIsoTimestamp(),
        PRESENCA_CONFIRMADA: false,
        DATA_HORA_PRESENCA: ''
      }
    };
  }

  /**
   * Registra a inscrição de um participante em uma convocação ativa pelo Portal Público.
   * Caso o mesmo participante (mesmo E-mail ou mesmo Nome Completo + Cidade) já esteja inscrito
   * no evento, atualiza os dados e retorna a inscrição existente mantendo o UUID original.
   *
   * @param {Object} payload Dados do formulário público.
   * @returns {{success: boolean, isDuplicate: boolean, message: string, inscricao: Object, evento: Object, qrPayload: string}}
   */
  registerPublicInscription(payload) {
    this.repository_.ensureDatabaseSchema();

    const { evento, normalized } = this.validateAndNormalizePayload(payload, {
      allowClosedEvent: false
    });

    const autoCheckInNow = SecurityUtils.parseBoolean(payload.AUTO_CHECKIN_NOW);
    if (autoCheckInNow) {
      normalized.PRESENCA_CONFIRMADA = true;
      normalized.DATA_HORA_PRESENCA = SecurityUtils.getCurrentIsoTimestamp();
    }

    const existingInscricoes = this.repository_.findInscricoesByEventoId(evento.ID_EVENTO);
    const duplicate = existingInscricoes.find(
      (ins) =>
        (ins.EMAIL && ins.EMAIL.toLowerCase() === normalized.EMAIL.toLowerCase()) ||
        (ins.NOME_COMPLETO.toLowerCase() === normalized.NOME_COMPLETO.toLowerCase() &&
          ins.CIDADE.toLowerCase() === normalized.CIDADE.toLowerCase())
    );

    let persistedInscricao;
    let isDuplicate = false;

    if (duplicate) {
      isDuplicate = true;
      const updates = {
        NOME_COMPLETO: normalized.NOME_COMPLETO,
        CIDADE: normalized.CIDADE,
        FUNCAO: normalized.FUNCAO,
        EMAIL: normalized.EMAIL,
        TELEFONE: normalized.TELEFONE,
        ACEITE_LGPD: true
      };
      if (autoCheckInNow && !duplicate.PRESENCA_CONFIRMADA) {
        updates.PRESENCA_CONFIRMADA = true;
        updates.DATA_HORA_PRESENCA = SecurityUtils.getCurrentIsoTimestamp();
      }
      persistedInscricao = this.repository_.updateInscricaoById(duplicate.ID_INSCRICAO, updates);
    } else {
      persistedInscricao = this.repository_.insertInscricao(normalized);
    }

    return {
      success: true,
      isDuplicate,
      message: isDuplicate
        ? 'Inscrição já localizada para esta convocação. Seu comprovante e QR Code foram atualizados e recuperados com sucesso.'
        : autoCheckInNow
        ? 'Inscrição e presença confirmadas com sucesso!'
        : 'Inscrição realizada com sucesso! Seu comprovante QR Code foi gerado.',
      inscricao: persistedInscricao,
      evento,
      qrPayload: persistedInscricao.ID_INSCRICAO
    };
  }

  /**
   * Verifica se o participante possui elegibilidade de Auto-Credenciamento rápido
   * naquele evento ativo, seja por Conta Google logada na sessão, seja por token UUID
   * salvo no navegador do seu dispositivo no momento da inscrição.
   *
   * @param {string} idEvento UUID do evento ativo.
   * @param {string} [deviceSavedUuid] UUID de inscrição salvo no localStorage do aparelho.
   * @returns {{found: boolean, source: string, candidate: Object|null}}
   */
  checkParticipantAutoMatch(idEvento, deviceSavedUuid = '') {
    this.repository_.ensureDatabaseSchema();

    if (!SecurityUtils.isValidUuid(idEvento)) {
      return { found: false, source: 'NONE', candidate: null };
    }

    const inscricoes = this.repository_.findInscricoesByEventoId(idEvento);

    // 1. Prioridade: Conta Google ativa na sessão do navegador (Session.getActiveUser)
    const googleEmail = Environment.getActiveGoogleUserEmail();
    if (googleEmail) {
      const byGoogle = inscricoes.find(
        (ins) => ins.EMAIL && ins.EMAIL.trim().toLowerCase() === googleEmail.toLowerCase()
      );
      if (byGoogle) {
        return {
          found: true,
          source: 'GOOGLE_ACCOUNT',
          candidate: {
            ID_INSCRICAO: byGoogle.ID_INSCRICAO,
            ID_EVENTO: byGoogle.ID_EVENTO,
            NOME_COMPLETO: byGoogle.NOME_COMPLETO,
            CIDADE: byGoogle.CIDADE,
            FUNCAO: byGoogle.FUNCAO,
            EMAIL_MASKED: SecurityUtils.maskEmailForDisplay(byGoogle.EMAIL),
            PRESENCA_CONFIRMADA: byGoogle.PRESENCA_CONFIRMADA,
            DATA_HORA_PRESENCA: byGoogle.DATA_HORA_PRESENCA
          }
        };
      }
    }

    // 2. Fallback automático: Credencial UUID emitida e salva neste mesmo dispositivo
    if (deviceSavedUuid && SecurityUtils.isValidUuid(deviceSavedUuid)) {
      const targetUuid = deviceSavedUuid.trim().toLowerCase();
      const byDevice = inscricoes.find((ins) => ins.ID_INSCRICAO.toLowerCase() === targetUuid);
      if (byDevice) {
        return {
          found: true,
          source: 'DEVICE_CREDENTIAL',
          candidate: {
            ID_INSCRICAO: byDevice.ID_INSCRICAO,
            ID_EVENTO: byDevice.ID_EVENTO,
            NOME_COMPLETO: byDevice.NOME_COMPLETO,
            CIDADE: byDevice.CIDADE,
            FUNCAO: byDevice.FUNCAO,
            EMAIL_MASKED: SecurityUtils.maskEmailForDisplay(byDevice.EMAIL),
            PRESENCA_CONFIRMADA: byDevice.PRESENCA_CONFIRMADA,
            DATA_HORA_PRESENCA: byDevice.DATA_HORA_PRESENCA
          }
        };
      }
    }

    return { found: false, source: 'NONE', candidate: null };
  }

  /**
   * Realiza o Auto-Credenciamento Online (Self Check-in) pelo próprio participante
   * ao escanear o QR Code do evento ou acessar o link exclusivo da reunião ativa.
   *
   * Suporta:
   * - Confirmação automática via Conta Google logada (`method = 'GOOGLE_ACCOUNT'`)
   * - Confirmação via credencial salva no aparelho (`method = 'DEVICE_CREDENTIAL'`)
   * - Confirmação segura por dupla validação: E-mail de inscrição + Telefone/Celular (`method = 'EMAIL_PHONE'`)
   *
   * @param {Object} checkInPayload Dados de validação enviados pelo participante.
   * @returns {{
   *   success: boolean,
   *   alreadyCheckedIn: boolean,
   *   message: string,
   *   inscricao: Object,
   *   evento: Object,
   *   qrPayload: string
   * }}
   */
  performOnlineSelfCheckIn(checkInPayload) {
    this.repository_.ensureDatabaseSchema();

    if (!checkInPayload || typeof checkInPayload !== 'object') {
      throw new Error('Dados de credenciamento online não informados.');
    }

    const idEvento = String(checkInPayload.ID_EVENTO || checkInPayload.idEvento || '').trim();
    if (!SecurityUtils.isValidUuid(idEvento)) {
      throw new Error('Nenhuma convocação ativa selecionada para o credenciamento.');
    }

    const evento = this.repository_.findEventoById(idEvento);
    if (!evento) {
      throw new Error('A reunião informada não foi localizada.');
    }

    const today = SecurityUtils.getTodayDateString();
    if (evento.STATUS !== Environment.EVENT_STATUS.ATIVO || evento.DATA_EVENTO < today) {
      throw new Error('O credenciamento online para esta reunião encontra-se encerrado.');
    }

    const inscricoesEvento = this.repository_.findInscricoesByEventoId(evento.ID_EVENTO);
    if (inscricoesEvento.length === 0) {
      throw new Error(
        'Ainda não existem inscrições registradas para esta reunião. Realize sua inscrição primeiro.'
      );
    }

    const method = String(checkInPayload.METHOD || checkInPayload.method || 'EMAIL_PHONE')
      .trim()
      .toUpperCase();

    let matchedInscricao = null;

    if (method === 'GOOGLE_ACCOUNT') {
      const activeEmail = Environment.getActiveGoogleUserEmail();
      if (!activeEmail) {
        throw new Error(
          'Sua conta Google não pôde ser detectada automaticamente. Utilize a confirmação por E-mail e Telefone.'
        );
      }
      matchedInscricao = inscricoesEvento.find(
        (ins) => ins.EMAIL && ins.EMAIL.trim().toLowerCase() === activeEmail.toLowerCase()
      );
      if (!matchedInscricao) {
        throw new Error(
          `Nenhuma inscrição encontrada nesta reunião para a conta Google "${activeEmail}". Confirme informando o e-mail e telefone utilizados na inscrição.`
        );
      }
    } else if (method === 'DEVICE_CREDENTIAL') {
      const idInscricao = String(
        checkInPayload.ID_INSCRICAO || checkInPayload.idInscricao || ''
      ).trim();
      if (!SecurityUtils.isValidUuid(idInscricao)) {
        throw new Error('Credencial local inválida. Utilize a confirmação por E-mail e Telefone.');
      }
      matchedInscricao = inscricoesEvento.find(
        (ins) => ins.ID_INSCRICAO.toLowerCase() === idInscricao.toLowerCase()
      );
      if (!matchedInscricao) {
        throw new Error(
          'Credencial não localizada para esta reunião. Utilize a confirmação por E-mail e Telefone.'
        );
      }
    } else {
      // Validação flexível: E-mail OU Telefone (pelo menos um campo deve ser preenchido)
      const rawEmail = String(checkInPayload.EMAIL || checkInPayload.email || '')
        .trim()
        .toLowerCase();
      const rawPhone = String(checkInPayload.TELEFONE || checkInPayload.telefone || '').trim();
      const phoneDigits = SecurityUtils.extractPhoneDigits(rawPhone);

      if (!rawEmail && !phoneDigits) {
        throw new Error(
          'Informe pelo menos um dos campos (E-mail ou Telefone da inscrição) para confirmar sua presença.'
        );
      }

      if (rawEmail && !rawEmail.includes('@')) {
        throw new Error('O endereço de e-mail informado possui um formato inválido.');
      }

      if (rawPhone && phoneDigits.length < 4) {
        throw new Error(
          'Informe o telefone completo ou ao menos os 4 últimos dígitos do celular.'
        );
      }

      // Caso tenha informado E-mail e Telefone simultaneamente
      if (rawEmail && phoneDigits) {
        const candidateByEmail = inscricoesEvento.find(
          (ins) => ins.EMAIL && ins.EMAIL.trim().toLowerCase() === rawEmail
        );
        if (!candidateByEmail) {
          throw new Error(
            'Não foi encontrada inscrição para este endereço de e-mail na reunião ativa.'
          );
        }
        if (
          candidateByEmail.TELEFONE &&
          !SecurityUtils.matchesPhoneVerification(candidateByEmail.TELEFONE, rawPhone)
        ) {
          throw new Error(
            'O telefone informado não confere com o cadastro deste e-mail.'
          );
        }
        matchedInscricao = candidateByEmail;
      } else if (rawEmail) {
        // Informou apenas o E-mail
        matchedInscricao = inscricoesEvento.find(
          (ins) => ins.EMAIL && ins.EMAIL.trim().toLowerCase() === rawEmail
        );
        if (!matchedInscricao) {
          throw new Error(
            'Não foi encontrada inscrição para este endereço de e-mail na reunião ativa. Verifique a digitação ou tente pelo Telefone.'
          );
        }
      } else {
        // Informou apenas o Telefone
        matchedInscricao = inscricoesEvento.find(
          (ins) =>
            ins.TELEFONE && SecurityUtils.matchesPhoneVerification(ins.TELEFONE, rawPhone)
        );
        if (!matchedInscricao) {
          throw new Error(
            'Não foi encontrada inscrição para este número de telefone na reunião ativa. Verifique os dígitos ou tente pelo E-mail.'
          );
        }
      }
    }

    if (matchedInscricao.PRESENCA_CONFIRMADA) {
      return {
        success: true,
        alreadyCheckedIn: true,
        message: `Sua presença já está confirmada nesta reunião desde ${matchedInscricao.DATA_HORA_PRESENCA}.`,
        inscricao: matchedInscricao,
        evento,
        qrPayload: matchedInscricao.ID_INSCRICAO
      };
    }

    const updated = this.repository_.updateInscricaoById(matchedInscricao.ID_INSCRICAO, {
      PRESENCA_CONFIRMADA: true,
      DATA_HORA_PRESENCA: SecurityUtils.getCurrentIsoTimestamp()
    });

    return {
      success: true,
      alreadyCheckedIn: false,
      message: `A Paz de Deus, ${updated.NOME_COMPLETO}! Sua presença foi confirmada com sucesso no evento.`,
      inscricao: updated,
      evento,
      qrPayload: updated.ID_INSCRICAO
    };
  }
}
