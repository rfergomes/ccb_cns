/**
 * @fileoverview Utilitários de segurança, criptografia leve, sanitização contra
 * XSS / Formula Injection, geração de UUID v4 e validações de conformidade LGPD.
 */

const SecurityUtils = (() => {
  /**
   * Expressão regular para validação de UUID v4 canônico.
   * @type {RegExp}
   */
  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  /**
   * Expressão regular para validação de UUID genérico.
   * @type {RegExp}
   */
  const UUID_GENERIC_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Expressão regular para formato de data ISO (YYYY-MM-DD).
   * @type {RegExp}
   */
  const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

  /**
   * Expressão regular para formato de hora (HH:mm).
   * @type {RegExp}
   */
  const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

  /**
   * Expressão regular para validação de e-mail.
   * @type {RegExp}
   */
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /**
   * Gera um identificador único universal (UUID v4) persistente via Google Apps Script.
   * @returns {string} UUID v4 em letras minúsculas.
   */
  function generateUuid() {
    return Utilities.getUuid().toLowerCase();
  }

  /**
   * Verifica se uma string corresponde a um UUID válido.
   * @param {string} value Valor a ser testado.
   * @returns {boolean} True se for um UUID válido.
   */
  function isValidUuid(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    return UUID_V4_REGEX.test(trimmed) || UUID_GENERIC_REGEX.test(trimmed);
  }

  /**
   * Compara duas strings em tempo constante para mitigar ataques de temporização (timing attacks).
   * @param {string} a Primeira string.
   * @param {string} b Segunda string.
   * @returns {boolean} True se forem idênticas.
   * @private
   */
  function constantTimeEquals_(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      return false;
    }
    const lenA = a.length;
    const lenB = b.length;
    const maxLen = Math.max(lenA, lenB);
    let diff = lenA ^ lenB;

    for (let i = 0; i < maxLen; i++) {
      const charA = i < lenA ? a.charCodeAt(i) : 0;
      const charB = i < lenB ? b.charCodeAt(i) : 0;
      diff |= charA ^ charB;
    }
    return diff === 0;
  }

  /**
   * Valida a chave administrativa informada contra o ADMIN_SECRET armazenado no PropertiesService.
   * @param {string} providedSecret Segredo enviado pelo cliente.
   * @returns {boolean} True se o segredo for válido.
   */
  function verifyAdminSecret(providedSecret) {
    if (!providedSecret || typeof providedSecret !== 'string') {
      return false;
    }
    const expectedSecret = Environment.getAdminSecret();
    return constantTimeEquals_(providedSecret.trim(), expectedSecret);
  }

  /**
   * Lança exceção de acesso negado caso a chave administrativa seja inválida.
   * @param {string} providedSecret Segredo enviado pelo cliente.
   * @throws {Error} Erro de autorização caso a chave não coincida.
   */
  function assertAdminAuthorized(providedSecret) {
    if (!verifyAdminSecret(providedSecret)) {
      throw new Error('Acesso não autorizado: Chave administrativa inválida ou ausente.');
    }
  }

  /**
   * Sanitiza texto de entrada removendo tags HTML perigosas e prevenindo
   * Formula Injection no Google Sheets (caracteres iniciais =, +, -, @).
   * @param {*} input Valor de entrada.
   * @param {number} [maxLength=255] Tamanho máximo permitido.
   * @returns {string} String limpa e segura para armazenamento.
   */
  function sanitizeText(input, maxLength = 255) {
    if (input === null || input === undefined) {
      return '';
    }
    let clean = String(input)
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/<[^>]*>?/gm, '')
      .trim();

    if (/^[=+\-@]/.test(clean)) {
      clean = "'" + clean;
    }

    if (maxLength > 0 && clean.length > maxLength) {
      clean = clean.substring(0, maxLength).trim();
    }
    return clean;
  }

  /**
   * Sanitiza e valida endereço de e-mail obrigatório.
   * @param {string} email E-mail informado.
   * @param {boolean} [required=true] Se verdadeiro, exige preenchimento.
   * @returns {string} E-mail normalizado em minúsculas.
   * @throws {Error} Se o e-mail estiver ausente (quando obrigatório) ou com formato inválido.
   */
  function sanitizeEmail(email, required = true) {
    if (!email || !String(email).trim()) {
      if (required) {
        throw new Error('O campo "E-mail" é obrigatório para identificação e credenciamento.');
      }
      return '';
    }
    const clean = sanitizeText(email, 160).toLowerCase();
    if (!EMAIL_REGEX.test(clean)) {
      throw new Error('O endereço de e-mail informado possui um formato inválido.');
    }
    return clean;
  }

  /**
   * Extrai apenas os dígitos numéricos de um telefone.
   * @param {string} phone Telefone informado.
   * @returns {string} Somente números.
   */
  function extractPhoneDigits(phone) {
    if (!phone) return '';
    return String(phone).replace(/\D/g, '');
  }

  /**
   * Sanitiza e valida número de telefone obrigatório (DDD + número: 10 ou 11 dígitos).
   * @param {string} phone Telefone informado.
   * @param {boolean} [required=true] Se verdadeiro, exige preenchimento válido.
   * @returns {string} Telefone formatado no padrão brasileiro (XX) XXXXX-XXXX.
   * @throws {Error} Caso o telefone seja inválido ou ausente quando obrigatório.
   */
  function sanitizePhone(phone, required = true) {
    const digits = extractPhoneDigits(phone);
    if (!digits) {
      if (required) {
        throw new Error('O campo "Telefone / Celular" com DDD é obrigatório.');
      }
      return '';
    }
    if (digits.length < 10 || digits.length > 11) {
      throw new Error(
        'Informe um número de telefone/celular válido com DDD (10 ou 11 dígitos, ex: (19) 99999-9999).'
      );
    }
    if (digits.length === 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  /**
   * Verifica de forma segura se o telefone informado no auto-credenciamento
   * confere com o telefone cadastrado na inscrição (aceita telefone completo com DDD,
   * sem DDD ou os 4 últimos dígitos quando combinado com o e-mail cadastrado).
   *
   * @param {string} registeredPhone Telefone gravado na inscrição.
   * @param {string} candidateInput Valor informado pelo participante na validação.
   * @returns {boolean} True se houver correspondência segura.
   */
  function matchesPhoneVerification(registeredPhone, candidateInput) {
    const regDigits = extractPhoneDigits(registeredPhone);
    const candDigits = extractPhoneDigits(candidateInput);

    if (!regDigits || regDigits.length < 4 || !candDigits || candDigits.length < 4) {
      return false;
    }

    // Se informou o telefone completo (10 ou 11 dígitos)
    if (candDigits.length >= 10) {
      return regDigits === candDigits || regDigits.endsWith(candDigits.slice(-8));
    }

    // Se informou os últimos 4 a 9 dígitos do telefone cadastrado
    return regDigits.endsWith(candDigits);
  }

  /**
   * Mascara um endereço de e-mail para exibição pública segura (LGPD).
   * Exemplo: "rodrigo.lima@dominio.com" -> "ro***ma@dominio.com".
   * @param {string} email E-mail completo.
   * @returns {string} E-mail mascarado.
   */
  function maskEmailForDisplay(email) {
    if (!email || !String(email).includes('@')) return '';
    const [local, domain] = String(email).trim().split('@');
    if (local.length <= 3) {
      return `${local[0]}***@${domain}`;
    }
    return `${local.slice(0, 2)}***${local.slice(-2)}@${domain}`;
  }

  /**
   * Retorna o timestamp atual no padrão ISO 8601 com offset do fuso horário configurado.
   * @returns {string} Exemplo: "2026-11-10T09:30:00-03:00".
   */
  function getCurrentIsoTimestamp() {
    const tz = Environment.getTimeZone();
    return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  /**
   * Retorna a data corrente no fuso horário da aplicação no formato YYYY-MM-DD.
   * @returns {string} Data de hoje (YYYY-MM-DD).
   */
  function getTodayDateString() {
    const tz = Environment.getTimeZone();
    return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  }

  /**
   * Retorna o horário corrente no fuso horário da aplicação no formato HH:mm.
   * @returns {string} Hora atual (HH:mm).
   */
  function getCurrentTimeString() {
    const tz = Environment.getTimeZone();
    return Utilities.formatDate(new Date(), tz, 'HH:mm');
  }

  /**
   * Avalia a janela de liberação do check-in (credenciamento de presença).
   * Por padrão, o check-in é liberado somente a partir de 1 hora (60 minutos)
   * antes da data/hora de início programada para a reunião.
   *
   * @param {string} dataEvento Data do evento em YYYY-MM-DD.
   * @param {string} horaEvento Hora de início da reunião em HH:mm.
   * @param {number} [advanceMinutes=60] Minutos de antecedência para liberar o check-in (padrão: 60).
   * @returns {{
   *   isOpen: boolean,
   *   advanceMinutes: number,
   *   eventDateIso: string,
   *   eventDateBr: string,
   *   eventTime: string,
   *   releaseDateIso: string,
   *   releaseDateBr: string,
   *   releaseTime: string,
   *   minutesUntilOpen: number,
   *   lockMessage: string
   * }}
   */
  function evaluateCheckInWindow(dataEvento, horaEvento, advanceMinutes = 60) {
    const cleanDate = normalizeDateString(dataEvento);
    const cleanTime = isValidTimeHhMm(normalizeTimeString(horaEvento))
      ? normalizeTimeString(horaEvento)
      : '00:00';

    if (!isValidDateIso(cleanDate)) {
      return {
        isOpen: false,
        advanceMinutes,
        eventDateIso: cleanDate || '',
        eventDateBr: '—',
        eventTime: cleanTime,
        releaseDateIso: '',
        releaseDateBr: '—',
        releaseTime: '—',
        minutesUntilOpen: 0,
        lockMessage: 'Data ou horário da reunião inválidos para liberação de check-in.'
      };
    }

    const [evY, evM, evD] = cleanDate.split('-').map(Number);
    const [evH, evMin] = cleanTime.split(':').map(Number);
    const eventWallMs = Date.UTC(evY, evM - 1, evD, evH, evMin, 0);
    const releaseWallMs = eventWallMs - advanceMinutes * 60 * 1000;

    const nowDateStr = getTodayDateString();
    const nowTimeStr = getCurrentTimeString();
    const [nowY, nowM, nowD] = nowDateStr.split('-').map(Number);
    const [nowH, nowMin] = nowTimeStr.split(':').map(Number);
    const nowWallMs = Date.UTC(nowY, nowM - 1, nowD, nowH, nowMin, 0);

    const releaseObj = new Date(releaseWallMs);
    const relY = String(releaseObj.getUTCFullYear());
    const relM = String(releaseObj.getUTCMonth() + 1).padStart(2, '0');
    const relD = String(releaseObj.getUTCDate()).padStart(2, '0');
    const relH = String(releaseObj.getUTCHours()).padStart(2, '0');
    const relMin = String(releaseObj.getUTCMinutes()).padStart(2, '0');

    const releaseDateIso = `${relY}-${relM}-${relD}`;
    const releaseDateBr = `${relD}/${relM}/${relY}`;
    const releaseTime = `${relH}:${relMin}`;
    const eventDateBr = `${String(evD).padStart(2, '0')}/${String(evM).padStart(2, '0')}/${evY}`;

    const isOpen = nowWallMs >= releaseWallMs;
    const minutesUntilOpen = isOpen ? 0 : Math.ceil((releaseWallMs - nowWallMs) / 60000);

    return {
      isOpen,
      advanceMinutes,
      eventDateIso: cleanDate,
      eventDateBr,
      eventTime: cleanTime,
      releaseDateIso,
      releaseDateBr,
      releaseTime,
      minutesUntilOpen,
      lockMessage: isOpen
        ? 'Credenciamento liberado.'
        : `O credenciamento de presença (check-in) está bloqueado e será l