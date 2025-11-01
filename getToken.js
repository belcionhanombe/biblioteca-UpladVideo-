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

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const youtube = google.youtube({ version: "v3", auth: oauth2Client });

app.get("/", (_, res) => res.send("Backend OK. POST /upload para enviar vídeo."));

app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Nenhum ficheiro enviado" });
    const { title, description } = req.body;
    const response = await youtube.videos.insert({
      part: "snippet,status",
      requestBody: {
        snippet: { title: title || req.file.originalname, description: description || "" },
        status: { privacyStatus: "private" }
      },
      media: { body: fs.createReadStream(req.file.path) }
    });
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.json({ success: true, videoId: response.data.id, youtubeLink: `https://www.youtube.com/watch?v=${response.data.id}` });
  } catch (err) {
    console.error("Erro upload:", err);
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`Backend a correr em http://localhost:${PORT}`));
