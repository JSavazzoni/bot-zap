const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcodeTerminal = require('qrcode-terminal'); // Mantivemos pro log (backup)
const QRCode = require('qrcode'); // Nova lib para imagem no site
const express = require('express');

// ===========================================================
// CONFIGURAÇÕES
// ===========================================================

// 1. URL DO MONGODB
const MONGO_URI = 'mongodb+srv://admin_julio:IS0DKctykYcCdx3Q@bot-zap.8dxhxws.mongodb.net/?appName=bot-zap';

// 2. ID DO SEU GRUPO
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// Variáveis de Estado (Para controlar o que aparece no site)
let qrCodeImage = null; // Vai guardar a imagem do QR
let statusMessage = 'Iniciando o Bot... Aguarde.';
let isConnected = false;

// ===========================================================
// SERVIDOR WEB (Com visualizador de QR Code)
// ===========================================================
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    // HTML Básico com estilo simples
    const htmlStart = `
        <html>
        <head>
            <meta http-equiv="refresh" content="5"> <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f0f2f5; }
                .card { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); display: inline-block; }
                h1 { color: #075e54; }
                p { font-size: 18px; color: #555; }
                .status { font-weight: bold; color: #d32f2f; }
                .online { color: #2e7d32; }
            </style>
        </head>
        <body>
            <div class="card">
    `;

    const htmlEnd = `
            </div>
        </body>
        </html>
    `;

    // 1. Se estiver conectado
    if (isConnected) {
        res.send(`${htmlStart}
            <h1 class="online">✅ Bot Online!</h1>
            <p>O sistema está rodando 100%.</p>
            <p>Conectado ao MongoDB.</p>
            ${htmlEnd}`);
    } 
    // 2. Se tiver QR Code para mostrar
    else if (qrCodeImage) {
        res.send(`${htmlStart}
            <h1>Conectar WhatsApp</h1>
            <p>Escaneie o QR Code abaixo para iniciar:</p>
            <img src="${qrCodeImage}" alt="QR Code" width="300" height="300">
            <p class="status">Atualizando a cada 5 segundos...</p>
            ${htmlEnd}`);
    } 
    // 3. Se estiver carregando
    else {
        res.send(`${htmlStart}
            <h1>⏳ Carregando...</h1>
            <p>${statusMessage}</p>
            ${htmlEnd}`);
    }
});

app.listen(port, () => {
    console.log(`🌍 Site rodando na porta ${port}`);
});

// ===========================================================
// LÓGICA DO WHATSAPP
// ===========================================================

console.log('⏳ Conectando ao MongoDB...');

mongoose.connect(MONGO_URI).then(() => {
    console.log('🍃 MongoDB Conectado!');
    
    const store = new MongoStore({ mongoose: mongoose });
    
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000
        }),
        // SUBSTITUA A PARTE ANTIGA DO PUPPETEER POR ESTA:
        puppeteer: { 
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // <--- ESSENCIAL para o Render não travar
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process', 
                '--disable-gpu'
            ]
        }
    });

    // --- AO RECEBER O QR CODE ---
    client.on('qr', async (qr) => {
        console.log('QR Code recebido! Gerando imagem...');
        statusMessage = 'Aguardando leitura do QR Code...';
        
        // Gera a imagem para o site
        qrCodeImage = await QRCode.toDataURL(qr);
        
        // Mantém o log no terminal também (segurança)
        qrcodeTerminal.generate(qr, { small: true });
    });

    client.on('loading_screen', (percent, message) => {
        statusMessage = `Carregando WhatsApp: ${percent}%`;
        qrCodeImage = null; // Limpa o QR se estiver carregando
    });

    client.on('authenticated', () => {
        statusMessage = 'Autenticado! Entrando...';
        qrCodeImage = null;
    });

    client.on('ready', () => {
        console.log('✅ Bot pronto!');
        isConnected = true;
        qrCodeImage = null;
        statusMessage = 'Online';
    });

    // --- FUNÇÃO DE FIGURINHAS ---
    client.on('message_create', async (msg) => {
        if (msg.fromMe && msg.to === GRUPO_PERMITIDO && msg.hasMedia && msg.type === 'image') {
            try {
                const media = await msg.downloadMedia();
                if(media) {
                    await msg.reply(media, null, {
                        sendMediaAsSticker: true,
                        stickerName: "Bot Profissional",
                        stickerAuthor: "MongoDB"
                    });
                }
            } catch (error) {
                console.error('❌ Erro:', error);
            }
        }
    });

    client.initialize();
    
}).catch(err => {
    console.error('❌ Erro Mongo:', err);
});