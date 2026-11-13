# PWO Intercom — MVP WebRTC

Aplicação web para direção, dois entrevistadores e produção. O áudio da equipe trafega por uma sala LiveKit; não há ligação com o OBS nesta versão.

## O que já está implementado

- Áudio bidirecional em tempo real por LiveKit/WebRTC no navegador.
- Sala com quatro perfis, cada um com código de acesso próprio.
- Entrevistadores entram sem permissão de publicar áudio. A direção concede e encerra a permissão pelo servidor LiveKit.
- Seleção dos celulares que recebem o áudio do diretor, aplicada às inscrições de áudio pelo servidor LiveKit.
- Solicitação de fala, presença, reconexão e estado da autorização.
- Microfone com cancelamento de eco, redução de ruído e ganho automático do navegador.
- Credencial de acesso LiveKit com validade curta. A chave secreta LiveKit fica somente no servidor.

O retorno do programa do OBS, mix-minus, gravação, controle de cenas e operação com tela bloqueada não fazem parte do MVP. A aplicação não captura nem envia o áudio do OBS.

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
5. Teste fone KZ, microfone correto, volume, troca entre Wi-Fi e dados móveis, tela ligada, reconexão e bateria por um período longo.
6. Faça uma transmissão simulada completa. Mantenha Mumble ou outro intercom já conhecido como plano reserva até o MVP passar o ensaio.

O áudio do intercom chega como reprodução privada no próprio aparelho. Não faça loopback/monitoramento desse áudio para uma entrada do OBS. Use fone fechado e teste com o OBS transmitindo para confirmar que o áudio privado da equipe não aparece no programa. O retorno OBS/mix-minus fica para fase posterior.

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
