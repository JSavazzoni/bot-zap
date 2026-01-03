const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const express = require('express');

// ===========================================================
// ⚙️ CONFIGURAÇÕES
// ===========================================================

// 1. Sua URL do MongoDB (Verifique se não tem espaços extras)
const MONGO_URI = 'mongodb+srv://admin_julio:IS0DKctykYcCdx3Q@bot-zap.8dxhxws.mongodb.net/?appName=bot-zap';

// 2. ID do seu Grupo
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// ===========================================================
// 🌐 SITE VISUAL (INTERFACE BONITA & LEVE)
// ===========================================================
const app = express();
const port = process.env.PORT || 3000;

// Variáveis globais leves
let qrCodeData = null; // Guarda o código do QR
let statusBot = 'Iniciando...'; // Texto do status
let isConnected = false;

app.get('/', async (req, res) => {
    // Se tiver QR Code dados, gera a imagem na hora (economiza RAM guardando só a string)
    let qrImageTag = '';
    if (qrCodeData && !isConnected) {
        try {
            const url = await QRCode.toDataURL(qrCodeData);
            qrImageTag = `<img src="${url}" class="qr-pulse" alt="QR Code">`;
        } catch (e) { console.error(e); }
    }

    const html = `
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="refresh" content="5"> <title>Bot WhatsApp Sticker</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #111b21 0%, #202c33 100%);
                color: white;
                height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                text-align: center;
            }
            .card {
                background: #2a3942;
                padding: 2rem;
                border-radius: 15px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.3);
                max-width: 400px;
                width: 90%;
                border-top: 5px solid #00a884;
            }
            h1 { color: #e9edef; font-size: 1.5rem; margin-bottom: 10px; }
            p { color: #8696a0; margin-bottom: 20px; }
            .status-badge {
                display: inline-block;
                padding: 5px 15px;
                border-radius: 20px;
                font-weight: bold;
                font-size: 0.9rem;
                background: #202c33;
                color: #ffc107;
                margin-top: 10px;
            }
            .online { color: #00a884; background: rgba(0, 168, 132, 0.1); }
            .qr-pulse {
                border-radius: 10px;
                border: 5px solid white;
                animation: pulse 2s infinite;
                max-width: 100%;
            }
            @keyframes pulse {
                0% { box-shadow: 0 0 0 0 rgba(0, 168, 132, 0.7); }
                70% { box-shadow: 0 0 0 10px rgba(0, 168, 132, 0); }
                100% { box-shadow: 0 0 0 0 rgba(0, 168, 132, 0); }
            }
            .footer { margin-top: 20px; font-size: 0.8rem; opacity: 0.5; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🤖 Bot de Figurinhas</h1>
            
            ${isConnected 
                ? `<div style="font-size: 3rem;">✅</div><p>Sistema Operacional e Seguro</p>` 
                : qrImageTag ? `<p>Escaneie para conectar</p>${qrImageTag}` 
                : `<div style="font-size: 3rem;">⏳</div><p>Carregando sistema...</p>`
            }

            <div class="status-badge ${isConnected ? 'online' : ''}">
                Status: ${isConnected ? 'ONLINE' : statusBot}
            </div>
            
            <div class="footer">Memória Otimizada • MongoDB</div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

app.listen(port, () => console.log(`🌍 Site rodando na porta ${port}`));

// ===========================================================
// 🧠 LÓGICA DO ROBÔ (OTIMIZADA PARA RAM)
// ===========================================================

console.log('⏳ Conectando ao Banco de Dados...');

mongoose.connect(MONGO_URI).then(() => {
    console.log('🍃 MongoDB Conectado.');
    
    const store = new MongoStore({ mongoose: mongoose });
    
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 600000 // Salva só a cada 10 min (Salva CPU/RAM)
        }),
        puppeteer: { 
            headless: true, // Modo sem cabeça (obrigatório)
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Crítico para evitar crash de memória
                '--disable-accelerated-2d-canvas', // Desativa gráficos
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu', // Desativa GPU
                '--disable-audio-output', // Desativa áudio
                '--disable-extensions' // Desativa extensões
            ]
        }
    });

    // Evento: Gerar QR Code
    client.on('qr', (qr) => {
        console.log('⚡ Novo QR Code gerado');
        qrCodeData = qr; // Salva a string, não a imagem (mais leve)
        statusBot = 'Aguardando Leitura...';
        isConnected = false;
    });

    // Evento: Conectado
    client.on('ready', () => {
        console.log('✅ Bot Autenticado e Pronto!');
        isConnected = true;
        qrCodeData = null; // LIMPA A MEMÓRIA do QR Code imediatamente
        statusBot = 'Online';
    });

    // Evento: Receber mensagem
    client.on('message_create', async (msg) => {
        // Filtro Rápido (Se não for o que queremos, cancela na hora)
        if (!msg.fromMe || msg.to !== GRUPO_PERMITIDO || !msg.hasMedia || msg.type !== 'image') return;

        // Feedback Visual (Reloginho)
        await msg.react('⏳');

        try {
            const media = await msg.downloadMedia();
            
            if(media) {
                // Envia a figurinha
                await msg.reply(media, null, { 
                    sendMediaAsSticker: true, 
                    stickerName: ".", 
                    stickerAuthor: "."
                });

                // Feedback de Sucesso
                await msg.react('✅'); 
                
                // Força o Garbage Collector a limpar a variável media (opcional, o JS faz sozinho, mas ajuda)
                media.data = null; 
            }
        } catch (error) {
            console.error('❌ Erro:', error.message);
            await msg.react('❌');
        }
    });

    // Evento: Desconectado (Para reiniciar sozinho)
    client.on('disconnected', (reason) => {
        console.log('❌ Bot desconectado:', reason);
        isConnected = false;
        statusBot = 'Desconectado. Reiniciando...';
        client.initialize();
    });

    client.initialize();
    
}).catch(err => {
    console.error('❌ Erro Fatal Mongo:', err);
});