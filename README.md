# Fix.io Linux

Cliente Linux do sistema de gerenciamento da loja Fix.io. Este projeto é a
versão Linux do `Windows/Fixio.AdminShell`; ele não é o Fixio Shell da barra
de tarefas.

## Arquitetura

- `src/`: cópia da interface de gerenciamento mantida no projeto `web`.
- `src-tauri/`: janela nativa Tauri com WebKitGTK e ponte Linux.
- WhatsApp Web: abre em uma WebView Tauri usando WebKitGTK, mantendo a sessão
  em `~/.local/share/fixio/webview/whatsapp`.
- Bancada: executa o `.exe` configurado pelo Wine. Em Wayland/KDE uma janela
  Wine arbitrária não pode ser reparentada dentro de HTML; por isso o cliente
  inicia o programa em janela própria e informa esse estado na interface.
- `local-agent`: continua separado no repositório principal e ainda é legado
  Windows. A migração Linux será feita quando o protocolo e o código-fonte do
  agente estiverem disponíveis.

## Desenvolvimento e build

```bash
npm ci
npm run dev
npm run build:linux
```

O build gera um AppImage em `src-tauri/target/release/bundle/appimage`.
O backend continua sendo consumido pela interface em
`https://backfixio.rotatix.com.br`; este repositório não altera o repositório
`back` nem o repositório `web` de deploy.
