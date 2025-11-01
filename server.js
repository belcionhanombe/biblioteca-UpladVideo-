import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import { google } from "googleapis";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());

// Upload temporário
const upload = multer({ dest: "uploads/" });

// OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Define o refresh token já obtido
oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

// API do YouTube
const youtube = google.youtube({ version: "v3", auth: oauth2Client });

// Rota de teste
app.get("/", (_, res) => res.send("Backend OK. POST /upload para enviar vídeo."));

// Rota para upload de vídeo para YouTube
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nenhum vídeo enviado" });

    const { title, description } = req.body;

    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: title || req.file.originalname,
          description: description || "Vídeo enviado da plataforma",
        },
        status: {
          privacyStatus: "private", // Pode ser "public" ou "unlisted"
        },
      },
      media: { body: fs.createReadStream(req.file.path) },
    });

    // Remove arquivo temporário
    fs.unlinkSync(req.file.path);

    const videoId = response.data.id;
    const youtubeLink = `https://www.youtube.com/watch?v=${videoId}`;

    res.json({ youtubeLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
