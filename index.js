const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const QRCode = require('qrcode'); // Só o do site
const express = require('express');

// ===========================================================
// CONFIGURAÇÕES
// ===========================================================

// 1. URL DO MONGODB (Substitua pela sua URL real)
const MONGO_URI = 'mongodb+srv://admin_julio:IS0DKctykYcCdx3Q@bot-zap.8dxhxws.mongodb.net/?appName=bot-zap';

// 2. ID DO SEU GRUPO
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// Variáveis leves de estado
let qrCodeImage = null;
let isConnected = false;

// ===========================================================
// SERVIDOR WEB (Visualizador Otimizado)
// ===========================================================
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    // HTML Minimalista para carregar rápido
    const htmlStart = `
        <html><head><meta http-equiv="refresh" content="5">
        <style>body{font-family:sans-serif;text-align:center;padding:20px;background:#f0f2f5}</style>
        </head><body><div style="background:white;padding:20px;border-radius:8px;display:inline-block">`;

    if (isConnected) {
        res.send(`${htmlStart}<h1 style="color:green">✅ Bot Online</h1><p>Memória Otimizada.</p></div></body></html>`);
    } else if (qrCodeImage) {
        res.send(`${htmlStart}<h2>Escaneie o QR Code</h2><img src="${qrCodeImage}" width="250"><p>Atualizando...</p></div></body></html>`);
    } else {
        res.send(`${htmlStart}<h2>⏳ Carregando...</h2><p>Aguarde o início do sistema.</p></div></body></html>`);
    }
});

app.listen(port, () => console.log(`🌍 Web OK: Porta ${port}`));

// ===========================================================
// LÓGICA DO WHATSAPP (TURBINADA)
// ===========================================================

mongoose.connect(MONGO_URI).then(() => {
    console.log('🍃 Mongo ON');
    
    const store = new MongoStore({ mongoose: mongoose });
    
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 600000 // Aumentei para 10min para salvar menos vezes e poupar recursos
        }),
        puppeteer: { 
            headless: true,
            // Lista de argumentos para ECONOMIA MÁXIMA de memória
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Crítico para o Render
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-extensions', // Desativa extensões
                '--disable-component-update' // Não busca updates do Chrome
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log('⚡ QR Code novo gerado');
        qrCodeImage = await QRCode.toDataURL(qr);
    });

    client.on('ready', () => {
        console.log('✅ Bot Pronto!');
        isConnected = true;
        qrCodeImage = null; // Limpa memória
    });

    client.on('message_create', async (msg) => {
        // Verifica tudo em uma linha só para ser rápido
        if (!msg.fromMe || msg.to !== GRUPO_PERMITIDO || !msg.hasMedia || msg.type !== 'image') return;

        try {
            const media = await msg.downloadMedia();
            if(media) {
                // Envia sem firulas de log excessivo
                await msg.reply(media, null, { sendMediaAsSticker: true, stickerName: "Bot", stickerAuthor: "Júlio" });
                console.log('sticker ok'); // Log mínimo
            }
        } catch (error) {
            console.error('Err:', error.message); // Log só da mensagem de erro
        }
    });

    client.initialize();
    
}).catch(err => console.error('Erro Mongo:', err));