// index.js
import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
const upload = multer({ dest: "uploads/" });

// Permitir tanto variáveis YT_* quanto CLIENT_*
const CLIENT_ID = process.env.YT_CLIENT_ID || process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET || process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.YT_REDIRECT_URI || process.env.REDIRECT_URI;
const ENV_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN || process.env.REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.warn("Aviso: CLIENT_ID / CLIENT_SECRET / REDIRECT_URI não estão todas definidas nas variáveis de ambiente.");
}

// Inicializa OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Scopes para upload no YouTube
const ytScopes = ["https://www.googleapis.com/auth/youtube.upload"];

// Ficheiro onde guardamos tokens após o fluxo OAuth
const TOKENS_FILE = "youtube_tokens.json";

// Se houver refresh token no .env, usa-o
if (ENV_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: ENV_REFRESH_TOKEN });
  console.log("Usando REFRESH_TOKEN a partir das variáveis de ambiente.");
}

// Se existir youtube_tokens.json, carrega e aplica
if (fs.existsSync(TOKENS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
    oauth2Client.setCredentials(saved);
    console.log("Carreguei tokens do ficheiro", TOKENS_FILE);
  } catch (e) {
    console.warn("Erro a ler", TOKENS_FILE, ":", e.message || e);
  }
}

// Inicializa YouTube client (usa oauth2Client atual)
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

// Rotas

app.get("/", (_, res) => res.send("Backend OK. Use GET /auth para autorizar, POST /upload para enviar vídeo."));

// Gera URL de autorização (abre no browser)
app.get("/auth", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline", // necessário para refresh_token
    prompt: "consent",      // força devolver refresh_token mesmo se já autorizaste antes
    scope: ytScopes,
  });
  // Mostra link no browser para facilitar
  res.send(`<p>Abra este link no navegador para autorizar a conta YouTube:</p>
            <a href="${url}" target="_blank">${url}</a>
            <p>Depois de autorizar, serás redirecionado para a rota /oauth2callback que grava os tokens.</p>`);
});

// Callback que a Google redireciona com ?code=...
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send("Falta 'code' na query string.");
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    // Guarda tokens num ficheiro seguro para uso futuro
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
    // Aplica imediatamente ao oauth2Client (para não reiniciar o servidor)
    oauth2Client.setCredentials(tokens);
    console.log("Tokens gravados em", TOKENS_FILE);
    console.log(tokens);
    res.send("Autorização concluída. Tokens guardados em " + TOKENS_FILE + ". Pode fechar esta janela.");
  } catch (err) {
    console.error("Erro ao trocar code por tokens:", err);
    res.status(500).send("Erro ao obter tokens: " + (err.message || err));
  }
});

// Endpoint /upload — espera form-data com campo 'video' (ficheiro) e campos opcionais title, description
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Nenhum ficheiro enviado (campo 'video')." });

    // Garante que oauth2Client tem credenciais válidas (irá tentar refresh usando refresh_token se preciso)
    try {
      await oauth2Client.getAccessToken();
    } catch (e) {
      console.warn("Aviso: não foi possível obter access token automaticamente. Verifica refresh token / auth flow.", e.message || e);
      // continuar e tentar upload; se falhar retornará erro
    }

    const { title, description } = req.body;
    const filePath = req.file.path;
    const fileSize = fs.statSync(filePath).size;

    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: title || req.file.originalname,
          description: description || ""
        },
        status: {
          privacyStatus: "private"
        }
      },
      media: {
        body: fs.createReadStream(filePath)
      }
    }, {
      onUploadProgress: evt => {
        const progress = evt.bytesRead && fileSize ? (evt.bytesRead / fileSize) * 100 : null;
        if (progress !== null) console.log(`Uploading: ${Math.round(progress)}%`);
      }
    });

    // Remove ficheiro temporário
    try { fs.unlinkSync(filePath); } catch (e) {}

    res.json({
      success: true,
      videoId: response.data.id,
      youtubeLink: `https://www.youtube.com/watch?v=${response.data.id}`,
      response: response.data
    });
  } catch (err) {
    console.error("Erro upload:", err);
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// Rota opcional para verificar estado do token (access token atual)
app.get("/token-status", async (req, res) => {
  try {
    const at = await oauth2Client.getAccessToken();
    res.json({ success: true, access_token: at?.token || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`Backend a correr em http://localhost:${PORT}`));
