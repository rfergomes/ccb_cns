/**
 * @fileoverview Serviço Administrativo protegido por ADMIN_SECRET.
 * Responsável pelo cálculo de KPIs, agregações para gráficos (Chart.js),
 * CRUD de Eventos, CRUD de Inscrições e Terminal de Check-in por QR Code.
 */

class AdminService {
  /**
   * @param {SheetsRepository} [repository] Instância do repositório tabular.
   * @param {InscriptionService} [inscriptionService] Instância do serviço de inscrição.
   */
  constructor(repository, inscriptionService) {
    /** @private @type {SheetsRepository} */
    this.repository_ = repository || new SheetsRepository();
    /** @private @type {InscriptionService} */
    this.inscriptionService_ = inscriptionService || new InscriptionService(this.repository_);
  }

  /**
   * Autentica o administrador usando a chave mestra e retorna o estado administrativo completo.
   *
   * @param {string} adminSecret Chave administrativa informada.
   * @param {string} [filterEventoId='ALL'] Filtro de evento ('ALL' para consolidado histórico ou UUID).
   * @returns {Object} Pacote completo de dados administrativos.
   */
  authenticateAndLoadDashboard(adminSecret, filterEventoId = 'ALL') {
    SecurityUtils.assertAdminAuthorized(adminSecret);
    this.repository_.ensureDatabaseSchema();
    return this.getAdminDataBundle(adminSecret, filterEventoId);
  }

