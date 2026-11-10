# Agenda CNS — CCB Regional Campinas/SP

Sistema web completo desenvolvido em **Google Apps Script (V8 Runtime)** para a gestão de convocações, credenciamento com emissão de **QR Code individual**, controle de presença em tempo real via câmera e indicadores gerenciais das reuniões da **Comissão de Negociadores de Suprimentos (CNS)** da **Congregação Cristã no Brasil (CCB) — Regional Campinas/SP**, em estrita conformidade com a **LGPD (Lei nº 13.709/2018)**.

---

## 1. Arquitetura do Projeto

```text
gs_cns/
├── .clasp.json                     # Configuração do @google/clasp apontando para {"rootDir": "dist"}
├── package.json                    # Scripts de build, testes automatizados e deploy via pnpm/clasp
├── scripts/
│   ├── build.js                    # Empacotador que prepara os artefatos em dist/
│   └── test-suite.js               # Suíte de testes automatizados com mock do runtime V8 do GAS
├── src/
│   ├── appsscript.json             # Manifesto Google Apps Script (V8, America/Sao_Paulo)
│   ├── Code.js                     # Controller/Router canônico doGet(e) e endpoints RPC
│   ├── config/
│   │   └── Environment.js          # Leitura de PropertiesService e constantes da Regional Campinas
│   ├── utils/
│   │   └── SecurityUtils.js        # UUID v4, sanitização contra XSS/Formula Injection e validação
│   ├── repositories/
│   │   └── SheetsRepository.js     # Acesso exclusivo ao Google Sheets protegido por LockService
│   ├── services/
│   │   ├── InscriptionService.js   # Regras de negócio do Portal Público e conformidade LGPD
│   │   └── AdminService.js         # KPIs, agregações para gráficos, CRUDs e Check-in óptico
│   └── html/
│       ├── Index.html              # Estrutura HTML5 semântica (Portal Público + Painel Admin)
│       ├── AppStyles.html          # Identidade Visual Institucional CCB (Verdana, #033D60)
│       └── AppScripts.html         # Lógica cliente ES6+ (Select2, SweetAlert2, Toastr, QR, Charts, XLSX)
└── dist/                           # Artefatos gerados por `pnpm run build` prontos para `clasp push`
```

---

## 2. Configuração de Segurança (`PropertiesService`)

Nenhuma chave sensível é codificada no código-fonte. Antes de utilizar o sistema publicado no Google Apps Script, defina as duas propriedades abaixo em **Configurações do Projeto > Propriedades do Script**:

| Propriedade | Descrição |
| :--- | :--- |
| `SPREADSHEET_ID` | ID da planilha Google Sheets onde as abas `EVENTOS` e `INSCRICOES` serão geridas automaticamente. |
| `ADMIN_SECRET` | Chave mestra exigida para desbloquear o Painel Administrativo (`?view=admin`). |

---

## 3. Comandos de Desenvolvimento, Teste e Deploy

```powershell
# 1. Executar a suíte de testes automatizados (valida todas as regras de negócio localmente)
node scripts/test-suite.js

# 2. Gerar os artefatos de publicação no diretório dist/
node scripts/build.js

# 3. Enviar os artefatos de dist/ para o Google Apps Script via Clasp
clasp push
```

---

## 4. Rotas da Aplicação (`doGet(e)`)

- **Rota Pública (`?view=portal` ou URL raiz sem parâmetros)**:
  - Verifica se existe reunião com `STATUS = 'ATIVO'` e `DATA_EVENTO >= hoje`.
  - Exibe os dados oficiais da convocação (título, data, horário da reunião, horário do lanche e endereço), valida os campos obrigatórios (Nome Completo, Cidade da Regional Campinas, Função/Ministério e Termo de Consentimento LGPD) e emite o comprovante com **QR Code** (`qrcodejs`) contendo o UUID v4 da inscrição.
- **Rota Administrativa (`?view=admin`)**:
  - Protegida por autenticação com `ADMIN_SECRET`.
  - **Aba 1 (Dashboards & Indicadores)**: Filtro por reunião ou consolidado histórico, 4 KPIs de topo, gráfico de barras por Cidade, gráfico doughnut por Função/Ministério, exportação para **Excel (`.xlsx`)** via SheetJS e impressão de **Relatório em PDF**.
  - **Aba 2 (Gestão de Eventos)**: CRUD completo de reuniões com confirmação via SweetAlert2.
  - **Aba 3 (Gestão de Inscrições)**: Listagem filtrável, inserção manual de participantes, confirmação/desmarcação manual de presença, reemissão de QR Code e exclusão.
  - **Aba 4 (Terminal de Check-in - Recepção)**: Leitura de QR Code pela câmera em tempo real (`html5-qrcode`) com feedback sonoro (Web Audio API) e visual (Toastr + SweetAlert2).

