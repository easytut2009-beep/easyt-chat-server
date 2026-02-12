import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/chat", async (req, res) => {
  const { message } = req.body;

  console.log("✅ Message received:", message);

  return res.json({
    reply: "✅✅ النسخة الجديدة من السيرفر شغالة فعليًا ✅✅"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server running on port " + PORT);
});
