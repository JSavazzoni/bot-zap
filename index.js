const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const mongoose = require('mongoose');
const express = require('express');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');

// ===========================================================
// ⚙️ CONFIGURAÇÕES
// ===========================================================

const MONGO_URI = 'mongodb+srv://admin_julio:IS0DKctykYcCdx3Q@bot-zap.8dxhxws.mongodb.net/?appName=bot-zap';
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// ===========================================================
// 💾 SISTEMA DE SALVAMENTO NO MONGODB (ADAPTADOR CUSTOMIZADO)
// ===========================================================
// Cria um esquema simples para guardar a sessão
const SessionSchema = new mongoose.Schema({ _id: String, data: Object });
const Session = mongoose.model('BaileysSession', SessionSchema);

const useMongoDBAuthState = async () => {
    // Carrega ou cria credenciais
    const writeData = async (data, id) => {
        await Session.findByIdAndUpdate(id, { _id: id, data }, { upsert: true });
    };
    const readData = async (id) => {
        const res = await Session.findById(id);
        return res ? res.data : null;
    };
    const removeData = async (id) => {
        await Session.findByIdAndDelete(id);
    };

    // Lógica para simular sistema de arquivos no Banco
    const creds = await readData('creds') || (await useMultiFileAuthState('./temp_auth')).state.creds;

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if(type === 'app-state-sync-key' && value) { value = value.proto; } // Fix para chaves
                        if(value) data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for(const category in data) {
                        for(const id in data[category]) {
                            const value = data[category][id];
                            tasks.push(writeData(value, `${category}-${id}`));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
};

// ===========================================================
// 🌐 SITE (VISUAL MODERNO E LIMPO)
// ===========================================================
const app = express();
const port = process.env.PORT || 3000;

let qrRaw = null;
let statusBot = 'Iniciando Sistema Leve...';
let isConnected = false;

app.get('/', (req, res) => {
    // Evita cache para atualizar o QR code sempre
    res.set('Cache-Control', 'no-store');
    
    const html = `
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="refresh" content="3">
        <title>Bot Baileys Ultra</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <style>
            body { background: #0f172a; color: #f8fafc; font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 2rem; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); text-align: center; width: 350px; border: 1px solid #334155; }
            h1 { color: #38bdf8; margin: 0 0 1rem 0; font-size: 1.5rem; }
            .status-box { background: #334155; padding: 0.5rem; border-radius: 8px; margin-top: 1rem; font-size: 0.9rem; font-weight: 500; }
            .online { color: #4ade80; } .wait { color: #fbbf24; }
            #qrcode { background: white; padding: 10px; border-radius: 8px; margin: 1.5rem auto; width: fit-content; display: none; }
            .pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🚀 Bot Ultra Rápido</h1>
            <p style="color: #94a3b8; font-size: 0.9rem;">Tecnologia Baileys (Sem Chrome)</p>
            
            <div id="qrcode"></div>
            
            <div id="loader" style="margin: 20px 0; font-size: 2rem;">
                ${isConnected ? '✅' : '⏳'}
            </div>

            <div class="status-box">
                Status: <span class="${isConnected ? 'online' : 'wait'}">${isConnected ? 'SISTEMA ONLINE' : statusBot}</span>
            </div>
        </div>

        <script>
            const raw = "${qrRaw || ''}";
            const connected = ${isConnected};
            
            if (!connected && raw.length > 10) {
                document.getElementById('qrcode').style.display = 'block';
                document.getElementById('loader').style.display = 'none';
                document.getElementById('qrcode').innerHTML = "";
                new QRCode(document.getElementById("qrcode"), { text: raw, width: 180, height: 180 });
            } else if (connected) {
                document.getElementById('qrcode').style.display = 'none';
            }
        </script>
    </body>
    </html>`;
    res.send(html);
});

app.listen(port, () => console.log(`🌍 Site rodando na porta ${port}`));

// ===========================================================
// 🧠 LÓGICA DO ROBÔ (BAILEYS)
// ===========================================================

const startBot = async () => {
    console.log('🍃 Conectando ao MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('🍃 MongoDB Conectado! Carregando sessão...');

    const { state, saveCreds } = await useMongoDBAuthState();

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Imprime no terminal também como backup
        logger: pino({ level: 'silent' }), // Log silencioso para economizar CPU
        browser: ["Bot Baileys", "Chrome", "1.0.0"] // Nome que aparece no Zap
    });

    // Monitora a conexão
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('⚡ QR Code Recebido');
            qrRaw = qr;
            statusBot = 'Escaneie o QR Code!';
            isConnected = false;
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexão caiu. Reconectando...', shouldReconnect);
            isConnected = false;
            statusBot = 'Reconectando...';
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ CONECTADO COM SUCESSO!');
            qrRaw = null;
            isConnected = true;
            statusBot = 'Online';
        }
    });

    // Salva as credenciais sempre que mudar
    sock.ev.on('creds.update', saveCreds);

    // Lógica das Mensagens
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return; // Ignora msg própria ou vazia

        // Verifica se é o grupo certo
        const remoteJid = msg.key.remoteJid;
        if (remoteJid !== GRUPO_PERMITIDO) return;

        // Detecta Imagem
        const isImage = msg.message.imageMessage;
        
        if (isImage) {
            // Reação imediata (Rápido)
            await sock.sendMessage(remoteJid, { react: { text: "⏳", key: msg.key } });

            try {
                // Baixa a imagem (Buffer)
                const buffer = await downloadMediaMessage(msg, 'buffer', {});

                // Cria figurinha (Sem ffmpeg pesado, usa sharp nativo)
                const sticker = new Sticker(buffer, {
                    pack: '.',
                    author: '.',
                    type: StickerTypes.FULL, // Sticker completo (sem corte)
                    quality: 50 // Qualidade média para ser rápido
                });

                // Envia
                await sock.sendMessage(remoteJid, await sticker.toMessage(), { quoted: msg });
                await sock.sendMessage(remoteJid, { react: { text: "✅", key: msg.key } });
                console.log('Sticker enviado!');

            } catch (e) {
                console.error('Erro sticker:', e);
                await sock.sendMessage(remoteJid, { react: { text: "❌", key: msg.key } });
            }
        }
    });
};

// Inicia tudo
startBot().catch(err => console.error('Erro fatal:', err));