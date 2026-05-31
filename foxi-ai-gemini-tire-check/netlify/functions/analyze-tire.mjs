const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function safeJsonParse(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(200, {
      aiMode: "rules-only",
      confidence: 0.25,
      shortReason: "Photo check completed. Store confirmation is recommended.",
      visibleFindings: [],
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const images = Array.isArray(payload.images) ? payload.images.slice(0, 3) : [];
  if (images.length < 3) {
    return json(400, { error: "Three photos are required" });
  }

  const prompt = [
    "You are FOXI AI Tire Health Check for consumer tire photo screening in Saudi Arabia.",
    "Analyze the three tire photos: full tire front, 45 degree tread, and sidewall size/DOT close-up.",
    "Your job is to identify actual visible evidence from the photos. Do not only repeat the customer's answers.",
    "Look for tire size text, DOT date, tread wear, uneven wear, shallow scratches, deep cuts, cracks, sidewall bulges, exposed cords, repair marks, and photo quality.",
    "This is not a final workshop inspection. Be conservative for Saudi high heat, dusty roads, highway driving, old rubber, bulges, deep cuts, exposed cords, and repeated repairs.",
    "Return only valid JSON with this exact shape:",
    '{"detectedSize":{"width":"","profile":"","rim":"","raw":"","confidence":0},"dot":{"code":"","week":0,"year":0,"confidence":0},"scores":{"scratch":0,"wear":0,"bulge":0,"slowAirLoss":0,"dotAge":0,"repair":0,"overall":0},"riskSignals":{"treadWear":"none|possible|severe|unknown","cracking":"none|possible|severe|unknown","sidewallDamage":"none|possible|severe|unknown","bulge":false,"exposedCord":false},"visibleFindings":[{"area":"tread|sidewall|shoulder|DOT|overall","severity":"healthy|minor|caution|serious","observation":"specific visible evidence from the photo","customerText":"short customer-safe explanation","confidence":0}],"photoQuality":{"overall":"good|usable|poor","tread":"good|usable|poor","sidewall":"good|usable|poor"},"riskLevel":"green|yellow|red","shortReason":"","confidence":0}',
    "Scores are 0-10. 10 means healthy. 0 means severe risk.",
    "If the photos are unclear, lower confidence and recommend free store confirmation instead of giving a green result.",
    `Customer answers: ${JSON.stringify(payload.answers || {})}`,
  ].join("\n");

  const parts = [{ text: prompt }];
  for (const image of images) {
    parts.push({ text: `Photo role: ${image.role || "unknown"}` });
    parts.push({
      inline_data: {
        mime_type: image.mimeType || "image/jpeg",
        data: image.data,
      },
    });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.1,
            response_mime_type: "application/json",
          },
        }),
      },
    );

    if (!response.ok) {
      return json(502, { aiMode: "unavailable", shortReason: "Photo check completed. Store confirmation is recommended." });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    const parsed = safeJsonParse(text);

    if (!parsed) {
      return json(200, { aiMode: "rules-only", confidence: 0.35, shortReason: "Photo check completed. Store confirmation is recommended.", visibleFindings: [] });
    }

    return json(200, {
      aiMode: "gemini",
      ...parsed,
    });
  } catch {
    return json(200, {
      aiMode: "rules-only",
      confidence: 0.35,
      shortReason: "Photo check completed. Store confirmation is recommended.",
      visibleFindings: [],
    });
  }
}
