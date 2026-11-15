# PWO Intercom — MVP WebRTC

Aplicação web para direção, dois entrevistadores e produção. O áudio da equipe trafega por uma sala LiveKit. A tela da direção também pode controlar uma instância local do OBS Studio via obs-websocket.

## O que já está implementado

- Áudio bidirecional em tempo real por LiveKit/WebRTC no navegador.
- Sala com quatro perfis, cada um com código de acesso próprio.
- Entrevistadores entram sem permissão de publicar áudio. A direção concede e encerra a permissão pelo servidor LiveKit.
- Seleção dos celulares que recebem o áudio do diretor, aplicada às inscrições de áudio pelo servidor LiveKit.
- Solicitação de fala, presença, reconexão e estado da autorização.
- Estado do microfone sincronizado com revogação e restauração da autorização; faixas antigas do retorno de vídeo são removidas ao chegar uma nova.
- Microfone com cancelamento de eco, redução de ruído e ganho automático do navegador.
- Credencial de acesso LiveKit com validade curta. A chave secreta LiveKit fica somente no servidor.
- Painel de Direção com abas Geral, OBS Studio, Volumes de retorno e Fala.
- Volume de retorno ajustável por entrevistador e produção, somente no aparelho do Diretor.
- Retorno de vídeo do OBS via Câmera Virtual, publicado no LiveKit em 640×360 a 15 fps e roteado somente aos destinatários escolhidos.
- Retorno do áudio do programa por uma faixa LiveKit separada, com seleção de entrada do cabo virtual e destinatários próprios.
- Volume independente para o áudio do programa nos celulares e monitor local opcional para o Diretor.
- Painel opcional do OBS: conexão, estado da live/gravação, cena atual, troca de cena e comandos de iniciar/parar.

O retorno de vídeo do programa usa a Câmera Virtual do OBS. O retorno de áudio exige um cabo virtual instalado no computador do Diretor. Mix-minus, controle de cenas em preview e operação com tela bloqueada ficam para fase posterior.

## Conectar o OBS Studio

1. No computador que executa o OBS, abra **Ferramentas → Configurações do servidor WebSocket** (em algumas versões, **Ferramentas → WebSocket Server Settings**).
2. Ative o servidor e mantenha-o acessível somente no próprio computador (endereço local `127.0.0.1`, porta padrão `4455`). Defina uma senha forte e não a compartilhe.
3. Abra o PWO no navegador desse mesmo computador, entre como Diretor e use o cartão **OBS Studio**. Informe `ws://127.0.0.1:4455` e a senha do OBS.
4. O cartão mostra o estado da transmissão e gravação e a cena no ar. A lista permite trocar a cena do programa; os botões para iniciar/parar transmissão ou gravação pedem confirmação.

O navegador conversa diretamente com o OBS, sem enviar a senha ao servidor PWO. Portanto, o OBS precisa estar no mesmo computador em que o diretor abriu o painel. Para controle remoto a partir de outro aparelho ou de uma instalação hospedada, é necessário um conector local seguro (WSS) no computador do OBS; não exponha a porta 4455 à internet nem encaminhe essa porta no roteador. A senha é mantida apenas na memória da página enquanto a sessão estiver aberta.

O painel de OBS não altera dispositivos de áudio, fontes, filtros, monitoramento ou mixagem. Configure o OBS para não monitorar a saída de áudio do intercom e use fone fechado. Isso preserva o canal privado da equipe fora do áudio transmitido.

## Retorno de áudio do programa para a equipe

