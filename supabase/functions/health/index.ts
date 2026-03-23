// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve((req: Request) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, message: 'GET only' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }
  const envGemini = Boolean((globalThis as any).Deno?.env?.get?.('GEMINI_API_KEY'));
  const geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
  const model = (globalThis as any).Deno?.env?.get?.('GEMINI_MODEL') || 'gemini-3.1-flash-lite';
  const visionModel = (globalThis as any).Deno?.env?.get?.('GEMINI_IMAGE_MODEL') || model;
  const textModel = (globalThis as any).Deno?.env?.get?.('GEMINI_TEXT_MODEL') || model;
  const data = {
    ok: true,
    service: 'health',
    version: 'v2',
    time: new Date().toISOString(),
    envGemini,
    geminiBaseUrl,
    model,
    visionModel,
    textModel,
    functions: ['analyze-food-image','health'],
  } as const;
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
});
