const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const express = require('express');

// ===========================================================
// CONFIGURAÇÕES
// ===========================================================

// 1. COLOQUE AQUI SUA URL DO MONGODB (Aquela que você copiou do site)
const MONGO_URI = 'mongodb+srv://admin_julio:IS0DKctykYcCdx3Q@bot-zap.8dxhxws.mongodb.net/?appName=bot-zap';

// 2. ID DO SEU GRUPO
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// ===========================================================
// SERVIDOR WEB (Para manter o Render acordado)
// ===========================================================
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🤖 Bot Profissional com MongoDB está Online!');
});

app.listen(port, () => {
    console.log(`🌍 Servidor Web rodando na porta ${port}`);
});

// ===========================================================
// CONEXÃO COM O BANCO E INÍCIO DO BOT
// ===========================================================

console.log('⏳ Conectando ao MongoDB...');

mongoose.connect(MONGO_URI).then(() => {
    console.log('🍃 MongoDB Conectado! Iniciando Store...');
    
    const store = new MongoStore({ mongoose: mongoose });
    
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000 // Salva o backup da sessão a cada 5 min
        }),
        puppeteer: { 
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
    });

    // --- GERAÇÃO DO QR CODE ---
    client.on('qr', (qr) => {
        console.log('\n================================================================');
        console.log('⚠️ SE O QR CODE ABAIXO ESTIVER DEFORMADO:');
        console.log('1. Copie o código longo abaixo (que começa com números e letras)');
        console.log('2. Vá no site: https://www.the-qrcode-generator.com/');
        console.log('3. Cole o código lá e escaneie a imagem que aparecer no site.');
        console.log('================================================================\n');
        
        console.log('>>> CÓDIGO RAW (Copie isto se precisar):');
        console.log(qr); 
        console.log('\n================================================================\n');
        
        // Tenta desenhar no terminal também
        qrcode.generate(qr, { small: true });
    });

    client.on('remote_session_saved', () => {
        console.log('💾 Sessão salva no Banco de Dados com sucesso!');
    });

    client.on('ready', () => {
        console.log('✅ Tudo pronto! O Bot está 100% carregado e salvo.');
    });

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
                    console.log('✅ Figurinha criada e enviada.');
                }
            } catch (error) {
                console.error('❌ Erro:', error);
            }
        }
    });

    client.initialize();
    
}).catch(err => {
    console.error('❌ Erro ao conectar no MongoDB:', err);
});