  /**
   * Constrói o pacote consolidado de dados para o Painel Administrativo:
   * KPIs, séries para gráficos, lista de eventos e lista de inscrições enriquecida.
   *
   * @param {string} adminSecret Chave administrativa.
   * @param {string} [filterEventoId='ALL'] UUID do evento ou 'ALL'.
   * @returns {Object} Dados completos do painel.
   */
  getAdminDataBundle(adminSecret, filterEventoId = 'ALL') {
    SecurityUtils.assertAdminAuthorized(adminSecret);
    this.repository_.ensureDatabaseSchema();

    const eventos = this.repository_
      .findAllEventos()
      .sort((a, b) => {
        const cmpDate = (b.DATA_EVENTO || '').localeCompare(a.DATA_EVENTO || '');
        if (cmpDate !== 0) return cmpDate;
        return (b.HORA_EVENTO || '').localeCompare(a.HORA_EVENTO || '');
      });

    const eventosMap = new Map();
    eventos.forEach((ev) => eventosMap.set(ev.ID_EVENTO.toLowerCase(), ev));

    const todasInscricoes = this.repository_
      .findAllInscricoes()
      .map((ins) => {
        const ev = eventosMap.get(ins.ID_EVENTO.toLowerCase());
        return {
          ...ins,
          EVENTO_TITULO: ev ? ev.TITULO : 'Evento Removido',
          EVENTO_DATA: ev ? ev.DATA_EVENTO : '',
          EVENTO_HORA: ev ? ev.HORA_EVENTO : '',
          EVENTO_LOCAL: ev ? ev.LOCAL : ''
        };
      })
      .sort((a, b) => (a.NOME_COMPLETO || '').localeCompare(b.NOME_COMPLETO || '', 'pt-BR'));

    const normalizedFilter =
      filterEventoId && filterEventoId !== 'ALL' && SecurityUtils.isValidUuid(filterEventoId)
        ? filterEventoId.trim().toLowerCase()
        : 'ALL';

    const inscricoesFiltradas =
      normalizedFilter === 'ALL'
        ? todasInscricoes
        : todasInscricoes.filter((ins) => ins.ID_EVENTO.toLowerCase() === normalizedFilter);

    const totalInscricoes = inscricoesFiltradas.length;
    const totalPresencas = inscricoesFiltradas.filter((ins) => ins.PRESENCA_CONFIRMADA).length;
    const taxaPresenca =
      totalInscricoes > 0 ? Number(((totalPresencas / totalInscricoes) * 100).toFixed(1)) : 0;
    const totalReunioes = eventos.length;

    // Contagem de inscritos e presentes por evento para a tabela de Gestão de Eventos
    const statsPorEvento = {};
    eventos.forEach((ev) => {
      statsPorEvento[ev.ID_EVENTO.toLowerCase()] = { inscritos: 0, presentes: 0 };
    });
    todasInscricoes.forEach((ins) => {
      const key = ins.ID_EVENTO.toLowerCase();
      if (!statsPorEvento[key]) {
        statsPorEvento[key] = { inscritos: 0, presentes: 0 };
      }
      statsPorEvento[key].inscritos += 1;
      if (ins.PRESENCA_CONFIRMADA) {
        statsPorEvento[key].presentes += 1;
      }
    });

    const eventosEnriquecidos = eventos.map((ev) => {
      const st = statsPorEvento[ev.ID_EVENTO.toLowerCase()] || { inscritos: 0, presentes: 0 };
      return {
        ...ev,
        TOTAL_INSCRITOS: st.inscritos,
        TOTAL_PRESENTES: st.presentes,
        CHECKIN_WINDOW: SecurityUtils.evaluateCheckInWindow(ev.DATA_EVENTO, ev.HORA_EVENTO, 60)
      };
    });

    // Distribuição por Cidade (mantendo a ordem canônica da Regional Campinas)
    const cidadesMap = new Map();
    Environment.CIDADES_REGIONAL_CAMPINAS.forEach((cidade) => {
      cidadesMap.set(cidade, { inscritos: 0, presentes: 0 });
    });

    inscricoesFiltradas.forEach((ins) => {
      const cidadeKey = Environment.CIDADES_REGIONAL_CAMPINAS.includes(ins.CIDADE)
        ? ins.CIDADE
        : ins.CIDADE || 'Outros';
      if (!cidadesMap.has(cidadeKey)) {
        cidadesMap.set(cidadeKey, { inscritos: 0, presentes: 0 });
      }
      const entry = cidadesMap.get(cidadeKey);
      entry.inscritos += 1;
      if (ins.PRESENCA_CONFIRMADA) {
        entry.presentes += 1;
      }
    });

    const chartCidades = {
      labels: Array.from(cidadesMap.keys()),
      inscritos: Array.from(cidadesMap.values()).map((v) => v.inscritos),
      presentes: Array.from(cidadesMap.values()).map((v) => v.presentes)
    };

    // Distribuição por Função / Ministério
    const funcoesMap = new Map();
    inscricoesFiltradas.forEach((ins) => {
      const fnKey = ins.FUNCAO || 'Não Informado';
      funcoesMap.set(fnKey, (funcoesMap.get(fnKey) || 0) + 1);
    });

    const funcoesEntries = Array.from(funcoesMap.entries()).sort((a, b) => b[1] - a[1]);
    const chartFuncoes = {
      labels: funcoesEntries.map((entry) => entry[0]),
      valores: funcoesEntries.map((entry) => entry[1])
    };

    return {
      filterEventoId: normalizedFilter,
      kpis: {
        totalInscricoes,
        totalPresencas,
        taxaPresenca,
        totalReunioes
      },
      charts: {
        cidades: chartCidades,
        funcoes: chartFuncoes
      },
      eventos: eventosEnriquecidos,
      inscricoes: todasInscricoes,
      inscricoesFiltradas,
      metadata: Environment.getPublicMetadata(),
      generatedAt: SecurityUtils.getCurrentIsoTimestamp()
    };
  }

  /* ==========================================================================
   * GESTÃO DE EVENTOS (CRUD)
   * ========================================================================== */

