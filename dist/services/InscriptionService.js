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
   * Se `credentialUuid` for informado na URL (?view=portal&credencial=UUID), carrega o comprovante
   * individual com QR Code para exibição direta (ex: link aberto pelo WhatsApp do participante).
   * Também verifica se há uma Conta Google logada na sessão que já possua inscrição no evento ativo.
   *
   * @param {string} [preferredEventoId] UUID opcional do evento vindo da URL (?view=checkin&evento=UUID).
   * @param {string} [credentialUuid] UUID opcional da inscrição vindo da URL (?view=portal&credencial=UUID).
   * @returns {{
   *   hasActiveEvent: boolean,
   *   activeEvent: Object|null,
   *   activeEvents: Array<Object>,
   *   googleSessionMatch: Object|null,
   *   initialVoucher: Object|null,
   *   metadata: Object
   * }}
   */
  getPortalState(preferredEventoId = '', credentialUuid = '') {
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
      })
      .map((evento) => ({
        ...evento,
        CHECKIN_WINDOW: SecurityUtils.evaluateCheckInWindow(
          evento.DATA_EVENTO,
          evento.HORA_EVENTO,
          60
        )
      }));

    const upcomingEvents = allEventos
      .filter((evento) => {
        const isPrevisto = evento.STATUS === Environment.EVENT_STATUS.PREVISTO;
        const isCurrentOrFuture = Boolean(evento.DATA_EVENTO) && evento.DATA_EVENTO >= today;
        return isPrevisto && isCurrentOrFuture;
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

    let initialVoucher = null;
    if (credentialUuid && SecurityUtils.isValidUuid(credentialUuid)) {
      initialVoucher = this.getVoucherById(credentialUuid);
    }

    const metadata = {
      ...Environment.getPublicMetadata(),
      funcoes: this.repository_.findActiveFuncaoNames()
    };
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
      upcomingEvents,
      googleSessionMatch,
      initialVoucher,
      metadata
    };
  }

  /**
   * Remove dados pessoais sensíveis em texto puro (e-mail e telefone) de retornos públicos
   * por UUID/consulta aberta, expondo apenas versões mascaradas conforme LGPD.
   *
   * @param {Object} inscricao Objeto completo da inscrição.
   * @returns {Object} Projeção segura para exibição pública.
   * @private
   */
  sanitizeInscricaoForPublicDisplay_(inscricao) {
    if (!inscricao) return null;
    return {
      ...inscricao,
      EMAIL: '',
      TELEFONE: '',
      EMAIL_MASKED: SecurityUtils.maskEmailForDisplay(inscricao.EMAIL),
      TELEFONE_MASKED: SecurityUtils.maskPhoneForDisplay(inscricao.TELEFONE),
      HAS_TELEFONE: Boolean(inscricao.TELEFONE)
    };
  }

  /**
   * Localiza possível inscrição duplicada para o mesmo evento comparando E-mail,
   * dígitos do Telefone (quando >= 10 dígitos) ou Nome Completo + Cidade.
   *
   * @param {Array<Object>} existingInscricoes Lista de inscrições do evento.
   * @param {Object} normalized Dados normalizados da inscrição candidata.
   * @returns {Object|null} Inscrição existente ou null.
   */
  findDuplicateInscricao(existingInscricoes, normalized) {
    if (!Array.isArray(existingInscricoes) || !normalized) return null;

    const targetEmail = String(normalized.EMAIL || '').trim().toLowerCase();
    const targetPhoneDigits = SecurityUtils.extractPhoneDigits(normalized.TELEFONE || '');
    const targetName = String(normalized.NOME_COMPLETO || '').trim().toLowerCase();
    const targetCity = String(normalized.CIDADE || '').trim().toLowerCase();

    return (
      existingInscricoes.find((ins) => {
        const insEmail = String(ins.EMAIL || '').trim().toLowerCase();
        if (targetEmail && insEmail && insEmail === targetEmail) {
          return true;
        }
        const insPhoneDigits = SecurityUtils.extractPhoneDigits(ins.TELEFONE || '');
        if (targetPhoneDigits.length >= 10 && insPhoneDigits.length >= 10 && insPhoneDigits === targetPhoneDigits) {
          return true;
        }
        return (
          targetName &&
          targetCity &&
          String(ins.NOME_COMPLETO || '').trim().toLowerCase() === targetName &&
          String(ins.CIDADE || '').trim().toLowerCase() === targetCity
        );
      }) || null
    );
  }

  /**
   * Recupera os dados do comprovante e QR Code de uma inscrição pelo seu UUID.
   * Por segurança LGPD, e-mail e telefone completos não são expostos em rotas públicas.
   *
   * @param {string} idInscricao UUID da inscrição.
   * @returns {Object|null} Dados do comprovante para renderização do QR Code ou null se não encontrado.
   */
  getVoucherById(idInscricao) {
    this.repository_.ensureDatabaseSchema();
    const cleanId = String(idInscricao || '').trim();
    if (!SecurityUtils.isValidUuid(cleanId)) {
      return null;
    }
    const inscricao = this.repository_.findInscricaoById(cleanId);
    if (!inscricao) {
      return null;
    }
    const rawEvento = this.repository_.findEventoById(inscricao.ID_EVENTO);
    const evento = rawEvento
      ? {
          ...rawEvento,
          CHECKIN_WINDOW: SecurityUtils.evaluateCheckInWindow(
            rawEvento.DATA_EVENTO,
            rawEvento.HORA_EVENTO,
            60
          )
        }
      : null;

    return {
      success: true,
      isDuplicate: false,
      message: 'Comprovante individual e QR Code carregados com sucesso.',
      inscricao: this.sanitizeInscricaoForPublicDisplay_(inscricao),
      evento,
      qrPayload: inscricao.ID_INSCRICAO
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

    const funcaoInput = SecurityUtils.sanitizeText(payload.FUNCAO || payload.funcao, 120);
    if (!funcaoInput) {
      throw new Error('O campo "Função / Ministério" é obrigatório.');
    }

    const allFuncoes = this.repository_.findAllFuncoes();
    const allowInactive = Boolean(options.allowClosedEvent);
    const candidatePool =
      allFuncoes.length > 0
        ? allFuncoes
            .filter((f) => allowInactive || f.ATIVO)
            .map((f) => f.FUNCAO)
        : Array.from(Environment.FUNCOES_CNS);

    const normInput = SecurityUtils.normalizeSearchText(funcaoInput);
    const matchedFuncao = candidatePool.find(
      (fnName) => SecurityUtils.normalizeSearchText(fnName) === normInput
    );
    if (!matchedFuncao) {
      throw new Error('A Função / Ministério informada não é válida ou não está ativa.');
    }
    const funcao = matchedFuncao;

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

    const windowStatus = SecurityUtils.evaluateCheckInWindow(
      evento.DATA_EVENTO,
      evento.HORA_EVENTO,
      60
    );
    const autoCheckInNow =
      SecurityUtils.parseBoolean(payload.AUTO_CHECKIN_NOW) && windowStatus.isOpen;
    if (autoCheckInNow) {
      normalized.PRESENCA_CONFIRMADA = true;
      normalized.DATA_HORA_PRESENCA = SecurityUtils.getCurrentIsoTimestamp();
    }

    const txResult = this.repository_.runInTransaction(() => {
      const existingInscricoes = this.repository_.findInscricoesByEventoId(evento.ID_EVENTO);
      const duplicate = this.findDuplicateInscricao(existingInscricoes, normalized);

      if (duplicate) {
        const updates = {
          NOME_COMPLETO: normalized.NOME_COMPLETO,
          CIDADE: normalized.CIDADE,
          FUNCAO: normalized.FUNCAO,
          EMAIL: normalized.EMAIL || duplicate.EMAIL,
          TELEFONE: normalized.TELEFONE || duplicate.TELEFONE,
          ACEITE_LGPD: true
        };
        if (autoCheckInNow && !duplicate.PRESENCA_CONFIRMADA) {
          updates.PRESENCA_CONFIRMADA = true;
          updates.DATA_HORA_PRESENCA = SecurityUtils.getCurrentIsoTimestamp();
        }
        return {
          isDuplicate: true,
          inscricao: this.repository_.updateInscricaoById(duplicate.ID_INSCRICAO, updates)
        };
      }

      return {
        isDuplicate: false,
        inscricao: this.repository_.insertInscricao(normalized)
      };
    });

    return {
      success: true,
      isDuplicate: txResult.isDuplicate,
      message: txResult.isDuplicate
        ? 'Inscrição já localizada para esta convocação. Seu comprovante e QR Code foram atualizados e recuperados com sucesso.'
        : autoCheckInNow
        ? 'Inscrição e presença confirmadas com sucesso!'
        : 'Inscrição realizada com sucesso! Seu comprovante QR Code foi gerado.',
      inscricao: txResult.inscricao,
      evento,
      qrPayload: txResult.inscricao.ID_INSCRICAO
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

    const windowStatus = SecurityUtils.evaluateCheckInWindow(
      evento.DATA_EVENTO,
      evento.HORA_EVENTO,
      60
    );
    if (!windowStatus.isOpen) {
      throw new Error(windowStatus.lockMessage);
    }

    const inscricoesEvento = this.repository_.findInscricoesByEventoId(evento.ID_EVENTO);
    if (inscricoesEvento.length === 0) {
      throw new Error(
        'Ainda não existem inscrições registradas para esta reunião. Realize sua inscrição primeiro.'
      );
    }

    const method = String(checkInPayload.METHOD || checkInPayload.method || 'PHONE')
      .trim()
      .toUpperCase();

    let matchedInscricao = null;

    if (method === 'GOOGLE_ACCOUNT') {
      const activeEmail = Environment.getActiveGoogleUserEmail();
      if (!activeEmail) {
        throw new Error(
          'Sua conta Google não pôde ser detectada automaticamente. Utilize a confirmação pelo Telefone cadastrado.'
        );
      }
      matchedInscricao = inscricoesEvento.find(
        (ins) => ins.EMAIL && ins.EMAIL.trim().toLowerCase() === activeEmail.toLowerCase()
      );
      if (!matchedInscricao) {
        throw new Error(
          `Nenhuma inscrição encontrada nesta reunião para a conta Google "${activeEmail}". Confirme informando o telefone utilizado na inscrição.`
        );
      }
    } else if (method === 'DEVICE_CREDENTIAL') {
      const idInscricao = String(
        checkInPayload.ID_INSCRICAO || checkInPayload.idInscricao || ''
      ).trim();
      if (!SecurityUtils.isValidUuid(idInscricao)) {
        throw new Error('Credencial local inválida. Utilize a confirmação pelo Telefone cadastrado.');
      }
      matchedInscricao = inscricoesEvento.find(
        (ins) => ins.ID_INSCRICAO.toLowerCase() === idInscricao.toLowerCase()
      );
      if (!matchedInscricao) {
        throw new Error(
          'Credencial não localizada para esta reunião. Utilize a confirmação pelo Telefone cadastrado.'
        );
      }
    } else {
      // Check-in manual exclusivamente por Telefone higienizado com DDD (10 ou 11 dígitos)
      const rawPhone = String(checkInPayload.TELEFONE || checkInPayload.telefone || '').trim();
      const phoneDigits = SecurityUtils.normalizePhoneDigits(rawPhone);

      if (!phoneDigits || phoneDigits.length < 10 || phoneDigits.length > 11) {
        throw new Error(
          'Para validar o check-in manual, informe o número completo de Telefone / Celular com DDD (10 ou 11 dígitos).'
        );
      }

      matchedInscricao = inscricoesEvento.find(
        (ins) =>
          ins.TELEFONE && SecurityUtils.normalizePhoneDigits(ins.TELEFONE) === phoneDigits
      );
      if (!matchedInscricao) {
        throw new Error(
          'Não foi encontrada inscrição para este número de telefone na reunião ativa. Verifique o DDD e os dígitos informados.'
        );
      }
    }

    if (matchedInscricao.PRESENCA_CONFIRMADA) {
      return {
        success: true,
        alreadyCheckedIn: true,
        message: `Sua presença já está confirmada nesta reunião desde ${matchedInscricao.DATA_HORA_PRESENCA}.`,
        inscricao: this.sanitizeInscricaoForPublicDisplay_(matchedInscricao),
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
      inscricao: this.sanitizeInscricaoForPublicDisplay_(updated),
      evento,
      qrPayload: updated.ID_INSCRICAO
    };
  }

  /**
   * Lista as funções ativas cadastradas no catálogo dinâmico para popular selects públicos.
   * @returns {{success: boolean, funcoes: Array<Object>, names: Array<string>}}
   */
  getActiveFuncoesList() {
    this.repository_.ensureDatabaseSchema();
    const ativas = this.repository_
      .findAllFuncoes()
      .filter((f) => f.ATIVO)
      .sort((a, b) => a.FUNCAO.localeCompare(b.FUNCAO, 'pt-BR'));
    return {
      success: true,
      funcoes: ativas,
      names: ativas.map((f) => f.FUNCAO)
    };
  }
}
