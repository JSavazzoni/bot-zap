const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const mongoose = require('mongoose');
const express = require('express');
const pino = require('pino');
const NodeCache = require('node-cache');
const QRCode = require('qrcode');
const fs = require('fs');

// ===========================================================
// ⚙️ CONFIGURAÇÕES
// ===========================================================
const MONGO_URI = 'mongodb+srv://admin_julio:IS0DKctykYcCdx3Q@bot-zap.8dxhxws.mongodb.net/?appName=bot-zap';
const GRUPO_PERMITIDO = '120363406055326989@g.us'; 

// ===========================================================
// 💾 SISTEMA DE BANCO DE DADOS (CONEXÃO ÚNICA)
// ===========================================================
const SessionSchema = new mongoose.Schema({ _id: String, data: Object });
const Session = mongoose.model('BaileysSession', SessionSchema);

// Conecta e não desconecta mais
mongoose.connect(MONGO_URI)
    .then(() => console.log('🍃 MongoDB Conectado (Modo Persistente).'))
    .catch(err => console.error('❌ Erro Fatal Mongo:', err));

const useMongoDBAuthState = async () => {
    const writeData = async (data, id) => {
        try { await Session.findByIdAndUpdate(id, { _id: id, data }, { upsert: true }); } catch(err) {}
    };
    const readData = async (id) => {
        try { const res = await Session.findById(id); return res ? res.data : null; } catch(err) { return null; }
    };
    
    // Removemos o uso de arquivos temporários para evitar conflito no Render
    // Se não tiver credenciais no banco, iniciamos um objeto vazio
    const creds = await readData('creds') || (await useMultiFileAuthState('./temp_auth_void')).state.creds;

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if(type === 'app-state-sync-key' && value) { value = value.proto; }
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
// 🌐 SITE VISUAL
// ===========================================================
const app = express();
const port = process.env.PORT || 3000;
let qrRaw = null;
let statusBot = 'Iniciando...';
let isConnected = false;

app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="3"><title>Bot Sticker</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <style>body{background:#0d1117;color:#c9d1d9;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}
    .box{background:#161b22;padding:2rem;border-radius:12px;border:1px solid #30363d;text-align:center;width:300px}
    #qrcode{background:#fff;padding:10px;margin:20px auto;border-radius:8px;width:fit-content;display:none}
    .st{font-weight:bold;padding:4px 8px;border-radius:4px}</style></head><body>
    <div class="box"><h2>🤖 Bot Sticker Auto-Fix</h2><div id="qrcode"></div>
    <p>Status: <span class="st" style="background:${isConnected?'#238636':'#9e6a03'}">${isConnected?'ONLINE':'Aguardando...'}</span></p>
    <p style="font-size:12px;color:#8b949e">${statusBot}</p></div>
    <script>
    const r="${qrRaw||''}",c=${isConnected};
    if(!c && r.length>10){const q=document.getElementById('qrcode');q.style.display='block';q.innerHTML="";new QRCode(q,{text:r,width:180,height:180})}
    </script></body></html>`;
    res.send(html);
});
app.listen(port, () => console.log(`🌍 Site na porta ${port}`));

// ===========================================================
// 🧠 LÓGICA DO ROBÔ (AUTO-REPAIR)
// ===========================================================
const msgRetryCounterCache = new NodeCache();
let failureCount = 0; // Contador de erros seguidos

const startBot = async () => {
    const { state, saveCreds } = await useMongoDBAuthState();

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        
        // MUDANÇA DE IDENTIDADE PARA EVITAR TRAVAS
        browser: ["Bot Sticker", "Firefox", "1.0.0"],
        
        // OTIMIZAÇÕES
        syncFullHistory: false, 
        markOnlineOnConnect: false,
        
        // REDE
        connectTimeoutMs: 60000, 
        defaultQueryTimeoutMs: 0, // Sem timeout para queries
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 5000,
        
        msgRetryCounterCache, 
        getMessage: async () => { return { conversation: 'Oie' }; }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('⚡ QR Code NOVO. Reset efetuado.');
            qrRaw = qr;
            statusBot = 'Sessão Resetada. Escaneie!';
            isConnected = false;
            failureCount = 0; // Resetamos o contador de erro se pedir QR
        }

        if (connection === 'close') {
            const reason = (lastDisconnect?.error)?.output?.statusCode;
            const errorPayload = lastDisconnect?.error?.message || "Sem detalhes";
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            
            console.log(`❌ Caiu. Código: ${reason} | Erro: ${errorPayload}`);
            
            // AUMENTA O CONTADOR DE ERROS
            failureCount++;
            console.log(`⚠️ Tentativa de recuperação ${failureCount}/3`);

            // SE FALHAR 3 VEZES SEGUIDAS COM ERRO CRÍTICO (515 ou Undefined)
            // Nós mesmos apagamos o banco para forçar um QR Code novo e limpo.
            if (failureCount >= 3 && (reason === 515 || !reason)) {
                console.log('☢️ MUITOS ERROS SEGUIDOS! DESTRUINDO SESSÃO CORROMPIDA...');
                try {
                    await mongoose.connection.db.dropCollection('baileyssessions');
                    console.log('✅ Banco limpo. Gerando novo QR Code na próxima reinicialização...');
                    sock.logout(); // Força logout
                } catch(e) { console.log('Erro ao limpar banco:', e); }
                failureCount = 0; // Reseta contador
            }

            // Se for logout explícito (401), limpa imediatamente
            if (reason === 401 || reason === 403) {
                console.log('🚫 Deslogado. Limpando...');
                await mongoose.connection.db.dropCollection('baileyssessions').catch(()=>{});
                failureCount = 0;
            }

            qrRaw = null;
            isConnected = false;
            statusBot = `Reconectando... (Erro ${reason})`;
            
            if (shouldReconnect) {
                // Espera 5 segundos para não sobrecarregar
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ CONECTADO E ESTÁVEL!');
            qrRaw = null;
            isConnected = true;
            statusBot = 'Sistema Online';
            failureCount = 0; // Sucesso! Zera os erros.
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        if (remoteJid !== GRUPO_PERMITIDO) return;

        const isImage = msg.message.imageMessage || 
                        msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ||
                        msg.message.viewOnceMessageV2?.message?.imageMessage;
        
        if (isImage) {
            try { await sock.sendMessage(remoteJid, { react: { text: "⏳", key: msg.key } }); } catch(e){}

            try {
                const imageKey = msg.message.imageMessage ? msg : (msg.message.viewOnceMessageV2 ? msg.message.viewOnceMessageV2 : msg);
                const buffer = await downloadMediaMessage(imageKey, 'buffer', {});
                const sticker = new Sticker(buffer, { pack: '.', author: '.', type: StickerTypes.FULL, quality: 40 });

                await sock.sendMessage(remoteJid, await sticker.toMessage(), { quoted: msg });
                await sock.sendMessage(remoteJid, { react: { text: "✅", key: msg.key } });
            } catch (e) {
                console.error('Erro:', e.message);
                try { await sock.sendMessage(remoteJid, { react: { text: "❌", key: msg.key } }); } catch(e){}
            }
        }
    });
};

startBot();