  /**
   * Valida os campos de criação ou edição de um evento.
   * @param {Object} eventPayload Dados do evento.
   * @returns {Object} Dados normalizados.
   * @private
   */
  validateEventoPayload_(eventPayload) {
    if (!eventPayload || typeof eventPayload !== 'object') {
      throw new Error('Dados do evento inválidos.');
    }

    const titulo = SecurityUtils.sanitizeText(eventPayload.TITULO || eventPayload.titulo, 160);
    if (!titulo || titulo.length < 3) {
      throw new Error('O título da reunião é obrigatório (mínimo de 3 caracteres).');
    }

    const dataEvento = SecurityUtils.normalizeDateString(
      eventPayload.DATA_EVENTO || eventPayload.dataEvento
    );
    if (!SecurityUtils.isValidDateIso(dataEvento)) {
      throw new Error('A data da reunião deve estar no formato válido (AAAA-MM-DD).');
    }

    const horaEvento = SecurityUtils.normalizeTimeString(
      eventPayload.HORA_EVENTO || eventPayload.horaEvento
    );
    if (!SecurityUtils.isValidTimeHhMm(horaEvento)) {
      throw new Error('O horário da reunião deve estar no formato válido (HH:mm).');
    }

    const horaLanche = SecurityUtils.normalizeTimeString(
      eventPayload.HORA_LANCHE || eventPayload.horaLanche
    );
    if (!SecurityUtils.isValidTimeHhMm(horaLanche)) {
      throw new Error('O horário do lanche deve estar no formato válido (HH:mm).');
    }

    const local = SecurityUtils.sanitizeText(eventPayload.LOCAL || eventPayload.local, 240);
    if (!local || local.length < 4) {
      throw new Error('O local/endereço da reunião é obrigatório.');
    }

    const rawLinkMapa = String(eventPayload.LINK_MAPA || eventPayload.linkMapa || '').trim();
    let linkMapa = '';
    if (rawLinkMapa) {
      if (!/^https?:\/\/\S+$/i.test(rawLinkMapa)) {
        throw new Error(
          'O Link de Localização (Google Maps / Waze) deve iniciar com http:// ou https://.'
        );
      }
      linkMapa = SecurityUtils.sanitizeText(rawLinkMapa, 500);
    }

    const rawStatus = String(
      eventPayload.STATUS || eventPayload.status || Environment.EVENT_STATUS.ATIVO
    )
      .trim()
      .toUpperCase();
    let status = Environment.EVENT_STATUS.ATIVO;
    if (rawStatus === Environment.EVENT_STATUS.ENCERRADO) {
      status = Environment.EVENT_STATUS.ENCERRADO;
    } else if (rawStatus === Environment.EVENT_STATUS.PREVISTO) {
      status = Environment.EVENT_STATUS.PREVISTO;
    }

    return {
      TITULO: titulo,
      DATA_EVENTO: dataEvento,
      HORA_EVENTO: horaEvento,
      HORA_LANCHE: horaLanche,
      LOCAL: local,
      STATUS: status,
      LINK_MAPA: linkMapa
    };
  }

  /**
   * Garante que apenas um evento permaneça com status ATIVO por vez.
   * Ao ativar um evento, todos os demais eventos que estavam ATIVOS são
   * automaticamente alterados para ENCERRADO.
   *
   * @param {string} [excludeEventoId=''] UUID do evento que permanecerá ATIVO.
   * @returns {Array<string>} Títulos dos eventos anteriores que foram encerrados.
   * @private
   */
  closeOtherActiveEventos_(excludeEventoId = '') {
    const cleanExclude = String(excludeEventoId || '').trim().toLowerCase();
    const allEventos = this.repository_.findAllEventos();
    const closedTitles = [];

    allEventos.forEach((ev) => {
      if (
        ev.STATUS === Environment.EVENT_STATUS.ATIVO &&
        (!cleanExclude || ev.ID_EVENTO.toLowerCase() !== cleanExclude)
      ) {
        this.repository_.updateEventoById(ev.ID_EVENTO, {
          STATUS: Environment.EVENT_STATUS.ENCERRADO
        });
        closedTitles.push(ev.TITULO);
      }
    });

    return closedTitles;
  }

