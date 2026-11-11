/**
 * @fileoverview Camada de Repositório para acesso exclusivo ao Google Sheets.
 * Gerencia a inicialização automática do schema tabular (EVENTOS e INSCRICOES)
 * e operações transacionais baseadas estritamente em chaves UUID v4 persistentes.
 */

class SheetsRepository {
  /**
   * Inicializa o repositório garantindo conexão com a planilha configurada.
   */
  constructor() {
    /** @private @type {GoogleAppsScript.Spreadsheet.Spreadsheet|null} */
    this.spreadsheet_ = null;
    /** @private @type {Object<string, GoogleAppsScript.Spreadsheet.Sheet>} */
    this.verifiedTables_ = {};
    /** @private @type {number} */
    this.lockDepth_ = 0;
  }

  /**
   * Obtém a instância da planilha a partir do SPREADSHEET_ID no Environment.
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
   * @private
   */
  getSpreadsheet_() {
    if (!this.spreadsheet_) {
      const spreadsheetId = Environment.getSpreadsheetId();
      this.spreadsheet_ = SpreadsheetApp.openById(spreadsheetId);
    }
    return this.spreadsheet_;
  }

  /**
   * Garante que todas as tabelas (EVENTOS, INSCRICOES e FUNCOES) existam e possuam
   * exatamente os cabeçalhos exigidos pelo modelo de dados.
   * @returns {void}
   */
  ensureDatabaseSchema() {
    this.ensureTable_(
      Environment.TABLES.EVENTOS.NAME,
      Environment.TABLES.EVENTOS.COLUMNS
    );
    this.ensureTable_(
      Environment.TABLES.INSCRICOES.NAME,
      Environment.TABLES.INSCRICOES.COLUMNS
    );
    this.ensureFuncoesInitialized_();
  }

  /**
   * Garante a criação da aba FUNCOES e realiza a carga inicial padrão na primeira criação.
   * @returns {GoogleAppsScript.Spreadsheet.Sheet} Aba FUNCOES validada.
   * @private
   */
  ensureFuncoesInitialized_() {
    if (this.verifiedTables_[Environment.TABLES.FUNCOES.NAME]) {
      return this.verifiedTables_[Environment.TABLES.FUNCOES.NAME];
    }

    const ss = this.getSpreadsheet_();
    const existingSheet = ss.getSheetByName(Environment.TABLES.FUNCOES.NAME);
    const shouldSeedInitial = !existingSheet || existingSheet.getLastRow() === 0;

    const sheet = this.ensureTable_(
      Environment.TABLES.FUNCOES.NAME,
      Environment.TABLES.FUNCOES.COLUMNS
    );

    if (shouldSeedInitial && sheet.getLastRow() <= 1) {
      this.withWriteLock_(() => {
        if (sheet.getLastRow() <= 1) {
          const initialRows = Environment.FUNCOES_INICIAIS_CATALOGO.map((fn) =>
            this.mapFuncaoToRow_(fn)
          );
          if (initialRows.length > 0) {
            const numCols = Environment.TABLES.FUNCOES.COLUMNS.length;
            const range = sheet.getRange(2, 1, initialRows.length, numCols);
            range.setNumberFormats(initialRows.map(() => ['@', '@', '@', 'General']));
            range.setValues(initialRows);
          }
        }
      });
    }

    return sheet;
  }

  /**
   * Garante a existência e o cabeçalho de uma aba específica na planilha.
   * @param {string} sheetName Nome da aba.
   * @param {ReadonlyArray<string>} columns Colunas canônicas da tabela.
   * @returns {GoogleAppsScript.Spreadsheet.Sheet} Aba validada.
   * @private
   */
  ensureTable_(sheetName, columns) {
    if (this.verifiedTables_[sheetName]) {
      return this.verifiedTables_[sheetName];
    }

    const ss = this.getSpreadsheet_();
    let sheet = ss.getSheetByName(sheetName);
    const cacheKey = `schema_v2_${sheetName}_${columns.length}`;

    if (sheet && sheet.getLastRow() >= 1) {
      try {
        if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
          const cached = CacheService.getScriptCache().get(cacheKey);
          if (cached === '1') {
            this.verifiedTables_[sheetName] = sheet;
            return sheet;
          }
        }
      } catch (_) {
        // Ignora indisponibilidade de CacheService em mocks/testes
      }
    }

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    const lastCol = sheet.getLastColumn();
    const expectedColsCount = columns.length;

