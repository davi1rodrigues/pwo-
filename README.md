# PWO Intercom 1.1 — operação com duas máquinas

## Distribuição dos aparelhos

| Aparelho | Perfil | Responsabilidade |
|---|---|---|
| Máquina do Davi | Diretor | Falar com Otávio e João, autorizar respostas, selecionar destinos e ouvir retorno |
| Máquina da transmissão | Estação OBS | Enviar áudio do programa e, opcionalmente, a Câmera Virtual |
| Celular do Otávio | Otávio — Entrevistador 1 | Ouvir direção e programa; responder quando autorizado |
| Celular do João | João — Entrevistador 2 | Ouvir direção e programa; responder quando autorizado |
| Apoio, se usado | Produção | Falar com a direção |

As cenas são trocadas diretamente no OBS. A estação PWO não recebe áudio privado da equipe. O microfone de entrevista que vai ao público continua no caminho de áudio do OBS; autorizar fala no PWO não coloca ninguém no ar.

## Antes de abrir nos aparelhos

Todos devem apontar para **a mesma API PWO e a mesma sala LiveKit**. Não inicie servidores independentes para cada pessoa: permissões e seleção de destinos são mantidas em memória por um único servidor.

No servidor HTTPS existente, preserve os valores reais de `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `APP_JWT_SECRET`, `DIRECTOR_CODE`, `INTERVIEWER1_CODE`, `INTERVIEWER2_CODE`, `PRODUCER_CODE` e `ROOM_NAME`. Adicione `OBS_CODE` com um código separado, longo e aleatório. Não publique `.env` nem envie chaves LiveKit aos celulares.

Depois de atualizar o código e reiniciar a API, saia e entre novamente em todos os aparelhos. A nova interface e o novo servidor precisam ser publicados juntos. A versão anterior do APK também precisa ser recompilada para receber a interface nova.

Endereço oficial: https://pwo-esr1.onrender.com/. No navegador, abra esse endereço nos quatro aparelhos e deixe o campo Servidor vazio. O APK 1.1.0 já sugere essa API. O desktop 1.1.0 abre diretamente esse site e não inicia mais um servidor próprio nem precisa das chaves LiveKit. Use o código correspondente ao perfil. Uma identidade só pode ficar ativa em um aparelho por vez.

## Instalação e iPhone

- Windows: instalar `PWO-Intercom-Setup-1.1.0.exe`. Depois desta instalação, a interface vem do servidor ao abrir o aplicativo; futuras mudanças do executável ainda exigirão instalador.
- Android: instalar o novo APK 1.1.0. O aplicativo Android continua com interface empacotada, portanto exige novo APK para alterações da interface.
- iPhone: abrir a URL oficial no Safari, usar Compartilhar → Adicionar à Tela de Início e, quando disponível, Abrir como App Web. Esta é a versão web instalada, requer internet e não é um aplicativo TestFlight/App Store.
- A versão nativa de iPhone ainda depende de compilação em macOS/Xcode e assinatura Apple para distribuição. Não há IPA assinada nesta entrega.
- O servidor gratuito pode levar mais de 50 segundos para despertar. O login aguarda até 75 segundos; abra o site antes de iniciar a operação.

## Teste local no VS Code

Requisitos: Node.js 22+, npm e credenciais reais de um projeto LiveKit.

1. Abra a pasta do PWO.
2. Execute `npm install` (ou `npm ci` em uma cópia completa com lockfile).
3. Configure `.env` a partir de `.env.example`, sem substituir configurações reais existentes.
4. Execute `npm run dev` e abra `http://localhost:5173` no computador servidor.
5. Para celular e outra máquina, use a API hospedada por HTTPS. HTTP pelo IP de rede não é suficiente para liberar captura no navegador móvel.

`npm test` verifica regras de áudio/vídeo, isolamento da estação, autenticação, permissões, reconexão, solicitações e falhas da API. Os testes usam um serviço LiveKit simulado e despacho HTTP em memória; não comprovam o som nos equipamentos.

`npm run build` prepara `dist`. `NODE_ENV=production` com `npm start` entrega a interface pela mesma API. O Dockerfile inclui `shared`, usado pelo servidor e pela interface.

O repositório completo também mantém os projetos Electron e Android. `npm run desktop:package` gera o instalador quando o ambiente de build desktop estiver disponível; `npm run mobile:apk` recompila o Android quando o SDK/JDK estiver configurado. Esta alteração de código não é um instalador novo nem um APK já compilado.

## Configurar o retorno na máquina do OBS

1. Instale o cabo virtual nessa máquina, não no celular.
2. OBS → Configurações → Áudio → Dispositivo de monitoramento: **CABLE Input**.
3. Em Propriedades avançadas de áudio, selecione **Monitorar e enviar para a saída** apenas nas fontes desejadas.
4. Abra o PWO como **Estação OBS** e clique em **Buscar entradas**.
5. Selecione **CABLE Output** e clique em **Iniciar retorno**.
6. Reproduza áudio no OBS. O medidor **Sinal capturado nesta máquina** deve se mover.
7. No Diretor, marque os destinatários em **Quem recebe o programa**.
8. Em cada celular, toque em **Ativar áudio**, ajuste o retorno e confira o medidor **Retorno recebido neste aparelho**.