  /**
   * Cria ou atualiza um evento na tabela EVENTOS.
   * Se o status for ATIVO, encerra automaticamente qualquer outro evento que estivesse ATIVO.
   *
   * @param {string} adminSecret Chave administrativa.
   * @param {Object} eventPayload Dados do evento (se incluir ID_EVENTO válido, atualiza).
   * @returns {{success: boolean, message: string, evento: Object, autoClosedEvents: Array<string>}}
   */
  saveEvento(adminSecret, eventPayload) {
    SecurityUtils.assertAdminAuthorized(adminSecret);
    this.repository_.ensureDatabaseSchema();

    const normalized = this.validateEventoPayload_(eventPayload);
    const idEvento = String(eventPayload.ID_EVENTO || eventPayload.idEvento || '').trim();
    let autoClosedEvents = [];

    if (idEvento && SecurityUtils.isValidUuid(idEvento)) {
      if (normalized.STATUS === Environment.EVENT_STATUS.ATIVO) {
        autoClosedEvents = this.closeOtherActiveEventos_(idEvento);
      }
      const updated = this.repository_.updateEventoById(idEvento, normalized);
      const extraMsg =
        autoClosedEvents.length > 0
          ? ` O evento ativo anterior ("${autoClosedEvents.join('", "')}") foi encerrado automaticamente.`
          : '';
      return {
        success: true,
        message: `Reunião atualizada com sucesso!${extraMsg}`,
        evento: updated,
        autoClosedEvents
      };
    }

    if (normalized.STATUS === Environment.EVENT_STATUS.ATIVO) {
      autoClosedEvents = this.closeOtherActiveEventos_('');
    }
    const created = this.repository_.insertEvento(normalized);
    const extraMsg =
      autoClosedEvents.length > 0
        ? ` O evento ativo anterior ("${autoClosedEvents.join('", "')}") foi encerrado automaticamente.`
        : '';
    return {
      success: true,
      message: `Nova convocação / reunião cadastrada com sucesso!${extraMsg}`,
      evento: created,
      autoClosedEvents
    };
  }

  /**
   * Altera rapidamente o status de um evento entre ATIVO, PREVISTO e ENCERRADO.
   * Ao definir como ATIVO, encerra automaticamente qualquer outro evento ativo.
   *
   * @param {string} adminSecret Chave administrativa.
   * @param {string} idEvento UUID do evento.
   * @param {string} novoStatus Novo status ('ATIVO' | 'PREVISTO' | 'ENCERRADO').
   * @returns {{success: boolean, message: string, evento: Object, autoClosedEvents: Array<string>}}
   */
  updateEventoStatus(adminSecret, idEvento, novoStatus) {
    SecurityUtils.assertAdminAuthorized(adminSecret);
    if (!SecurityUtils.isValidUuid(idEvento)) {
      throw new Error('UUID do evento inválido.');
    }

    const statusUpper = String(novoStatus || '').trim().toUpperCase();
    if (
      statusUpper !== Environment.EVENT_STATUS.ATIVO &&
      statusUpper !== Environment.EVENT_STATUS.PREVISTO &&
      statusUpper !== Environment.EVENT_STATUS.ENCERRADO
    ) {
      throw new Error('Status inválido. Utilize ATIVO, PREVISTO ou ENCERRADO.');
    }

    let autoClosedEvents = [];
    if (statusUpper === Environment.EVENT_STATUS.ATIVO) {
      autoClosedEvents = this.closeOtherActiveEventos_(idEvento);
    }

    const updated = this.repository_.updateEventoById(idEvento, { STATUS: statusUpper });
    const extraMsg =
      autoClosedEvents.length > 0
        ? ` O evento ativo anterior ("${autoClosedEvents.join('", "')}") foi encerrado automaticamente.`
        : '';
    return {
      success: true,
      message: `Status da reunião alterado para ${statusUpper}.${extraMsg}`,
      evento: updated,
      autoClosedEvents
    };
  }

