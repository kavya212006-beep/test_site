// Cloudflare Pages Function: /api/transcribe
// Runs OpenAI Whisper directly on Cloudflare Workers AI edge serverless GPUs

interface Env {
  AI?: {
    run: (model: string, input: any) => Promise<any>;
  };
}

type PagesFunction<T = Env> = (context: {
  request: Request;
  env: T;
  params: Record<string, string>;
  waitUntil: (promise: Promise<any>) => void;
  next: () => Promise<Response>;
  data: Record<string, any>;
}) => Promise<Response>;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const contentType = request.headers.get('content-type') || '';
    let audioBytes: Uint8Array;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return new Response(JSON.stringify({ error: 'No audio file provided' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const buffer = await file.arrayBuffer();
      audioBytes = new Uint8Array(buffer);
    } else {
      const buffer = await request.arrayBuffer();
      if (!buffer || buffer.byteLength === 0) {
        return new Response(JSON.stringify({ error: 'Empty audio buffer' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      audioBytes = new Uint8Array(buffer);
    }

    // Run Workers AI Whisper
    if (env.AI && typeof env.AI.run === 'function') {
      const input = {
        audio: [...audioBytes],
      };

      const response = await env.AI.run('@cf/openai/whisper', input);

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }

    return new Response(
      JSON.stringify({
        text: 'Cloudflare Workers AI Whisper is ready on deployment.',
        vtt: '',
        word_count: 0,
        words: [],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'Transcription failed',
        message: err?.message || String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
