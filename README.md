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
- Bancada: o cliente inicia o servidor gráfico Xephyr em um display interno e
  executa o Wine nesse display. Nesta etapa de diagnóstico, Xephyr permanece
  em uma janela própria: a tentativa de usar `-parent` com o XID GTK/XWayland
  foi retirada porque causava X11 error code 8 antes do Wine iniciar. A
  incorporação no retângulo da Bancada será retomada depois de confirmar esse
  fluxo básico.
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

A Bancada reutiliza o prefixo já instalado e validado em
`~/.local/share/fixio/wine/union` (respeitando `XDG_DATA_HOME`). Se houver um
`wine_prefix` em `~/.local/share/fixio/linux.json`, esse caminho tem prioridade
e aceita `~/`. O prefixo precisa existir: o Fix.io não cria outro ambiente,
não reinstala dependências e não altera a configuração do Wine. O executável
continua sendo escolhido pelo usuário; não há caminho fixo para o EXE.

Antes de iniciar, a Bancada verifica se esse prefixo está livre. Se o programa
do teste manual ainda estiver aberto, é preciso fechá-lo; o Fix.io não o mata
nem tenta incorporá-lo depois de aberto. Durante a sessão interna, reserve esse
prefixo à Bancada: **Encerrar** encerra o wineserver desse prefixo e seus processos.
Uma falha do Xephyr antes de iniciar o EXE não encerra sessões Wine existentes.
O Wine continua necessário para o EXE.

### Sequência automática da Bancada

1. Prepara uma janela-pai GTK nativa com o visual padrão do display X11,
   aplica o tamanho da área e sincroniza sua criação com o XWayland.
2. Inicia Xephyr com `DISPLAY` igual ao display hospedeiro (por exemplo,
   `:0`), preservando a autenticação do hospedeiro e sem `-parent` durante o
   teste de compatibilidade.
3. Deixa o próprio Xephyr reservar um display livre por `-displayfd`; não
   fixa `:99` nem remove sockets/locks de outros servidores.
4. Aguarda até 15 segundos pelo sinal de prontidão **e** pelo socket
   `/tmp/.X11-unix/X<n>`, verificando se Xephyr continua vivo. A espera pode
   ser cancelada por **Encerrar** ou ao fechar o Fix.io.
5. Só então executa `wine <executável selecionado>` com `DISPLAY=:<n>` e o
   prefixo instalado. O Xephyr fica separado temporariamente; o EXE não é
   lançado diretamente no desktop hospedeiro.

O display interno tem autenticação Xauthority, não escuta em TCP e usa um
bloqueio exclusivo para impedir sessões concorrentes. O diagnóstico da última
sessão é gravado em `~/.local/share/fixio/bench.log`, com display hospedeiro,
XID/visual/tamanho solicitado, prefixo e display interno. Falhas de partida
incluem as últimas linhas do erro do Xephyr na interface. Isso isola as janelas, não
é uma sandbox de segurança para executáveis não confiáveis.

O fluxo Wine + Xephyr em janela própria já foi validado manualmente no
Arch/KDE Wayland. Esta alteração remove temporariamente somente o `-parent`
para comparar o fluxo automático com esse teste. Ainda requer
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