  /**
   * Exclui um evento e todas as suas inscrições vinculadas.
   * @param {string} adminSecret Chave administrativa.
   * @param {string} idEvento UUID do evento.
   * @returns {{success: boolean, message: string}}
   */
  deleteEvento(adminSecret, idEvento) {
    SecurityUtils.assertAdminAuthorized(adminSecret);
    const result = this.repository_.deleteEventoById(idEvento, true);
    return {
      success: true,
      message: `Reunião excluída com sucesso (${result.deletedInscricoesCount} inscrição(ões) vinculada(s) removida(s)).`
    };
  }

  /* ==========================================================================
   * GESTÃO DE INSCRIÇÕES E CHECK-IN (CRUD + QR CODE)
   * ========================================================================== */

  /**
   * Insere manualmente uma inscrição pelo painel administrativo.
   * @param {string} adminSecret Chave administrativa.
   * @param {Object} payload Dados da inscrição.
   * @returns {{success: boolean, message: string, inscricao: Object}}
   */
  createManualInscricao(adminSecret, payload) {
    SecurityUtils.assertAdminAuthorized(adminSecret);
    this.repository_.ensureDatabaseSchema();

    const { normalized } = this.inscriptionService_.validateAndNormalizePayload(payload, {
      allowClosedEvent: true
    });

    const presencaConfirmada = SecurityUtils.parseBoolean(
      payload.PRESENCA_CONFIRMADA !== undefined
        ? payload.PRESENCA_CONFIRMADA
        : payload.presencaConfirmada
    );

    normalized.PRESENCA_CONFIRMADA = presencaConfirmada;
    normalized.DATA_HORA_PRESENCA = presencaConfirmada
      ? SecurityUtils.getCurrentIsoTimestamp()
      : '';

    const created = this.repository_.insertInscricao(normalized);
    return {
      success: true,
      message: 'Participante cadastrado manualmente com sucesso!',
      inscricao: created
    };
  }

  /**
   * Alterna manualmente a confirmação de presença de um inscrito.
   * @param {string} adminSecret Chave administrativa.
   * @param {string} idInscricao UUID da inscrição.
   * @param {boolean} presencaConfirmada Estado desejado de presença.
   * @returns {{success: boolean, message: string, inscricao: Object}}
   */
  setPresencaManual(adminSecret, idInscricao, presencaConfirmada) {
    SecurityUtils.assertAdminAuthorized(adminSecret);
    const confirmada = Boolean(presencaConfirmada);
    const updated = this.repository_.updateInscricaoById(idInscricao, {
      PRESENCA_CONFIRMADA: confirmada,
      DATA_HORA_PRESENCA: confirmada ? SecurityUtils.getCurrentIsoTimestamp() : ''
    });

    return {
      success: true,
      message: confirmada
        ? `Presença confirmada para ${updated.NOME_COMPLETO}.`
        : `Presença desmarcada para ${updated.NOME_COMPLETO}.`,
      inscricao: updated
    };
  }

  /**
   * Remove uma inscrição pelo UUID.
   * @param {string} adminSecret Chave administrativa.
   * @param {string} idInscricao UUID da inscrição.
   * @returns {{success: boolean, message: string}}
   */
  deleteInscricao(adminSecret, idInscricao) {
    SecurityUtils.assertAdminAuthorized(adminSecret);
    this.repository_.deleteInscricaoById(idInscricao);
    return {
      success: true,
      message: 'Inscrição removida com sucesso.'
    };
  }

