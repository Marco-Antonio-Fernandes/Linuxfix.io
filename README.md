# Fix.io Linux para Arch Linux

Este diretório é o cliente Linux do sistema de gerenciamento Fix.io. Ele é independente do `back/` e do `web/`, que permanecem em seus próprios ciclos de desenvolvimento e deploy, e também é separado de `windows/`.

O build Linux é executado a partir desta pasta:

```bash
npm install
npm run build:linux
```

O agente da bancada fica reservado em `local-agent/`, mas ainda não participa do build: o checkout atual só possui artefatos Windows do agente, sem código-fonte portável.

O Fixio Shell é um aplicativo Linux nativo para KDE Plasma. O executável é compilado pelo Tauri/Rust e leva um bundle React local dentro dele; não é um site, não precisa de servidor web e não deve ser aberto pelo navegador para funcionar.

## Arquitetura

- `src/`: interface local React/TypeScript da janela de configurações e do painel;
- `src-tauri/`: processo Rust, janelas transparentes, comandos Linux, Wine, `.desktop`, autostart e persistência;
- `themes/`: documentação e temas visuais distribuídos;
- `widgets/`: componentes de widgets do painel;
- `config/`: documentação do formato de configuração do usuário;
- `packaging/`: arquivo `.desktop` para instalação;
- `scripts/`: preparação do Arch e instalação local.

## Conteúdo web e programas Windows

O shell separa os dois tipos de conteúdo:

- **WhatsApp Web** é aberto por uma Webview filha nativa do Tauri, usando o WebKitGTK disponível no Linux. A view é criada sob demanda e reaproveitada enquanto a sessão do Fixio estiver aberta; se o backend gráfico rejeitar child webviews, o shell usa uma janela WebKitGTK própria como fallback;
- **Bancada `.exe`** continua sendo iniciada pelo backend Rust com `wine` (ou `wine64` como fallback), usando `WINEPREFIX`, argumentos, pasta de trabalho e logs individuais do atalho.

O painel informa a sessão gráfica detectada e a disponibilidade de Wine. A bancada é mantida como janela própria nesta etapa; um host X11 dedicado ainda precisa ser implementado, e em Wayland o compositor não permite que um aplicativo arbitrário seja reparentado como um elemento HTML. Isso é uma limitação do protocolo, não uma falha do WebKitGTK.

O produto final roda sem Node.js, Vite ou navegador instalado. Node.js só é usado durante a compilação do bundle e Rust compila o executável Linux.

## Preparar o Arch Linux

Na pasta do projeto:

```bash
bash scripts/arch-setup.sh
npm install
```

Para usar atalhos `.exe`, instale também:

```bash
sudo pacman -S --needed wine winetricks
```

## Executar como aplicativo Linux

O comando de desenvolvimento já abre o Tauri, e não uma página no navegador. No lançamento normal, a única coisa visível é a dock pequena sobre o desktop; clique no ícone `f` ou na engrenagem da dock para abrir as configurações:

```bash
npm run dev
```

O painel e a janela de configurações são janelas nativas do aplicativo. A URL local do Vite é somente um transporte interno que o Tauri usa durante o desenvolvimento.

O arquivo de configuração suporta até oito docks independentes. Cada uma tem seus próprios atalhos, posição, tamanho, cor, opacidade, desfoque, espaçamento, formato e widgets. Na seção **Painel**, use “Adicionar outra dock” para criar uma nova barra e selecione cada uma para editar seus controles.

No KDE Wayland, esta etapa mantém a janela Tauri como fallback e registra todas as operações nativas; a integração `layer-shell` será aplicada depois que o comportamento real do compositor estiver confirmado no log.

Durante o desenvolvimento, o backend registra a sessão, o ambiente Wayland/KDE, o monitor detectado, tamanho, coordenadas e o resultado de cada chamada nativa em `~/.local/share/fixio-shell/logs/runtime.log`. Se a dock não aparecer, deixe este arquivo aberto enquanto executa `npm run dev`.

## Gerar e instalar

```bash
npm run build:linux
bash scripts/install-linux.sh
```

Isso gera o AppImage em `src-tauri/target/release/bundle/appimage/`. O instalador local copia o AppImage para `~/.local/bin/fixio-shell` e cria o lançador do KDE em `~/.local/share/applications/fixio-shell.desktop`.

## Dados do usuário

As preferências ficam em `~/.config/fixio-shell/config.json`. Prefixos Wine gerenciados ficam em `~/.local/share/fixio-shell/wine-prefixes` e logs de execução em `~/.local/share/fixio-shell/logs`. O autostart usa `~/.config/autostart/fixio-shell.desktop`.