A estação não reproduz localmente sua própria captura. A escuta de conferência fica no computador Diretor, com fones. A transmissão não deve capturar a conversa do intercom. Se os entrevistadores ouvirem a própria voz atrasada, configure uma mixagem de retorno sem essa voz (mix-minus); o PWO ainda não faz essa subtração automaticamente.

Vídeo opcional: inicie a Câmera Virtual do OBS com saída Programa; na estação, busque câmeras, escolha OBS Virtual Camera e inicie vídeo. O Diretor seleciona separadamente quem recebe a imagem. O envio usa 640 × 360 a 15 fps para reduzir o consumo de rede.

## Diagnóstico quando a voz chega, mas o programa não

| Observação | Próxima conferência |
|---|---|
| Medidor da estação parado com som no OBS | Fonte selecionada, monitoramento do OBS, CABLE Input/Output e cabo instalado |
| Medidor da estação se move, mas celular aguarda faixa | Destinatário marcado, estação e celular na mesma API/sala, conexão LiveKit |
| Medidor recebido se move, mas não há som | Ativar áudio, volume do programa, volume do celular e saída/fone |
| Faixa publicada, mas silêncio nos medidores | Publicar uma faixa não comprova que ela contém som; revise a captura |
| Sessão desconectada | Saia e entre novamente; confirme rede e autorização de fala |

## Ensaio 1 — 30 de novembro de 2026

Objetivo: validar cada caminho com os dois computadores, os dois celulares e os fones reais.

- [ ] Todos usam a mesma URL HTTPS, cada um em seu perfil.
- [ ] Davi fala só com Otávio, só com João e com ambos; quem não estiver marcado não escuta.
- [ ] Cada entrevistador solicita fala; Davi autoriza, ouve a resposta e encerra a autorização.
- [ ] Após encerrar, o microfone para; após nova autorização, é possível ligá-lo novamente.
- [ ] A estação envia uma música/fonte de teste do OBS e os medidores se movem nas duas pontas.
- [ ] O volume do programa muda sem mudar a voz da direção; o volume individual funciona no Diretor.
- [ ] Davi desmarca um destinatário do programa e confirma que apenas ele deixa de ouvi-lo.
- [ ] Se necessário, vídeo chega apenas aos destinatários escolhidos.
- [ ] Uma gravação local do OBS comprova que a conversa privada não aparece no programa.
- [ ] Desconectar/reconectar o celular e a estação restaura o serviço ou permite reentrada clara.
- [ ] Registrar celular, sistema, navegador/app, fone, rede e cada falha observada.

## Ensaio 2 — 2 de dezembro de 2026

Objetivo: simular a operação por pelo menos uma hora, com os equipamentos e a rede previstos para o evento.

- [ ] Repetir todos os testes de isolamento e retorno depois das correções do primeiro ensaio.
- [ ] Trocar cenas diretamente no OBS enquanto o intercom continua funcionando.
- [ ] Alternar entrevistas e autorizações repetidamente; testar retorno com som e pausas.
- [ ] Testar perda e retomada de Wi-Fi, troca para dados móveis e reconexão de fones.
- [ ] Conferir atraso percebido, clareza no ruído ambiente, consumo de bateria e aquecimento.
- [ ] Manter celulares com tela ligada e app em primeiro plano; verificar comportamento real se bloqueados, sem depender dele.
- [ ] Ouvir a gravação do OBS para conferir ausência de voz privada, eco e áudio duplicado.
- [ ] Só considerar o fluxo pronto após a validação conjunta dos quatro aparelhos; manter uma alternativa de comunicação conhecida disponível.

## Limites e validação desta versão

- O app continua dependente de internet e de uma API HTTPS/LiveKit configurados.
- Uma instância da API e um aparelho por perfil. Seleções e pedidos não persistem após reinício.
- A seleção de destinatários combina assinaturas no servidor e permissões de faixas nos clientes oficiais; não substitui autenticação nominal nem é uma proteção contra um emissor autorizado que modifique o cliente.
- O navegador pode interromper áudio em segundo plano ou com tela bloqueada. Use primeiro plano, tela ligada, fones e alimentação adequada.
- O medidor verifica amostras de áudio, não comprova que o fone está reproduzindo.
- Testes automatizados e build web foram executados. Nenhum ensaio físico com os dois computadores e os celulares foi concluído nesta alteração.

Referências de configuração: [OBS — monitoramento e cabo virtual](https://obsproject.com/kb/video-call-streaming-tutorial/) e [LiveKit — reprodução de áudio](https://docs.livekit.io/reference/client-sdk-js/).