    if (lastCol === 0 || sheet.getLastRow() === 0) {
      const headerRange = sheet.getRange(1, 1, 1, expectedColsCount);
      headerRange.setValues([Array.from(columns)]);
      headerRange
        .setBackground('#033D60')
        .setFontColor('#FFFFFF')
        .setFontFamily('Verdana')
        .setFontWeight('bold')
        .setHorizontalAlignment('center');
      sheet.setFrozenRows(1);
    } else {
      const currentHeaders = sheet
        .getRange(1, 1, 1, Math.max(lastCol, expectedColsCount))
        .getValues()[0]
        .map((h) => String(h).trim().toUpperCase());

      let needsHeaderUpdate = false;
      for (let i = 0; i < expectedColsCount; i++) {
        if (currentHeaders[i] !== columns[i]) {
          needsHeaderUpdate = true;
          break;
        }
      }

      if (needsHeaderUpdate) {
        const headerRange = sheet.getRange(1, 1, 1, expectedColsCount);
        headerRange.setValues([Array.from(columns)]);
        headerRange
          .setBackground('#033D60')
          .setFontColor('#FFFFFF')
          .setFontFamily('Verdana')
          .setFontWeight('bold');
        sheet.setFrozenRows(1);
      }
    }

    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
        CacheService.getScriptCache().put(cacheKey, '1', 600);
      }
    } catch (_) {
      // Ignora indisponibilidade de CacheService em mocks/testes
    }

    this.verifiedTables_[sheetName] = sheet;
    return sheet;
  }

  /**
   * Executa um bloco lógico completo dentro de uma transação protegida por LockService.
   * Permite leitura + escrita atômicas sem condições de corrida (TOCTOU).
   *
   * @template T
   * @param {function(): T} callback Operação atômica a executar.
   * @returns {T} Resultado retornado pelo callback.
   */
  runInTransaction(callback) {
    return this.withWriteLock_(callback);
  }

  /**
   * Executa uma operação de escrita protegida por LockService para evitar condições de corrida.
   * Suporta reentrância no mesmo contexto de execução.
   * @template T
   * @param {function(): T} callback Função crítica a ser executada.
   * @returns {T} Resultado do callback.
   * @private
   */
  withWriteLock_(callback) {
    if (this.lockDepth_ > 0) {
      this.lockDepth_ += 1;
      try {
        return callback();
      } finally {
        this.lockDepth_ -= 1;
      }
    }

    const lock = LockService.getScriptLock();
    const hasLock = lock.tryLock(15000);
    if (!hasLock) {
      throw new Error(
        'O banco de dados está processando outra atualização simultânea. Por favor, tente novamente em instantes.'
      );
    }
    this.lockDepth_ = 1;
    try {
      const result = callback();
      SpreadsheetApp.flush();
      return result;
    } finally {
      this.lockDepth_ = 0;
      lock.releaseLock();
    }
  }

  /**
   * Converte uma linha da aba EVENTOS em um objeto de domínio tipado.
   * @param {Array<*>} row Linha bruta da planilha.
   * @returns {Object} Objeto Evento normalizado.
   * @private
   */
  mapRowToEvento_(row) {
    return {
      ID_EVENTO: String(row[0] || '').trim(),
      TITULO: String(row[1] || '').trim(),
      DATA_EVENTO: SecurityUtils.normalizeDateString(row[2]),
      HORA_EVENTO: SecurityUtils.normalizeTimeString(row[3]),
      HORA_LANCHE: SecurityUtils.normalizeTimeString(row[4]),
      LOCAL: String(row[5] || '').trim(),
      STATUS: String(row[6] || Environment.EVENT_STATUS.ENCERRADO).trim().toUpperCase(),
      LINK_MAPA: String(row[7] || '').trim(),
      COMPLEMENTO_LOCAL: String(row[8] || '').trim()
    };
  }

  /**
   * Converte um objeto Evento em um array ordenado conforme o schema EVENTOS.
   * @param {Object} evento Entidade Evento.
   * @returns {Array<*>} Linha pronta para gravação.
   * @private
   */
  mapEventoToRow_(evento) {
    return [
      String(evento.ID_EVENTO).trim(),
      String(evento.TITULO).trim(),
      String(evento.DATA_EVENTO).trim(),
      String(evento.HORA_EVENTO).trim(),
      String(evento.HORA_LANCHE).trim(),
      String(evento.LOCAL).trim(),
      String(evento.STATUS).trim().toUpperCase(),
      String(evento.LINK_MAPA || '').trim(),
      String(evento.COMPLEMENTO_LOCAL || '').trim()
    ];
  }

  /**
   * Converte uma linha da aba INSCRICOES em um objeto de domínio tipado.
   * @param {Array<*>} row Linha bruta da planilha.
   * @returns {Object} Objeto Inscrição normalizado.
   * @private
   */
  mapRowToInscricao_(row) {
    return {
      ID_INSCRICAO: String(row[0] || '').trim(),
      ID_EVENTO: String(row[1] || '').trim(),
      NOME_COMPLETO: String(row[2] || '').trim(),
      CIDADE: String(row[3] || '').trim(),
      FUNCAO: String(row[4] || '').trim(),
      EMAIL: String(row[5] || '').trim(),
      TELEFONE: String(row[6] || '').trim(),
      ACEITE_LGPD: SecurityUtils.parseBoolean(row[7]),
      DATA_HORA_ACEITE: row[8] ? String(row[8]).trim() : '',
      PRESENCA_CONFIRMADA: SecurityUtils.parseBoolean(row[9]),
      DATA_HORA_PRESENCA: row[10] ? String(row[10]).trim() : ''
    };
  }

  /**
   * Converte um objeto Inscrição em um array ordenado conforme o schema INSCRICOES.
   * @param {Object} inscricao Entidade Inscrição.
   * @returns {Array<*>} Linha pronta para gravação.
   * @private
   */
  mapInscricaoToRow_(inscricao) {
    return [
      String(inscricao.ID_INSCRICAO).trim(),
      String(inscricao.ID_EVENTO).trim(),
      String(inscricao.NOME_COMPLETO).trim(),
      String(inscricao.CIDADE).trim(),
      String(inscricao.FUNCAO).trim(),
      String(inscricao.EMAIL || '').trim(),
      String(inscricao.TELEFONE || '').trim(),
      Boolean(inscricao.ACEITE_LGPD),
      String(inscricao.DATA_HORA_ACEITE || '').trim(),
      Boolean(inscricao.PRESENCA_CONFIRMADA),
      String(inscricao.DATA_HORA_PRESENCA || '').trim()
    ];
  }

  /* ==========================================================================
   * OPERAÇÕES DA TABELA: EVENTOS
   * ========================================================================== */

  /**
   * Lista todos os eventos cadastrados na tabela EVENTOS.
   * @returns {Array<Object>} Lista de objetos de evento.
   */
  findAllEventos() {
    const sheet = this.ensureTable_(
      Environment.TABLES.EVENTOS.NAME,
      Environment.TABLES.EVENTOS.COLUMNS
    );
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return [];
    }

    const numCols = Environment.TABLES.EVENTOS.COLUMNS.length;
    const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

    return values
      .map((row) => this.mapRowToEvento_(row))
      .filter((ev) => Boolean(ev.ID_EVENTO));
  }

  /**
   * Busca um evento específico pelo seu UUID persistente (ID_EVENTO).
   * @param {string} idEvento UUID do evento.
   * @returns {Object|null} Evento encontrado ou null.
   */
  findEventoById(idEvento) {
    if (!SecurityUtils.isValidUuid(idEvento)) {
      return null;
    }
    const targetId = idEvento.trim().toLowerCase();
    const eventos = this.findAllEventos();
    return eventos.find((ev) => ev.ID_EVENTO.toLowerCase() === targetId) || null;
  }

  /**
   * Insere um novo evento na tabela EVENTOS.
   * @param {Object} eventoData Dados validados do evento.
   * @returns {Object} Evento persistido com ID_EVENTO gerado.
   */
  insertEvento(eventoData) {
    return this.withWriteLock_(() => {
      const sheet = this.ensureTable_(
        Environment.TABLES.EVENTOS.NAME,
        Environment.TABLES.EVENTOS.COLUMNS
      );

      const novoEvento = {
        ID_EVENTO: SecurityUtils.isValidUuid(eventoData.ID_EVENTO)
          ? eventoData.ID_EVENTO.trim().toLowerCase()
          : SecurityUtils.generateUuid(),
        TITULO: eventoData.TITULO,
        DATA_EVENTO: eventoData.DATA_EVENTO,
        HORA_EVENTO: eventoData.HORA_EVENTO,
        HORA_LANCHE: eventoData.HORA_LANCHE,
        LOCAL: eventoData.LOCAL,
        STATUS: eventoData.STATUS || Environment.EVENT_STATUS.ATIVO,
        LINK_MAPA: String(eventoData.LINK_MAPA || '').trim(),
        COMPLEMENTO_LOCAL: String(eventoData.COMPLEMENTO_LOCAL || '').trim()
      };

      const rowValues = this.mapEventoToRow_(novoEvento);
      const nextRow = sheet.getLastRow() + 1;
      const range = sheet.getRange(nextRow, 1, 1, rowValues.length);
      range.setNumberFormat('@');
      range.setValues([rowValues]);

      return novoEvento;
    });
  }

  /**
   * Atualiza um evento existente localizando-o exclusivamente pelo UUID (ID_EVENTO).
   * @param {string} idEvento UUID do evento.
   * @param {Object} updates Campos a serem atualizados.
   * @returns {Object} Evento atualizado.
   * @throws {Error} Se o evento não for encontrado.
   */
  updateEventoById(idEvento, updates) {
    if (!SecurityUtils.isValidUuid(idEvento)) {
      throw new Error('Identificador de evento inválido (UUID esperado).');
    }

    return this.withWriteLock_(() => {
      const sheet = this.ensureTable_(
        Environment.TABLES.EVENTOS.NAME,
        Environment.TABLES.EVENTOS.COLUMNS
      );
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        throw new Error('Evento não encontrado na base de dados.');
      }

      const numCols = Environment.TABLES.EVENTOS.COLUMNS.length;
      const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
      const targetId = idEvento.trim().toLowerCase();

      for (let i = 0; i < values.length; i++) {
        const currentId = String(values[i][0] || '').trim().toLowerCase();
        if (currentId === targetId) {
          const currentEvento = this.mapRowToEvento_(values[i]);
          const updatedEvento = {
            ID_EVENTO: currentEvento.ID_EVENTO,
            TITULO: updates.TITULO !== undefined ? updates.TITULO : currentEvento.TITULO,
            DATA_EVENTO: updates.DATA_EVENTO !== undefined ? updates.DATA_EVENTO : currentEvento.DATA_EVENTO,
            HORA_EVENTO: updates.HORA_EVENTO !== undefined ? updates.HORA_EVENTO : currentEvento.HORA_EVENTO,
            HORA_LANCHE: updates.HORA_LANCHE !== undefined ? updates.HORA_LANCHE : currentEvento.HORA_LANCHE,
            LOCAL: updates.LOCAL !== undefined ? updates.LOCAL : currentEvento.LOCAL,
            STATUS: updates.STATUS !== undefined ? updates.STATUS : currentEvento.STATUS,
            LINK_MAPA: updates.LINK_MAPA !== undefined ? updates.LINK_MAPA : currentEvento.LINK_MAPA,
            COMPLEMENTO_LOCAL:
              updates.COMPLEMENTO_LOCAL !== undefined
                ? updates.COMPLEMENTO_LOCAL
                : currentEvento.COMPLEMENTO_LOCAL
          };

          const rowNumber = i + 2;
          const rowValues = this.mapEventoToRow_(updatedEvento);
          const range = sheet.getRange(rowNumber, 1, 1, numCols);
          range.setNumberFormat('@');
          range.setValues([rowValues]);

          return updatedEvento;
        }
      }

      throw new Error(`Evento com UUID "${idEvento}" não localizado.`);
    });
  }

  /**
   * Remove um evento pelo seu UUID (ID_EVENTO) e opcionalmente exclui inscrições vinculadas.
   * @param {string} idEvento UUID do evento.
   * @param {boolean} [cascadeInscricoes=true] Se verdadeiro, remove inscrições vinculadas.
   * @returns {{deletedEvento: boolean, deletedInscricoesCount: number}}
   */
  deleteEventoById(idEvento, cascadeInscricoes = true) {
    if (!SecurityUtils.isValidUuid(idEvento)) {
      throw new Error('Identificador de evento inválido (UUID esperado).');
    }

    return this.withWriteLock_(() => {
      const sheetEventos = this.ensureTable_(
        Environment.TABLES.EVENTOS.NAME,
        Environment.TABLES.EVENTOS.COLUMNS
      );
      const lastRowEv = sheetEventos.getLastRow();
      if (lastRowEv <= 1) {
        throw new Error('Evento não encontrado para exclusão.');
      }

      const targetId = idEvento.trim().toLowerCase();
      const idsEv = sheetEventos.getRange(2, 1, lastRowEv - 1, 1).getValues();
      let deletedEvento = false;

      for (let i = idsEv.length - 1; i >= 0; i--) {
        if (String(idsEv[i][0] || '').trim().toLowerCase() === targetId) {
          sheetEventos.deleteRow(i + 2);
          deletedEvento = true;
          break;
        }
      }

      if (!deletedEvento) {
        throw new Error(`Evento com UUID "${idEvento}" não localizado para exclusão.`);
      }

      let deletedInscricoesCount = 0;
      if (cascadeInscricoes) {
        const sheetInscricoes = this.ensureTable_(
          Environment.TABLES.INSCRICOES.NAME,
          Environment.TABLES.INSCRICOES.COLUMNS
        );
        const lastRowIns = sheetInscricoes.getLastRow();
        if (lastRowIns > 1) {
          const numColsIns = Environment.TABLES.INSCRICOES.COLUMNS.length;
          const totalDataRows = lastRowIns - 1;
          const allInsRows = sheetInscricoes.getRange(2, 1, totalDataRows, numColsIns).getValues();
          const keptRows = [];

          for (let j = 0; j < allInsRows.length; j++) {
            if (String(allInsRows[j][1] || '').trim().toLowerCase() === targetId) {
              deletedInscricoesCount += 1;
            } else {
              keptRows.push(allInsRows[j]);
            }
          }

          if (deletedInscricoesCount > 0) {
            sheetInscricoes.getRange(2, 1, totalDataRows, numColsIns).clearContent();
            if (keptRows.length > 0) {
              const formats = keptRows.map(() => [
                '@',
                '@',
                '@',
                '@',
                '@',
                '@',
                '@',
                'General',
                '@',
                'General',
                '@'
              ]);
              const writeRange = sheetInscricoes.getRange(2, 1, keptRows.length, numColsIns);
              writeRange.setNumberFormats(formats);
              writeRange.setValues(keptRows);
            }
            const trailingRows = totalDataRows - keptRows.length;
            if (trailingRows > 0 && typeof sheetInscricoes.deleteRows === 'function') {
              sheetInscricoes.deleteRows(keptRows.length + 2, trailingRows);
            }
          }
        }
      }

      return { deletedEvento, deletedInscricoesCount };
    });
  }

  /* ==========================================================================
   * OPERAÇÕES DA TABELA: INSCRICOES
   * ========================================================================== */

  /**
   * Lista todas as inscrições cadastradas na tabela INSCRICOES.
   * @returns {Array<Object>} Lista de objetos de inscrição.
   */
  findAllInscricoes() {
    const sheet = this.ensureTable_(
      Environment.TABLES.INSCRICOES.NAME,
      Environment.TABLES.INSCRICOES.COLUMNS
    );
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return [];
    }

    const numCols = Environment.TABLES.INSCRICOES.COLUMNS.length;
    const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

    return values
      .map((row) => this.mapRowToInscricao_(row))
      .filter((ins) => Boolean(ins.ID_INSCRICAO));
  }

  /**
   * Filtra inscrições pertencentes a um evento específico (FK ID_EVENTO).
   * @param {string} idEvento UUID do evento.
   * @returns {Array<Object>} Lista de inscrições do evento.
   */
  findInscricoesByEventoId(idEvento) {
    if (!SecurityUtils.isValidUuid(idEvento)) {
      return [];
    }
    const targetId = idEvento.trim().toLowerCase();
    return this.findAllInscricoes().filter(
      (ins) => ins.ID_EVENTO.toLowerCase() === targetId
    );
  }

  /**
   * Busca uma inscrição específica pelo seu UUID persistente (ID_INSCRICAO).
   * @param {string} idInscricao UUID da inscrição.
   * @returns {Object|null} Inscrição encontrada ou null.
   */
  findInscricaoById(idInscricao) {
    if (!SecurityUtils.isValidUuid(idInscricao)) {
      return null;
    }
    const targetId = idInscricao.trim().toLowerCase();
    return (
      this.findAllInscricoes().find(
        (ins) => ins.ID_INSCRICAO.toLowerCase() === targetId
      ) || null
    );
  }

  /**
   * Insere uma nova inscrição na tabela INSCRICOES.
   * @param {Object} inscricaoData Dados validados da inscrição.
   * @returns {Object} Inscrição persistida com ID_INSCRICAO gerado.
   */
  insertInscricao(inscricaoData) {
    return this.withWriteLock_(() => {
      const sheet = this.ensureTable_(
        Environment.TABLES.INSCRICOES.NAME,
        Environment.TABLES.INSCRICOES.COLUMNS
      );

      const novaInscricao = {
        ID_INSCRICAO: SecurityUtils.isValidUuid(inscricaoData.ID_INSCRICAO)
          ? inscricaoData.ID_INSCRICAO.trim().toLowerCase()
          : SecurityUtils.generateUuid(),
        ID_EVENTO: String(inscricaoData.ID_EVENTO).trim().toLowerCase(),
        NOME_COMPLETO: inscricaoData.NOME_COMPLETO,
        CIDADE: inscricaoData.CIDADE,
        FUNCAO: inscricaoData.FUNCAO,
        EMAIL: inscricaoData.EMAIL || '',
        TELEFONE: inscricaoData.TELEFONE || '',
        ACEITE_LGPD: Boolean(inscricaoData.ACEITE_LGPD),
        DATA_HORA_ACEITE: inscricaoData.DATA_HORA_ACEITE || SecurityUtils.getCurrentIsoTimestamp(),
        PRESENCA_CONFIRMADA: Boolean(inscricaoData.PRESENCA_CONFIRMADA),
        DATA_HORA_PRESENCA: inscricaoData.DATA_HORA_PRESENCA || ''
      };

      const rowValues = this.mapInscricaoToRow_(novaInscricao);
      const nextRow = sheet.getLastRow() + 1;
      const targetRange = sheet.getRange(nextRow, 1, 1, rowValues.length);
      targetRange.setNumberFormats([
        ['@', '@', '@', '@', '@', '@', '@', 'General', '@', 'General', '@']
      ]);
      targetRange.setValues([rowValues]);

      return novaInscricao;
    });
  }

  /**
   * Atualiza campos de uma inscrição localizando-a exclusivamente pelo UUID (ID_INSCRICAO).
   * @param {string} idInscricao UUID da inscrição.
   * @param {Object} updates Campos a atualizar.
   * @returns {Object} Inscrição atualizada.
   * @throws {Error} Se a inscrição não for encontrada.
   */
  updateInscricaoById(idInscricao, updates) {
    if (!SecurityUtils.isValidUuid(idInscricao)) {
      throw new Error('Identificador de inscrição inválido (UUID esperado).');
    }

    return this.withWriteLock_(() => {
      const sheet = this.ensureTable_(
        Environment.TABLES.INSCRICOES.NAME,
        Environment.TABLES.INSCRICOES.COLUMNS
      );
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        throw new Error('Nenhuma inscrição encontrada na base de dados.');
      }

      const numCols = Environment.TABLES.INSCRICOES.COLUMNS.length;
      const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
      const targetId = idInscricao.trim().toLowerCase();

      for (let i = 0; i < values.length; i++) {
        const currentId = String(values[i][0] || '').trim().toLowerCase();
        if (currentId === targetId) {
          const currentInscricao = this.mapRowToInscricao_(values[i]);
          const updatedInscricao = {
            ID_INSCRICAO: currentInscricao.ID_INSCRICAO,
            ID_EVENTO: updates.ID_EVENTO !== undefined ? updates.ID_EVENTO : currentInscricao.ID_EVENTO,
            NOME_COMPLETO: updates.NOME_COMPLETO !== undefined ? updates.NOME_COMPLETO : currentInscricao.NOME_COMPLETO,
            CIDADE: updates.CIDADE !== undefined ? updates.CIDADE : currentInscricao.CIDADE,
            FUNCAO: updates.FUNCAO !== undefined ? updates.FUNCAO : currentInscricao.FUNCAO,
            EMAIL: updates.EMAIL !== undefined ? updates.EMAIL : currentInscricao.EMAIL,
            TELEFONE: updates.TELEFONE !== undefined ? updates.TELEFONE : currentInscricao.TELEFONE,
            ACEITE_LGPD: updates.ACEITE_LGPD !== undefined ? Boolean(updates.ACEITE_LGPD) : currentInscricao.ACEITE_LGPD,
            DATA_HORA_ACEITE: updates.DATA_HORA_ACEITE !== undefined ? updates.DATA_HORA_ACEITE : currentInscricao.DATA_HORA_ACEITE,
            PRESENCA_CONFIRMADA:
              updates.PRESENCA_CONFIRMADA !== undefined
                ? Boolean(updates.PRESENCA_CONFIRMADA)
                : currentInscricao.PRESENCA_CONFIRMADA,
            DATA_HORA_PRESENCA:
              updates.DATA_HORA_PRESENCA !== undefined
                ? updates.DATA_HORA_PRESENCA
                : currentInscricao.DATA_HORA_PRESENCA
          };

          const rowNumber = i + 2;
          const rowValues = this.mapInscricaoToRow_(updatedInscricao);
          const targetRange = sheet.getRange(rowNumber, 1, 1, numCols);
          targetRange.setNumberFormats([
            ['@', '@', '@', '@', '@', '@', '@', 'General', '@', 'General', '@']
          ]);
          targetRange.setValues([rowValues]);

          return updatedInscricao;
        }
      }

      throw new Error(`Inscrição com UUID "${idInscricao}" não localizada.`);
    });
  }

  /**
   * Remove uma inscrição específica pelo seu UUID (ID_INSCRICAO).
   * @param {string} idInscricao UUID da inscrição.
   * @returns {boolean} True se removida com sucesso.
   */
  deleteInscricaoById(idInscricao) {
    if (!SecurityUtils.isValidUuid(idInscricao)) {
      throw new Error('Identificador de inscrição inválido (UUID esperado).');
    }

    return this.withWriteLock_(() => {
      const sheet = this.ensureTable_(
        Environment.TABLES.INSCRICOES.NAME,
        Environment.TABLES.INSCRICOES.COLUMNS
      );
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        throw new Error('Inscrição não encontrada para exclusão.');
      }

      const targetId = idInscricao.trim().toLowerCase();
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

          for (let i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0] || '').trim().toLowerCase() === targetId) {
          sheet.deleteRow(i + 2);
          return true;
        }
      }

      throw new Error(`Inscrição com UUID "${idInscricao}" não localizada para exclusão.`);
    });
  }

  /* ==========================================================================
   * REPOSITÓRIO DE FUNÇÕES / MINISTÉRIOS (TABELA: FUNCOES)
   * ========================================================================== */

  /**
   * Converte uma linha da aba FUNCOES em um objeto de domínio tipado.
   * @param {Array<*>} row Linha bruta da planilha.
   * @returns {{FUNCAO_ID: string, FUNCAO: string, TIPO: string, ATIVO: boolean}}
   * @private
   */
  mapRowToFuncao_(row) {
    return {
      FUNCAO_ID: String(row[0] || '').trim().toUpperCase(),
      FUNCAO: String(row[1] || '').trim(),
      TIPO: String(row[2] || 'Outros').trim(),
      ATIVO: SecurityUtils.parseBoolean(row[3])
    };
  }

  /**
   * Converte um objeto Função em linha ordenada conforme o schema FUNCOES.
   * @param {Object} fn Objeto Função.
   * @returns {Array<*>}
   * @private
   */
  mapFuncaoToRow_(fn) {
    return [
      String(fn.FUNCAO_ID || '').trim().toUpperCase(),
      String(fn.FUNCAO || '').trim(),
      String(fn.TIPO || 'Outros').trim(),
      Boolean(fn.ATIVO)
    ];
  }

  /**
   * Gera o próximo código sequencial no padrão FUNC-1001, FUNC-1002, etc.
   * @param {Array<Object>} existingList Lista atual de funções.
   * @returns {string} Código gerado.
   * @private
   */
  generateNextFuncaoId_(existingList) {
    let maxSeq = 1000;
    (existingList || []).forEach((item) => {
      const m = String(item.FUNCAO_ID || '').match(/^FUNC-(\d+)$/i);
      if (m) {
        const num = parseInt(m[1], 10);
        if (!Number.isNaN(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    });
    return `FUNC-${maxSeq + 1}`;
  }

  /**
   * Lista todas as funções cadastradas na aba FUNCOES.
   * @returns {Array<{FUNCAO_ID: string, FUNCAO: string, TIPO: string, ATIVO: boolean}>}
   */
  findAllFuncoes() {
    const sheet = this.ensureFuncoesInitialized_();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return [];
    }

    const numCols = Environment.TABLES.FUNCOES.COLUMNS.length;
    const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    return values
      .map((row) => this.mapRowToFuncao_(row))
      .filter((fn) => Boolean(fn.FUNCAO_ID && fn.FUNCAO));
  }

  /**
   * Retorna os nomes das funções atualmente ativas no catálogo.
   * @returns {Array<string>}
   */
  findActiveFuncaoNames() {
    return this.findAllFuncoes()
      .filter((fn) => fn.ATIVO)
      .map((fn) => fn.FUNCAO);
  }

  /**
   * Busca uma função específica pelo código FUNCAO_ID.
   * @param {string} funcaoId Código (ex: FUNC-1001).
   * @returns {Object|null}
   */
  findFuncaoById(funcaoId) {
    const target = String(funcaoId || '').trim().toUpperCase();
    if (!target) return null;
    return this.findAllFuncoes().find((fn) => fn.FUNCAO_ID.toUpperCase() === target) || null;
  }

  /**
   * Insere uma nova função na tabela FUNCOES.
   * @param {{FUNCAO_ID?: string, FUNCAO: string, TIPO: string, ATIVO?: boolean}} funcaoData
   * @returns {Object} Função persistida.
   */
  insertFuncao(funcaoData) {
    return this.withWriteLock_(() => {
      const sheet = this.ensureFuncoesInitialized_();
      const existing = this.findAllFuncoes();

      const codigo = funcaoData.FUNCAO_ID
        ? String(funcaoData.FUNCAO_ID).trim().toUpperCase()
        : this.generateNextFuncaoId_(existing);

      const novaFuncao = {
        FUNCAO_ID: codigo,
        FUNCAO: String(funcaoData.FUNCAO || '').trim(),
        TIPO: String(funcaoData.TIPO || 'Outros').trim(),
        ATIVO: funcaoData.ATIVO !== undefined ? Boolean(funcaoData.ATIVO) : true
      };

      const rowValues = this.mapFuncaoToRow_(novaFuncao);
      const nextRow = sheet.getLastRow() + 1;
      const range = sheet.getRange(nextRow, 1, 1, rowValues.length);
      range.setNumberFormats([['@', '@', '@', 'General']]);
      range.setValues([rowValues]);

      return novaFuncao;
    });
  }

  /**
   * Atualiza uma função existente localizando-a pelo FUNCAO_ID.
   * @param {string} funcaoId Código da função.
   * @param {Object} updates Campos a atualizar.
   * @returns {Object} Função atualizada.
   */
  updateFuncaoById(funcaoId, updates) {
    const target = String(funcaoId || '').trim().toUpperCase();
    if (!target) {
      throw new Error('Identificador de função inválido.');
    }

    return this.withWriteLock_(() => {
      const sheet = this.ensureFuncoesInitialized_();
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        throw new Error('Nenhuma função encontrada na base de dados.');
      }

      const numCols = Environment.TABLES.FUNCOES.COLUMNS.length;
      const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

      for (let i = 0; i < values.length; i++) {
        const currentId = String(values[i][0] || '').trim().toUpperCase();
        if (currentId === target) {
          const current = this.mapRowToFuncao_(values[i]);
          const updated = {
            FUNCAO_ID: current.FUNCAO_ID,
            FUNCAO: updates.FUNCAO !== undefined ? updates.FUNCAO : current.FUNCAO,
            TIPO: updates.TIPO !== undefined ? updates.TIPO : current.TIPO,
            ATIVO: updates.ATIVO !== undefined ? Boolean(updates.ATIVO) : current.ATIVO
          };

          const rowNumber = i + 2;
          const rowValues = this.mapFuncaoToRow_(updated);
          const range = sheet.getRange(rowNumber, 1, 1, numCols);
          range.setNumberFormats([['@', '@', '@', 'General']]);
          range.setValues([rowValues]);
          return updated;
        }
      }

      throw new Error(`Função "${funcaoId}" não localizada.`);
    });
  }

  /**
   * Remove uma função da aba FUNCOES pelo seu FUNCAO_ID.
   * @param {string} funcaoId Código da função.
   * @returns {boolean}
   */
  deleteFuncaoById(funcaoId) {
    const target = String(funcaoId || '').trim().toUpperCase();
    if (!target) {
      throw new Error('Identificador de função inválido.');
    }

    return this.withWriteLock_(() => {
      const sheet = this.ensureFuncoesInitialized_();
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        throw new Error('Função não encontrada para exclusão.');
      }

      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0] || '').trim().toUpperCase() === target) {
          sheet.deleteRow(i + 2);
          return true;
        }
      }

      throw new Error(`Função "${funcaoId}" não localizada para exclusão.`);
    });
  }

  /**
   * Insere em lote funções que ainda não existam na tabela FUNCOES (sem duplicar nomes).
   * @param {Array<{FUNCAO: string, TIPO: string, ATIVO?: boolean}>} catalogItems
   * @returns {{addedCount: number, addedItems: Array<Object>}}
   */
  seedFuncoesCatalogo(catalogItems) {
    return this.withWriteLock_(() => {
      const sheet = this.ensureFuncoesInitialized_();
      const existing = this.findAllFuncoes();
      const existingNames = new Set(
        existing.map((f) => SecurityUtils.normalizeSearchText(f.FUNCAO))
      );

      let maxSeq = 1000;
      existing.forEach((item) => {
        const m = String(item.FUNCAO_ID || '').match(/^FUNC-(\d+)$/i);
        if (m) {
          const num = parseInt(m[1], 10);
          if (!Number.isNaN(num) && num > maxSeq) maxSeq = num;
        }
      });

      const toInsert = [];
      (catalogItems || []).forEach((item) => {
        const cleanName = SecurityUtils.sanitizeText(item.FUNCAO, 120);
        if (!cleanName) return;
        const normName = SecurityUtils.normalizeSearchText(cleanName);
        if (existingNames.has(normName)) return;

        existingNames.add(normName);
        maxSeq += 1;
        toInsert.push({
          FUNCAO_ID: `FUNC-${maxSeq}`,
          FUNCAO: cleanName,
          TIPO: SecurityUtils.sanitizeText(item.TIPO || 'Outros', 60) || 'Outros',
          ATIVO: item.ATIVO !== undefined ? Boolean(item.ATIVO) : true
        });
      });

      if (toInsert.length > 0) {
        const startRow = sheet.getLastRow() + 1;
        const numCols = Environment.TABLES.FUNCOES.COLUMNS.length;
        const rows = toInsert.map((fn) => this.mapFuncaoToRow_(fn));
        const range = sheet.getRange(startRow, 1, rows.length, numCols);
        range.setNumberFormats(rows.map(() => ['@', '@', '@', 'General']));
        range.setValues(rows);
      }

      return {
        addedCount: toInsert.length,
        addedItems: toInsert
      };
    });
  }
}