  /**
   * Extrai o UUID da inscrição a partir da leitura bruta do QR Code.
   * Suporta UUID puro, JSON com propriedade id/ID_INSCRICAO ou URL contendo o UUID.
   * @param {string} rawQrText Texto lido pelo scanner.
   * @returns {string} UUID extraído ou string vazia.
   * @private
   */
  extractUuidFromQrPayload_(rawQrText) {
    if (!rawQrText) return '';
    const trimmed = String(rawQrText).trim();
    if (SecurityUtils.isValidUuid(trimmed)) {
      return trimmed.toLowerCase();
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const candidate = parsed.ID_INSCRICAO || parsed.idInscricao || parsed.id || parsed.uuid;
        if (SecurityUtils.isValidUuid(candidate)) {
          return String(candidate).trim().toLowerCase();
        }
      }
    } catch (_) {
      // Não é um JSON, prossegue para extração via Regex
    }

    const uuidMatch = trimmed.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
    return uuidMatch ? uuidMatch[0].toLowerCase() : '';
  }

  /**
   * Processa a leitura de um QR Code no Terminal de Check-in (Recepção).
   *
   * @param {string} adminSecret Chave administrativa.
   * @param {string} rawQrText Conteúdo lido do QR Code.
   * @param {string} [expectedEventoId='ALL'] Se informado um UUID, valida se o inscrito pertence ao evento.
   * @returns {{
   *   success: boolean,
   *   alreadyCheckedIn: boolean,
   *   message: string,
   *   inscricao: Object,
   *   evento: Object|null
   * }}
   */
  processQrCheckIn(adminSecret, rawQrText, expectedEventoId = 'ALL') {
    SecurityUtils.assertAdminAuthorized(adminSecret);
    this.repository_.ensureDatabaseSchema();

    const idInscricao = this.extractUuidFromQrPayload_(rawQrText);
    if (!idInscricao) {
      throw new Error(
        'QR Code inválido: Não foi encontrado um identificador UUID de credenciamento válido.'
      );
    }

    const inscricao = this.repository_.findInscricaoById(idInscricao);
    if (!inscricao) {
      throw new Error(
        `Credencial não encontrada na base de dados (UUID: ${idInscricao.substring(0, 8)}...).`
      );
    }

    if (
      expectedEventoId &&
      expectedEventoId !== 'ALL' &&
      SecurityUtils.isValidUuid(expectedEventoId)
    ) {
      if (inscricao.ID_EVENTO.toLowerCase() !== expectedEventoId.trim().toLowerCase()) {
        const evEsperado = this.repository_.findEventoById(expectedEventoId);
        const evInscrito = this.repository_.findEventoById(inscricao.ID_EVENTO);
        throw new Error(
          `Esta credencial pertence à reunião "${evInscrito ? evInscrito.TITULO : inscricao.ID_EVENTO}" e não à reunião selecionada no terminal ("${evEsperado ? evEsperado.TITULO : expectedEventoId}").`
        );
      }
    }

    const evento = this.repository_.findEventoById(inscricao.ID_EVENTO);
    if (!evento) {
      throw new Error('A reunião vinculada a esta credencial não foi encontrada na base.');
    }

    const windowStatus = SecurityUtils.evaluateCheckInWindow(
      evento.DATA_EVENTO,
      evento.HORA_EVENTO,
      60
    );
    if (!windowStatus.isOpen) {
      throw new Error(windowStatus.lockMessage);
    }

    if (inscricao.PRESENCA_CONFIRMADA) {
      return {
        success: true,
        alreadyCheckedIn: true,
        message: `Presença já havia sido registrada anteriormente para ${inscricao.NOME_COMPLETO} (${inscricao.CIDADE}).`,
        inscricao,
        evento
      };
    }

    const nowIso = SecurityUtils.getCurrentIsoTimestamp();
    const updated = this.repository_.updateInscricaoById(inscricao.ID_INSCRICAO, {
      PRESENCA_CONFIRMADA: true,
      DATA_HORA_PRESENCA: nowIso
    });

    return {
      success: true,
      alreadyCheckedIn: false,
      message: `Check-in confirmado com sucesso para ${updated.NOME_COMPLETO} (${updated.CIDADE})!`,
      inscricao: updated,
      evento
    };
  }
}

