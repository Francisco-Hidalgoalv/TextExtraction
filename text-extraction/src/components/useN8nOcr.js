export function useN8nOcr() {
  const webhookUrl =
    import.meta.env.VITE_N8N_WEBHOOK_URL || '/n8n-webhook-test/ocr/extractor';

  async function run(file, signal) {
    if (!file) throw new Error('No file');
    const fd = new FormData();
    fd.append('data', file);

    const res = await fetch(webhookUrl, { method: 'POST', body: fd, signal });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`Webhook error ${res.status}: ${msg}`);
    }
    const json = await res.json();

    // La respuesta está anidada en varios objetos
    const text = json?.responses?.[0]?.fullTextAnnotation?.text || '';

    return { text, raw: json };
  }

  return { run };
}