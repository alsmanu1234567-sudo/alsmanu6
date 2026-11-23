// dist/services/media/audio-converter.mjs
// يحوّل صوت mp3 (الناتج من FreeTTS.org) إلى OGG/Opus حقيقي متوافق مع
// ملاحظات واتساب الصوتية (PTT). بدون هذا التحويل، واتساب يستقبل ملف mp3
// بمسمى mimetype خاطئ ويظهر "صوت مكسور" لدى المستقبل.

import { spawn } from "child_process";
import os from "os";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getFfmpegPath } from "./ffmpeg-path.mjs";

export async function convertToWhatsappOpus(inputBuffer) {
  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(6).toString("hex");
  const inPath = path.join(tmpDir, `tts_in_${id}.mp3`);
  const outPath = path.join(tmpDir, `tts_out_${id}.ogg`);
  const ffmpegBin = await getFfmpegPath(); // يعمل على أي استضافة عبر ffmpeg-static

  await fs.writeFile(inPath, inputBuffer);
  try {
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegBin, [
        "-nostdin",
        "-y",
        "-i", inPath,
        "-c:a", "libopus",
        "-b:a", "32k",
        "-ar", "48000",
        "-ac", "1",
        "-application", "voip",
        outPath,
      ]);
      // [MEMORY-HYGIENE] لا نجمّع stderr بلا سقف + لا نترك ffmpeg معلّقاً
      let stderr = "";
      const timer = setTimeout(() => { try { ff.kill("SIGKILL"); } catch { } }, 120_000);
      if (typeof timer.unref === "function") timer.unref();
      ff.stderr.on("data", (d) => { stderr = (stderr + d.toString()).slice(-8192); });
      ff.on("error", (error) => { clearTimeout(timer); reject(error); });
      ff.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
      });
    });
    const outBuf = await fs.readFile(outPath);
    return { ok: true, buffer: outBuf };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}