No computador do Diretor, instale um cabo virtual (por exemplo, VB-CABLE da VB-Audio). Em **Configurações → Áudio → Avançado** do OBS, escolha **CABLE Input** como dispositivo de monitoramento. Em **Propriedades avançadas de áudio**, marque **Monitorar e enviar para a saída** apenas nas fontes que devem chegar ao PWO. Assim elas continuam indo à live e também ao cabo virtual. Consulte o [tutorial do OBS para chamadas de vídeo](https://obsproject.com/kb/video-call-streaming-tutorial/) e a [documentação de fontes de áudio](https://obsproject.com/kb/audio-sources).

No PWO, abra a aba **OBS Studio**, clique em **Buscar fontes de áudio**, permita o acesso ao microfone e selecione **CABLE Output**. O OBS envia o som a CABLE Input e o navegador recebe pela entrada CABLE Output. Marque os participantes e inicie **Retorno de áudio**. O áudio é publicado em uma faixa LiveKit separada do microfone do Diretor. Cada participante tem um controle de volume próprio para esse retorno.

O Diretor pode ativar **Ouvir o retorno neste computador**. Use fones. Se o OBS captura o áudio do computador/desktop, mantenha esse monitor desligado para evitar que o retorno volte para a live. Não monitore o intercom pelo OBS. O PWO não altera a mixagem e não cria mix-minus automaticamente.

## Retorno de vídeo para a equipe

1. No OBS, clique em **Iniciar Câmera Virtual** e configure a saída para **Programa**. A saída Preview pode revelar mudanças de cena antes de irem ao ar.
2. Na aba **Geral** do Diretor, clique em **Buscar fontes de vídeo** e autorize a câmera no navegador.
3. Escolha **OBS Virtual Camera**, selecione os participantes que recebem o retorno e clique em **Iniciar retorno de vídeo**.
4. Os demais perfis verão o retorno na tela do PWO. O botão pode desligar o envio a qualquer momento.

O navegador do Diretor deve estar no mesmo computador do OBS e na sala LiveKit. O vídeo é publicado com qualidade reduzida para poupar rede e bateria. A seleção de destinatários e volumes é mantida em memória durante a execução do servidor. Faça o ensaio com a transmissão privada antes de usar ao vivo.

## Pré-requisitos

- Node.js 22 ou mais recente e npm.
- Projeto LiveKit Cloud (ou servidor LiveKit público) com URL `wss://`, API key e API secret.
- Navegador atualizado. Microfone em celular exige HTTPS; `localhost` é permitido para desenvolvimento no computador.

## Executar no VS Code

1. Abra esta pasta no VS Code.
2. No terminal, execute `npm install`.
3. Copie `.env.example` para `.env` e preencha os valores do projeto LiveKit.
4. Substitua os quatro códigos por códigos diferentes e fortes. Gere também um `APP_JWT_SECRET` aleatório com pelo menos 32 caracteres.
5. Execute `npm run dev`.
6. Abra `http://localhost:5173`. Para testar em celulares, publique por HTTPS ou use um túnel HTTPS temporário; a URL HTTP do endereço LAN não libera microfone nos navegadores móveis.

O terminal inicia o servidor da aplicação na porta 3000 e o Vite na 5173. O navegador encaminha chamadas da API ao servidor local.

## App desktop para Windows

Para abrir o PWO em uma janela própria, execute `npm run desktop` na pasta do projeto. O comando prepara a interface e abre o app sem uma aba do Chrome. A janela desativada em segundo plano não reduz a atividade de áudio/vídeo e o app solicita ao Windows que mantenha o computador acordado enquanto estiver aberto. O botão **Sair** na interface encerra a sessão; fechar a janela encerra o app.

Para gerar o instalador Windows, execute `npm run desktop:package`. O arquivo será criado na pasta `release`. As credenciais não são empacotadas: no primeiro uso instalado, o app copia o `.env` de `Documents\pwo` para a pasta privada de configuração do usuário, se ele existir. Caso contrário, cria um modelo nessa pasta e pede que você preencha as credenciais. Mantenha esse arquivo privado.

O instalador inicia sua própria API local em `127.0.0.1:3010`, sem depender do servidor do VS Code. Para celulares da equipe entrarem pela internet, a API ainda precisa estar disponível em HTTPS (por hospedagem ou túnel apontado para a porta 3010 durante ensaios). O app desktop sozinho não hospeda a sala para os celulares. A conexão com a internet e o LiveKit ainda é necessária.

## App Android (APK)

O projeto Android usa a mesma interface e a logo do PWO. Para gerar um APK de instalação e atualizar os arquivos Android após mudanças na interface, execute `npm run mobile:apk`. O arquivo de teste aparece em `android/app/build/outputs/apk/debug/app-debug.apk`. No Android, permita a instalação para o app usado para abrir o APK e autorize microfone/câmera quando o PWO pedir. O APK de depuração serve para ensaios e instalação direta; publicação na Play Store exige assinatura de lançamento.

Na primeira tela, informe o endereço HTTPS público da API do PWO, depois escolha seu perfil e use o código fornecido pela produção. O endereço fica guardado somente no aparelho. O APK não inclui chaves LiveKit nem códigos de equipe. **O GitHub Pages não é a API**: para entrar na sala, a produção precisa publicar o servidor Node do PWO em HTTPS (por exemplo, em uma hospedagem ou túnel para ensaio), configurar os segredos LiveKit no servidor e compartilhar o endereço com a equipe. Uma instância única deve atender todos os celulares.

O app Android é indicado para os entrevistadores e produção. Controles locais do OBS e a câmera virtual do OBS continuam no computador Diretor; o retorno visual do programa deve ser enviado pelo OBS do computador.

## Implantar para teste externo

Uma opção simples é executar o `Dockerfile` em um serviço HTTPS (por exemplo, Render, Railway ou uma VPS com proxy TLS). Configure estas variáveis no painel do serviço, sem incluí-las no código ou no repositório:

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `APP_JWT_SECRET`, `DIRECTOR_CODE`, `INTERVIEWER1_CODE`, `INTERVIEWER2_CODE`, `PRODUCER_CODE` e opcionalmente `ROOM_NAME`/`PORT`.

O servidor entrega a interface e a API na mesma origem. Configure HTTPS e mantenha uma única instância do servidor: pedidos e seleção de destinatários ficam em memória e são reiniciados quando o processo reinicia. Antes de abrir a URL ao elenco, distribua os códigos individualmente e troque-os se houver compartilhamento indevido. Nunca publique o `.env`.

## Roteiro de teste para 30/11/2026

Faça o ensaio completo em condições parecidas com a pista, com diretor, os dois entrevistadores e produção em aparelhos/redes separados:

1. Entre com os quatro perfis e confirme o indicador de conexão.
2. Verifique que o entrevistador não transmite antes da autorização.
3. Peça fala pelo celular, autorize no perfil de direção, confirme áudio em ambas as direções e encerre a autorização.
4. Selecione cada destinatário e confira que só os escolhidos ouvem a direção.
5. Teste o retorno do programa pelo cabo virtual e confira em um celular com fone que o som não volta para a live.
6. Teste fone KZ, microfone correto, volume, troca entre Wi-Fi e dados móveis, tela ligada, reconexão e bateria por um período longo.
7. Faça uma transmissão simulada completa. Mantenha Mumble ou outro intercom já conhecido como plano reserva até o MVP passar o ensaio.

O áudio do intercom e o retorno do programa são faixas separadas. Não faça loopback/monitoramento do intercom para uma entrada do OBS. Use fone fechado e teste com o OBS transmitindo para confirmar que o áudio privado da equipe não aparece no programa.

## Limites operacionais

- Use o celular desbloqueado, navegador em primeiro plano e alimentação externa. Navegadores móveis podem suspender áudio em segundo plano.
- O projeto usa códigos de equipe compartilhados por função; não é autenticação nominal forte. Cada papel tem identidade única, portanto este piloto comporta um dispositivo ativo por função.
- A produção entra com microfone liberado para falar com a direção. Entrevistadores permanecem bloqueados até a autorização.
- A lista de pedidos e o destinatário selecionado são estado em memória, não persistem após reinício e não sincronizam entre várias instâncias.
- Use conexão estável e teste o acesso do celular à infraestrutura LiveKit. Algumas redes de evento podem bloquear mídia WebRTC; valide antes.
- A direção consegue conceder permissão de publicação apenas quando o entrevistador já está conectado. Se ficar offline, aguarde o retorno e autorize novamente.

## Arquivos principais

- `server/index.js`: autenticação por código, tokens LiveKit e controles protegidos da direção.
- `src/main.jsx`: interface, conexão de áudio e telas por perfil.
- `.env.example`: configuração local sem credenciais válidas.
