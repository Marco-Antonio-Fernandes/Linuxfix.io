# Fix.io Linux

Cliente Linux do sistema de gerenciamento da loja Fix.io. Este projeto é a
versão Linux do `Windows/Fixio.AdminShell`; ele não é o Fixio Shell da barra
de tarefas.

## Arquitetura

- `src/`: cópia da interface de gerenciamento mantida no projeto `web`.
- `src-tauri/`: janela nativa Tauri com WebKitGTK e ponte Linux.
- WhatsApp Web: componente WebKitGTK dentro de um contêiner GTK da janela
  principal. A posição vem da área de atendimento em pixels CSS e é convertida
  para a alocação GTK, sem coordenadas globais do desktop. Mantém o perfil em
  `~/.local/share/fixio/webview/whatsapp`, inclusive o arquivo de cookies anterior.
  Não cria janela separada. Falhas de carregamento aparecem com opção de recarregar.
- Bancada: uma área GTK recebe o servidor gráfico Xephyr com `-parent`. O Wine
  executa o arquivo escolhido no display desse servidor; suas janelas ficam
  contidas na área interna, inclusive diálogos. Não há fallback externo.
- `src-tauri/src/embedded.rs`: contêiner GTK, limites, visibilidade e WhatsApp.
- `src-tauri/src/bench.rs`: sessão Xephyr/Wine, diagnóstico e encerramento.
- `local-agent`: continua separado no repositório principal e ainda é legado
  Windows. A migração Linux será feita quando o protocolo e o código-fonte do
  agente estiverem disponíveis.

## Requisitos da integração interna

Para a Bancada, o computador Linux precisa de `wine`, `wineserver`, `Xephyr`
(pacote Arch `xorg-server-xephyr`) e um display X11 disponível via XWayland
(`xorg-xwayland` no Arch). A sessão KDE pode continuar em Wayland. O Fix.io usa
o backend X11 quando há `DISPLAY`; sem XWayland, o WhatsApp continua usando
GTK, mas a Bancada recusa iniciar. Nenhuma instalação é feita automaticamente.

Escolher um executável somente salva o caminho. É necessário clicar em
**Abrir na bancada** para iniciar. Trocar de página oculta a área e preserva a
sessão; voltar não inicia outra instância. **Encerrar** ou fechar o Fix.io encerra
os processos da sessão interna. Salve o trabalho antes de encerrar.

A Bancada usa um ambiente Wine próprio em `~/.local/share/fixio/wine-bench`
(respeitando `XDG_DATA_HOME`). Ela não reutiliza `~/.wine` nem o antigo
`wine_prefix`: um wineserver existente poderia levar o programa à tela externa.
Programas que dependem de instalação, registro ou bibliotecas nesse prefixo
precisam ser instalados nesse ambiente: selecione primeiro seu instalador na
Bancada e depois o executável instalado. As instalações anteriores não são
apagadas nem copiadas automaticamente. O Wine continua necessário para o EXE.

O display interno tem autenticação Xauthority, não escuta em TCP e usa um
bloqueio exclusivo para impedir sessões concorrentes. O diagnóstico da última
sessão é gravado em `~/.local/share/fixio/bench.log`. Isso isola as janelas, não
é uma sandbox de segurança para executáveis não confiáveis.

Esta alteração de integração foi feita **somente no código**. Ainda requer
compilação e teste visual no Linux, incluindo mouse/teclado, troca de página,
redimensionamento, QR code e encerramento. Não há confirmação de funcionamento
no computador de teste até essa validação.

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
