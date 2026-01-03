const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const QRCode = require('qrcode'); 
const express = require('express');

// ===========================================================
// CONFIGURAÇÕES
// ===========================================================

// SUAS CREDENCIAIS
const MONGO_URI = 'mongodb+srv://admin_julio:IS0DKctykYcCdx3Q@bot-zap.8dxhxws.mongodb.net/?appName=bot-zap';
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// Variáveis de estado
let qrCodeImage = null;
let isConnected = false;

// ===========================================================
// SERVIDOR WEB
// ===========================================================
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('<h1>Modo Diagnóstico Ativado 🕵️</h1><p>Olhe os logs do Render para ver os detalhes da mensagem.</p>');
});

app.listen(port, () => console.log(`🌍 Web Diagnóstico OK: Porta ${port}`));

// ===========================================================
// LÓGICA DO WHATSAPP (COM LOGS DETALHADOS)
// ===========================================================

mongoose.connect(MONGO_URI).then(() => {
    console.log('🍃 Mongo ON');
    
    const store = new MongoStore({ mongoose: mongoose });
    
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 600000 
        }),
        puppeteer: { 
            headless: true,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
                '--disable-gpu', '--disable-extensions', '--disable-component-update'
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log('⚡ QR Code novo gerado');
        qrCodeImage = await QRCode.toDataURL(qr);
    });

    client.on('ready', () => {
        console.log('✅ Bot Pronto! Modo Espião Ativado.');
        isConnected = true;
    });

    // --- AQUI ESTÁ O ESPIÃO ---
    client.on('message_create', async (msg) => {
        
        // Vamos ignorar apenas mensagens de status (bolinha verde dos stories) para não poluir
        if (msg.isStatus) return;

        console.log('\n--- 🕵️ NOVA MENSAGEM DETECTADA ---');
        console.log(`Tipo (type): ${msg.type}`);
        console.log(`Tem Mídia? (hasMedia): ${msg.hasMedia}`);
        console.log(`Quem mandou (from): ${msg.from}`);
        console.log(`Para onde (to): ${msg.to}`);
        console.log(`Fui eu mesmo? (fromMe): ${msg.fromMe}`);
        console.log(`ID DO GRUPO CONFIGURADO: ${GRUPO_PERMITIDO}`);
        console.log('--------------------------------------\n');

        // Tenta rodar a lógica normal
        if (msg.fromMe && msg.to === GRUPO_PERMITIDO && msg.hasMedia && msg.type === 'image') {
            console.log('✅ PASSOU NO FILTRO! Tentando baixar mídia...');
            try {
                const media = await msg.downloadMedia();
                if(media) {
                    await msg.reply(media, null, { sendMediaAsSticker: true, stickerName: "Bot", stickerAuthor: "Júlio" });
                    console.log('✅ Figurinha enviada com sucesso!');
                } else {
                    console.log('❌ Erro: Download da mídia retornou vazio.');
                }
            } catch (error) {
                console.error('❌ ERRO FATAL:', error.message);
            }
        } else {
            console.log('⛔ BLOQUEADO PELO FILTRO. Motivo provável:');
            if (!msg.fromMe) console.log('   -> Não foi enviado por mim (fromMe é false).');
            if (msg.to !== GRUPO_PERMITIDO) console.log(`   -> ID do Grupo diferente. (Chegou: ${msg.to})`);
            if (!msg.hasMedia) console.log('   -> Não tem mídia.');
            if (msg.type !== 'image') console.log(`   -> Não é imagem (é ${msg.type}).`);
        }
    });

    client.initialize();
    
}).catch(err => console.error('Erro Mongo:', err));