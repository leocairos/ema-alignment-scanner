# 🚀 Binance Crypto Alignment Scanner

Bot em Node.js que rastreia continuamente o mercado da Binance buscando alinhamentos de EMAs (8, 21, 50, 100) em múltiplos *timeframes*. Envia alertas em tempo real e um relatório HTML interativo com filtros e ordenação direto no Telegram.

## ✨ Resumo de Funcionalidades

* **Padrões Detectados:** `RECENTLY_BULLISH` (Alta), `RECENTLY_BEARISH` (Baixa) e `COMPRESSING` (Compressão pré-rompimento).
* **Filtros Inteligentes:** Filtra baixo volume (Binance) e baixo Market Cap (CoinMarketCap).
* **Bot Interativo:** Altere a estratégia em tempo real via Telegram sem reiniciar o servidor.
* **Relatório em Memória:** Gera um arquivo HTML com DataTables (ordenação e busca) e envia pela RAM, sem gastar disco do servidor.

## 🛠️ Instalação Rápida

1. Instale as dependências:
```bash
npm install dotenv technicalindicators
```

2. Crie o arquivo `.env` na raiz:
```env
CMC_API_KEY=sua_chave_coinmarketcap
TELEGRAM_BOT_TOKEN=seu_token_telegram
TELEGRAM_CHAT_ID=seu_chat_id

EXCLUDE_ASSETS=USDC,EUR,FDUSD,TUSD,BUSD,DAI,AEUR
MIN_MARKET_CAP=50000000
MIN_24H_VOL=1000000
TIMEFRAMES=15m,1h,4h,1d
```

3. Inicie o Bot:
```bash
node scanner.js
```

## 📱 Comandos do Telegram

Controle o bot diretamente pelo chat:

* `/params` - Mostra a configuração atual e estatísticas do último ciclo.
* `/set_exclude [ativos]` - Ignora moedas específicas (ex: `/set_exclude USDC, EUR`).
* `/set_cap [valor]` - Define Market Cap mínimo.
* `/set_vol [valor]` - Define Volume 24h mínimo.
* `/set_tf [tempos]` - Define os gráficos analisados (ex: `/set_tf 15m, 1h`).
* `/help` - Exibe o menu de comandos.

## 💡 Dica de Uso

No relatório HTML, copie o **Alert Time**. Ao abrir o link do TradingView, pressione `Alt + G` e cole o horário para pular exatamente para o candle que acionou o alerta do bot.