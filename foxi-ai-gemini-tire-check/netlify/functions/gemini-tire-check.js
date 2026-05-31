const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json"
};

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "AI service not configured" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const prompt = String(payload.prompt || "");
  const images = Array.isArray(payload.images) ? payload.images : [];
  if (!prompt || !images.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing tire photos" }) };
  }

  const parts = [{ text: prompt }];
  for (const image of images) {
    parts.push({ text: `Tire ${image.tireIndex}, position: ${image.position}, photo role: ${image.role}` });
    parts.push({
      inline_data: {
        mime_type: image.mimeType || "image/jpeg",
        data: image.data || ""
      }
    });
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0.1, response_mime_type: "application/json" }
        })
      }
    );
    clearTimeout(timer);

    if (!res.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "AI service busy" }) };
    }

    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
    const cleaned = String(text || "")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      return { statusCode: 200, headers, body: JSON.stringify(JSON.parse(cleaned)) };
    } catch (error) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        return { statusCode: 200, headers, body: JSON.stringify(JSON.parse(match[0])) };
      }
      return { statusCode: 502, headers, body: JSON.stringify({ error: "AI response unreadable" }) };
    }
  } catch (error) {
    clearTimeout(timer);
    return { statusCode: 504, headers, body: JSON.stringify({ error: "AI service timeout" }) };
  }
};
